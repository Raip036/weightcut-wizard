/**
 * Community feed maintenance crons — bound the two tables that otherwise grow
 * without limit as a gym ages. Both are additive background jobs: nothing in
 * the user-facing read path depends on them having run, so a missed/partial
 * run only delays the cleanup, it never breaks the feed.
 *
 *  1. pruneFeedViews   — deletes `feed_views` rows older than the retention
 *     window. This is the highest-leverage scale fix: `gymFeed.listFeed`
 *     collects the viewer's ENTIRE `feed_views` history on every page load to
 *     exclude already-seen posts, and that set grows by one row per post the
 *     user ever swipes away. Pruning caps the collect to ~RETENTION_DAYS of
 *     views. Trade-off: a post viewed longer ago than the window can resurface
 *     in the feed (acceptable, and posts older than the feed TTL drop out via
 *     archiveOldPosts anyway).
 *
 *  2. archiveOldPosts  — nulls `gymId` on `session_media` rows older than the
 *     feed TTL so they drop out of the gym feed (the `by_gym_created` index)
 *     while staying in the owner's personal library (read via `by_user_*`).
 *     This is the cron the schema comment on `session_media.gymId` already
 *     promised ("A daily cron nulls this on rows > 90 days").
 *
 * Both mutations self-reschedule via the scheduler to stay within Convex's
 * per-transaction read/write limits, draining the backlog over several ticks.
 */
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";

const DAY_MS = 24 * 60 * 60 * 1000;

// How long a "viewed" record is kept. Longer = stronger "don't re-show me"
// guarantee but a larger per-user collect in the feed read. 30d is a good
// balance for a daily-active training feed.
const VIEW_RETENTION_DAYS = 30;

// How long a post stays in the gym feed before it drops out (but stays in the
// personal library). Mirrors the documented intent on `session_media.gymId`.
const POST_FEED_TTL_DAYS = 90;

// Rows touched per scheduled tick. Kept well under Convex's transaction limits;
// the mutation self-reschedules when a full batch comes back.
const BATCH = 200;

/**
 * Delete `feed_views` older than the retention window. Uses the `by_viewed_at`
 * index to read only the oldest rows, deletes a batch, and reschedules itself
 * while a full batch keeps coming back.
 */
export const pruneFeedViews = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - VIEW_RETENTION_DAYS * DAY_MS;
    const stale = await ctx.db
      .query("feed_views")
      .withIndex("by_viewed_at", (q) => q.lt("viewedAt", cutoff))
      .take(BATCH);

    for (const row of stale) {
      await ctx.db.delete(row._id);
    }

    // Full batch → there may be more stale rows; continue next tick.
    if (stale.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.feedMaintenance.pruneFeedViews, {});
    }
  },
});

// Key for the persisted forward cursor row in `feed_cron_state`.
const ARCHIVE_CURSOR_KEY = "archiveOldPosts";

/**
 * Read the persisted forward cursor for `archiveOldPosts` from
 * `feed_cron_state`. Returns `{ state, cursor }` so the caller can upsert the
 * same row afterwards without a second lookup. A missing row means "start from
 * the beginning" (`cursor: null`).
 */
async function loadArchiveCursor(ctx: MutationCtx) {
  const state = await ctx.db
    .query("feed_cron_state")
    .withIndex("by_key", (q) => q.eq("key", ARCHIVE_CURSOR_KEY))
    .unique();
  return { state, cursor: state?.cursor ?? null };
}

/** Upsert the persisted forward cursor row (insert if missing, else patch). */
async function saveArchiveCursor(
  ctx: MutationCtx,
  state: Doc<"feed_cron_state"> | null,
  cursor: string | null,
) {
  if (state) {
    await ctx.db.patch(state._id, { cursor, updatedAt: Date.now() });
  } else {
    await ctx.db.insert("feed_cron_state", {
      key: ARCHIVE_CURSOR_KEY,
      cursor,
      updatedAt: Date.now(),
    });
  }
}

/**
 * Null `gymId` on `session_media` rows older than the feed TTL. Paginates the
 * table oldest-first (`order("asc")` = ascending `_creationTime`), archives the
 * old rows, and stops as soon as it reaches a row newer than the cutoff (all
 * subsequent rows are newer too).
 *
 * Unlike a naive daily full-rescan, this PERSISTS a forward cursor in
 * `feed_cron_state` (key `"archiveOldPosts"`) so each run resumes where the
 * fully-archived region ended instead of re-walking the entire aged history:
 *
 *  - The saved cursor only advances to `page.continueCursor` for pages that
 *    were entirely in the old region (no row >= cutoff). Those rows are now
 *    permanently archived, so we never need to look at them again.
 *  - When a page reaches the cutoff boundary (a row >= cutoff), we do NOT
 *    advance the cursor and do NOT reschedule. The next run resumes from the
 *    SAME boundary, picking up rows that have since aged past the cutoff.
 *
 * Forward-only is safe because a row's `_creationTime` is immutable and rows
 * only ever age PAST the cutoff over time — always at a creation-time AFTER the
 * saved cursor, never before it. If a persisted cursor is ever rejected (e.g.
 * invalidated), we catch, reset the state row to null, and restart from the
 * beginning on the next run.
 */
export const archiveOldPosts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - POST_FEED_TTL_DAYS * DAY_MS;

    const { state, cursor } = await loadArchiveCursor(ctx);

    let page;
    try {
      page = await ctx.db
        .query("session_media")
        .order("asc")
        .paginate({ cursor, numItems: BATCH });
    } catch (err) {
      // A stale/invalidated saved cursor can no longer be paginated from.
      // Reset to null so the next run restarts cleanly from the beginning.
      await saveArchiveCursor(ctx, state, null);
      return;
    }

    let reachedRecent = false;
    for (const row of page.page) {
      if (row._creationTime >= cutoff) {
        // Ascending by creation time, so everything after this is newer too.
        reachedRecent = true;
        break;
      }
      // Already-archived rows (gymId unset) are skipped; only flip live ones.
      // Clearing gymId also makes the post feed-ineligible, so keep the
      // denormalised flag in lockstep with the by_gym_feed index.
      if (row.gymId !== undefined) {
        await ctx.db.patch(row._id, { gymId: undefined, feedEligible: false });
      }
    }

    if (reachedRecent) {
      // Hit the boundary. Leave the saved cursor where it was so the next run
      // resumes from this same boundary as more rows age. Don't reschedule.
      return;
    }

    // Whole page was in the old region — those rows are permanently archived.
    // Advance the persisted cursor past them.
    await saveArchiveCursor(ctx, state, page.continueCursor);

    // More rows may remain in the old region; continue next tick.
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.feedMaintenance.archiveOldPosts,
        {},
      );
    }
  },
});

const DATE_KEY_LEN = 10; // "YYYY-MM-DD"

/** Today's date as a UTC YYYY-MM-DD key, matching `capturedAt` formatting. */
function todayDateKey(): string {
  return new Date().toISOString().slice(0, DATE_KEY_LEN);
}

/**
 * One-time backfill for `session_media.mediaUrl` / `.thumbUrl` — the cached
 * Convex Storage serving URLs gymFeed reads directly instead of calling
 * `ctx.storage.getUrl` per post per reactive re-emit.
 *
 * For each row missing BOTH cached URLs, resolves `mediaUrl` from `storageId`
 * and `thumbUrl` from `thumbStorageId` (each only when the storage id is set)
 * and patches the row. Rows already populated, or with no `storageId`, are
 * skipped. Paginated + resumable via a `cursor` arg, mirroring the
 * `migrations.ts` contract.
 *
 * Run via:
 *   npx convex run feedMaintenance:backfillMediaUrls '{"cursor":null}'
 *   …repeat with the returned continueCursor until done.
 */
export const backfillMediaUrls = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("session_media")
      .paginate({ cursor, numItems: 100 });

    let processed = 0;
    for (const row of page.page) {
      // Already cached, or nothing to resolve from — idempotent skip.
      if (row.mediaUrl && row.thumbUrl) continue;
      if (!row.storageId && !row.thumbStorageId) continue;

      const patch: { mediaUrl?: string; thumbUrl?: string } = {};
      if (!row.mediaUrl && row.storageId) {
        const url = await ctx.storage.getUrl(row.storageId);
        if (url) patch.mediaUrl = url;
      }
      if (!row.thumbUrl && row.thumbStorageId) {
        const url = await ctx.storage.getUrl(row.thumbStorageId);
        if (url) patch.thumbUrl = url;
      }
      if (patch.mediaUrl !== undefined || patch.thumbUrl !== undefined) {
        await ctx.db.patch(row._id, patch);
        processed++;
      }
    }

    return {
      done: page.isDone,
      continueCursor: page.continueCursor,
      processed,
    };
  },
});

/**
 * One-time backfill for `profiles.postStreakDays` / `.postStreakComputedAt` —
 * the denormalised author post-streak gymFeed.listFeed reads in O(1) instead
 * of scanning each author's post history per feed page.
 *
 * For each profile, computes the consecutive-day post streak as of today
 * (capped at 365, walking backward from today over the user's
 * `session_media.capturedAt` dates; today not yet posted doesn't break the
 * streak) and patches both fields. Bounded: reads at most ~366 of the user's
 * most-recent posts via `by_user_created`. Rows already computed today are
 * skipped. Paginated + resumable via a `cursor` arg, mirroring the
 * `migrations.ts` contract.
 *
 * Run via:
 *   npx convex run feedMaintenance:backfillPostStreaks '{"cursor":null}'
 *   …repeat with the returned continueCursor until done.
 */
const STREAK_CAP_DAYS = 365;
const STREAK_READ_LIMIT = 366;

export const backfillPostStreaks = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("profiles")
      .paginate({ cursor, numItems: 100 });

    const today = todayDateKey();
    let processed = 0;
    for (const profile of page.page) {
      // Already refreshed today — idempotent skip on re-runs.
      if (profile.postStreakComputedAt === today) continue;

      // Read at most the most-recent ~366 posts; nobody has a 2-year streak.
      const rows = await ctx.db
        .query("session_media")
        .withIndex("by_user_created", (q) => q.eq("userId", profile.userId))
        .order("desc")
        .take(STREAK_READ_LIMIT);

      const dateSet = new Set(rows.map((r) => r.capturedAt));
      const cwsr = new Date();
      cwsr.setUTCHours(0, 0, 0, 0);
      const todayKey = cwsr.toISOString().slice(0, DATE_KEY_LEN);
      // Streak preserved when today hasn't been posted yet.
      if (!dateSet.has(todayKey)) cwsr.setUTCDate(cwsr.getUTCDate() - 1);

      let streak = 0;
      for (let i = 0; i < STREAK_CAP_DAYS; i++) {
        const key = cwsr.toISOString().slice(0, DATE_KEY_LEN);
        if (dateSet.has(key)) {
          streak += 1;
          cwsr.setUTCDate(cwsr.getUTCDate() - 1);
        } else {
          break;
        }
      }

      await ctx.db.patch(profile._id, {
        postStreakDays: streak,
        postStreakComputedAt: today,
      });
      processed++;
    }

    return {
      done: page.isDone,
      continueCursor: page.continueCursor,
      processed,
    };
  },
});

// Key for the "feedEligible backfill complete" flag in feed_cron_state. When
// its `flag` is true, gymFeed.listFeed switches to the by_gym_feed indexed read.
const FEED_ELIGIBLE_READY_KEY = "feedEligibleReady";

/**
 * Feed-eligibility predicate — the SINGLE source of truth, mirrored EXACTLY by
 * gymFeed.listFeed's in-memory filter (visibility != private, not soft-deleted,
 * real storageId) plus "belongs to a gym". createPost and the soft-delete /
 * restore paths set `feedEligible` to this; the indexed read trusts it.
 */
function isFeedEligible(row: Doc<"session_media">): boolean {
  return (
    row.gymId !== undefined &&
    row.storageId !== undefined &&
    row.visibility !== "private" &&
    row.deletedAt === undefined
  );
}

/**
 * One-time backfill for `session_media.feedEligible`. Sets the flag on every
 * row to match the live feed filter, and — only once the FINAL page is reached
 * — flips the `feedEligibleReady` flag in `feed_cron_state` to `true`, the
 * signal for gymFeed.listFeed to switch from the by_gym_created scan to the
 * by_gym_feed indexed read. Until then the old read path stays active, so no
 * un-backfilled row is ever wrongly hidden. Paginated + resumable.
 *
 * Run via:
 *   npx convex run feedMaintenance:backfillFeedEligible '{"cursor":null}'
 *   …repeat with the returned continueCursor until done. The flag flips on the
 *   run that returns done:true.
 */
export const backfillFeedEligible = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("session_media")
      .paginate({ cursor, numItems: 200 });

    let processed = 0;
    for (const row of page.page) {
      const eligible = isFeedEligible(row);
      if (row.feedEligible !== eligible) {
        await ctx.db.patch(row._id, { feedEligible: eligible });
        processed++;
      }
    }

    if (page.isDone) {
      const existing = await ctx.db
        .query("feed_cron_state")
        .withIndex("by_key", (q) => q.eq("key", FEED_ELIGIBLE_READY_KEY))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { flag: true, updatedAt: Date.now() });
      } else {
        await ctx.db.insert("feed_cron_state", {
          key: FEED_ELIGIBLE_READY_KEY,
          flag: true,
          updatedAt: Date.now(),
        });
      }
    }

    return {
      done: page.isDone,
      continueCursor: page.continueCursor,
      processed,
    };
  },
});
