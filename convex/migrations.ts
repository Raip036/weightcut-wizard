import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { resolveActiveCampId } from "./fight_camp";

/**
 * One-time backfill that stamps `gymId` on existing `fight_camp_calendar`
 * rows by looking up each user's primary active gym_members row.
 *
 * Paginated and resumable via a `cursor` arg. Caller passes the previous
 * `continueCursor` back in until the mutation returns `done: true`.
 *
 * Run via:
 *   npx convex run migrations:backfillGymIdOnCalendar '{"cursor":null}'
 *   …repeat with the returned continueCursor until done.
 */
export const backfillGymIdOnCalendar = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("fight_camp_calendar")
      .paginate({ cursor, numItems: 200 });

    let stamped = 0;
    let skipped = 0;
    for (const row of page.page) {
      if (row.gymId) {
        skipped++;
        continue;
      }
      const membership = await ctx.db
        .query("gym_members")
        .withIndex("by_user", (q) => q.eq("userId", row.userId))
        .filter((q) => q.eq(q.field("status"), "active"))
        .first();
      if (!membership) {
        skipped++;
        continue;
      }
      await ctx.db.patch(row._id, { gymId: membership.gymId });
      stamped++;
    }

    return {
      stamped,
      skipped,
      done: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/**
 * Resumable backfill for `session_media.thumbStorageId` / `.thumbDataUrl`.
 *
 * Scope (v1, deliberately minimal):
 *   - Cursor-paginates `session_media` rows where `thumbStorageId` is
 *     missing.
 *   - Does NOT do server-side image processing — generating a 256px
 *     JPEG thumb requires Sharp/wasm + fetching the full asset out of
 *     Convex File Storage, which is heavy enough to be its own
 *     follow-up. v1 just marks rows as "thumb-pending" by leaving
 *     `thumbStorageId` undefined; the client falls back to the full
 *     image (the schema field is `v.optional`, and `gymFeed.listFeed`
 *     / `listProfilePosts` both already guard with `?? null`).
 *   - Future v2 will replace this body with a real action that calls
 *     out to a thumbnail service; the function signature + cursor
 *     contract stays identical so existing harness scripts keep
 *     working.
 *
 * Resumability mirrors `backfillGymIdOnCalendar`: caller passes the
 * previous `continueCursor` back until the mutation returns
 * `done: true`.
 *
 * Run via:
 *   npx convex run migrations:backfillSessionMediaThumbs '{"cursor":null}'
 *   …repeat with the returned continueCursor until done.
 */
export const backfillSessionMediaThumbs = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("session_media")
      .paginate({ cursor, numItems: 200 });

    // `touched` reserved for v2 — once a real thumb generator is wired
    // up, increment it on each successful patch so the runtime log
    // distinguishes "examined" from "actually-updated". v1 leaves it
    // at zero by design; the field is still returned so callers don't
    // need to special-case the v1 vs v2 response shape.
    const touched = 0;
    let skipped = 0;
    for (const row of page.page) {
      // Already has a thumb — nothing to do. Idempotent on re-runs.
      if (row.thumbStorageId || row.thumbDataUrl) {
        skipped++;
        continue;
      }
      // v1 no-op: we intentionally leave `thumbStorageId` /
      // `thumbDataUrl` unset so the client falls back to the full
      // image.
      skipped++;
    }

    return {
      touched,
      skipped,
      done: page.isDone,
      continueCursor: page.continueCursor,
      note: "v1 scaffold — no server-side thumbnail generation yet",
    };
  },
});

/**
 * One-time backfill that stamps `campId` on existing `user_discipline_xp`
 * rows by resolving each user's active camp (soonest non-completed upcoming
 * camp, else most-recent).
 *
 * Self-healing / merge-on-collision: between the schema deploy and the moment
 * this finishes, a user with a legacy (campId-unset) row can earn XP — which
 * inserts a *new* camp-scoped row because `awardXp` looks up
 * `by_user_camp_sport (userId, campId, sport)` and the legacy row (campId
 * undefined) doesn't match. If we then blindly patch the legacy row's campId
 * we'd create TWO rows for the same (userId, campId, sport) and permanently
 * split the total. So before patching we look for an existing camp-scoped row:
 *   - if one exists, fold the legacy `totalXp` into it (keeping the max
 *     `updatedAt`) and DELETE the legacy row;
 *   - otherwise patch the legacy row's `campId`.
 * Rows already carrying a `campId`, and users with no camp, are skipped.
 * Idempotent + paginated.
 *
 * Deploy order: deploy the schema (campId + indexes) FIRST, then run this to
 * `done:true`, then run `backfillCampIdOnSparring` to `done:true`.
 *
 * Run via:
 *   npx convex run migrations:backfillCampIdOnXpAndSparring '{"cursor":null}'
 *   …repeat with the returned continueCursor until done.
 */
export const backfillCampIdOnXpAndSparring = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("user_discipline_xp")
      .paginate({ cursor, numItems: 200 });
    let stamped = 0;
    let merged = 0;
    let skipped = 0;
    const campCache = new Map<string, Id<"fight_camps"> | undefined>();
    for (const row of page.page) {
      if (row.campId) {
        skipped++;
        continue;
      }
      let campId = campCache.get(row.userId);
      if (campId === undefined && !campCache.has(row.userId)) {
        campId = await resolveActiveCampId(ctx, row.userId);
        campCache.set(row.userId, campId);
      }
      if (!campId) {
        skipped++;
        continue;
      }

      // Is there already a camp-scoped row for (userId, campId, sport)?
      const existing = await ctx.db
        .query("user_discipline_xp")
        .withIndex("by_user_camp_sport", (q) =>
          q
            .eq("userId", row.userId)
            .eq("campId", campId)
            .eq("sport", row.sport),
        )
        .first();

      if (existing && existing._id !== row._id) {
        // Collision — fold this legacy row's XP into the camp-scoped row and
        // remove the duplicate so totals can't stay split.
        await ctx.db.patch(existing._id, {
          totalXp: existing.totalXp + row.totalXp,
          updatedAt: Math.max(existing.updatedAt, row.updatedAt),
        });
        await ctx.db.delete(row._id);
        merged++;
      } else {
        await ctx.db.patch(row._id, { campId });
        stamped++;
      }
    }
    return {
      done: page.isDone,
      continueCursor: page.continueCursor,
      stamped,
      merged,
      skipped,
    };
  },
});

/**
 * Sibling backfill for `sparring_assignments`. Same self-healing contract as
 * `backfillCampIdOnXpAndSparring`, keyed on `by_user_camp_norm`
 * (userId, campId, techniqueNormalized). On collision we KEEP the row with the
 * stronger progress (higher `landedCount`, mastery wins) and delete the other,
 * so a re-earn's checkbox/landing state isn't lost. Own paginator so each
 * stays simple. Idempotent + paginated.
 *
 * Run via:
 *   npx convex run migrations:backfillCampIdOnSparring '{"cursor":null}'
 *   …repeat with the returned continueCursor until done.
 */
export const backfillCampIdOnSparring = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("sparring_assignments")
      .paginate({ cursor, numItems: 200 });
    let stamped = 0;
    let merged = 0;
    let skipped = 0;
    const campCache = new Map<string, Id<"fight_camps"> | undefined>();
    for (const row of page.page) {
      if (row.campId) {
        skipped++;
        continue;
      }
      let campId = campCache.get(row.userId);
      if (campId === undefined && !campCache.has(row.userId)) {
        campId = await resolveActiveCampId(ctx, row.userId);
        campCache.set(row.userId, campId);
      }
      if (!campId) {
        skipped++;
        continue;
      }

      const existing = await ctx.db
        .query("sparring_assignments")
        .withIndex("by_user_camp_norm", (q) =>
          q
            .eq("userId", row.userId)
            .eq("campId", campId)
            .eq("techniqueNormalized", row.techniqueNormalized),
        )
        .first();

      if (existing && existing._id !== row._id) {
        // Collision — keep whichever row has more progress, drop the other.
        const score = (r: typeof row) =>
          (r.masteredAt != null ? 1_000_000 : 0) + (r.landedCount ?? 0);
        if (score(row) > score(existing)) {
          // The legacy row is further along — promote it, delete the new one.
          await ctx.db.delete(existing._id);
          await ctx.db.patch(row._id, { campId });
          stamped++;
        } else {
          await ctx.db.delete(row._id);
          merged++;
        }
      } else {
        await ctx.db.patch(row._id, { campId });
        stamped++;
      }
    }
    return {
      done: page.isDone,
      continueCursor: page.continueCursor,
      stamped,
      merged,
      skipped,
    };
  },
});
