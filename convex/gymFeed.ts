/**
 * Gym social feed — Instagram/TikTok-style chronological surface of every
 * gym member's training-session media.
 *
 * Architecture (see data-model brainstorm in the audit report):
 *
 *   ┌──────────────────┐   uploadSessionMediaV2   ┌─────────────────────┐
 *   │ fighter taps     │ ───────────────────────▶ │ session_media row   │
 *   │ "Add photo"      │                          │ (gymId stamped at   │
 *   └──────────────────┘                          │  insert time)       │
 *                                                 └─────────────────────┘
 *                                                          │
 *                                                          ▼
 *   ┌──────────────────┐    listFeed(gymId)        ┌─────────────────────┐
 *   │ gym member opens │ ─────────────────────────▶│ by_gym_created      │
 *   │ feed page        │ ◀─────────────────────────│ index scan (DESC)    │
 *   └──────────────────┘    paginated cursor       │ → 20 docs + author/  │
 *                                                  │   session join       │
 *                                                  └─────────────────────┘
 *
 * Why no separate `gym_feed_posts` denormalised table:
 *   - 1k users / 100 gyms / 100 posts/day/gym = ~10k posts/day. A fan-out
 *     write to every member would explode writes; a single index row per
 *     post is enough because the feed is whole-gym public.
 *   - The `by_gym_created` index turns "newest 20 in gym X" into exactly
 *     20 doc reads + 40 join reads (author + session metadata) per page.
 *
 * Out of scope for v1 (deferred): likes, comments, reposts, per-post
 * privacy toggle, push notifications. Schema supports adding all of these
 * later without a migration.
 */
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Id, Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import { requireGymViewer } from "./lib/gymAccess";

/**
 * Consecutive-day post streak for one user, capped at 365. Walks backward
 * from today through the user's `session_media.capturedAt` dates and
 * stops on the first day with no post.
 *
 * Window-limited to the last 366 days so we never scan a fighter's full
 * history; nobody has a 2-year posting streak.
 */
const STREAK_WINDOW_DAYS = 366;
async function computeAuthorStreak(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<number> {
  const windowMs = STREAK_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;
  const rows = await ctx.db
    .query("session_media")
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .order("desc")
    .filter((q) => q.gte(q.field("_creationTime"), cutoff))
    .collect();
  if (rows.length === 0) return 0;

  const dateSet = new Set(rows.map((r: Doc<"session_media">) => r.capturedAt));
  // Streak preserved when today hasn't been posted yet — match the
  // existing wellness streak ergonomic so a fighter checking the feed
  // before their evening session doesn't see their flame already zeroed.
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  const todayKey = cursor.toISOString().slice(0, 10);
  if (!dateSet.has(todayKey)) cursor.setUTCDate(cursor.getUTCDate() - 1);

  let streak = 0;
  for (let i = 0; i < STREAK_WINDOW_DAYS; i++) {
    const key = cursor.toISOString().slice(0, 10);
    if (dateSet.has(key)) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

// ─── Local rate-limit helper ───────────────────────────────────────────
//
// `convex/rate_limits.ts` exposes a `consume` internalMutation that's
// only callable via `ctx.runMutation` from actions. The post-create
// path runs entirely inside a single user-facing mutation transaction,
// so we inline a minimal token-bucket implementation against the same
// `rate_limits` table here. Schema + bucket semantics match
// `rate_limits.consume` exactly so the two surfaces are interchangeable
// from the caller's perspective.
async function consumeRateLimit(
  ctx: MutationCtx,
  userId: Awaited<ReturnType<typeof requireUserId>>,
  functionName: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const now = Date.now();
  const existing = await ctx.db
    .query("rate_limits")
    .withIndex("by_user_function", (q) =>
      q.eq("userId", userId).eq("functionName", functionName),
    )
    .unique();
  if (!existing) {
    await ctx.db.insert("rate_limits", {
      userId,
      functionName,
      requestCount: 1,
      windowStart: now,
    });
    return { allowed: true, remaining: limit - 1 };
  }
  if (now - existing.windowStart > windowMs) {
    await ctx.db.patch(existing._id, { requestCount: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1 };
  }
  if (existing.requestCount >= limit) {
    return { allowed: false, remaining: 0 };
  }
  await ctx.db.patch(existing._id, {
    requestCount: existing.requestCount + 1,
  });
  return { allowed: true, remaining: limit - existing.requestCount - 1 };
}

/** Posts-per-day ceiling per user. Sized so a chatty member who logs
 *  one post per training block still has plenty of headroom; spammers
 *  hit the cap by mid-morning. */
const POST_RATE_LIMIT_PER_DAY = 20;
const POST_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Paginated, newest-first feed of media posts from a single gym. The
 * `cursor` + `numItems` shape matches Convex's standard `paginate()` API
 * so the client can use `usePaginatedQuery` directly.
 *
 * Each returned post carries:
 *  - the resolved media URL (from Convex File Storage)
 *  - a lightweight author block (displayName + avatar URL — no email)
 *  - the parent session's headline metadata (sessionType / RPE / duration)
 *
 * "private" rows and rows whose `gymId` has been nulled by the 90-day
 * archive cron drop out automatically because they're missing from the
 * `by_gym_created` index.
 */
export const listFeed = query({
  args: {
    gymId: v.id("gyms"),
    // Convex's `usePaginatedQuery` injects its own bookkeeping fields
    // (notably `id`) into the paginationOpts payload — using the SDK's
    // canonical validator is the only safe option. Hand-rolling `v.object`
    // here rejects those extra fields with an ArgumentValidationError.
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { gymId, paginationOpts }) => {
    const { userId: viewerId } = await requireGymViewer(ctx, gymId);

    // Bound the page size — clients can request anything but we cap server
    // side so a runaway pagination call can't pull thousands of rows.
    const numItems = Math.min(Math.max(paginationOpts.numItems, 1), 50);

    // Fetch the full set of postIds this viewer has already swiped away so
    // we can drop them from the returned page. Collected once per query;
    // bounded by gym-feed lifetime × members, not by total post count.
    const viewedRows = await ctx.db
      .query("feed_views")
      .withIndex("by_user", (q) => q.eq("userId", viewerId))
      .collect();
    const viewedPostIds = new Set(viewedRows.map((r) => r.postId));

    const page = await ctx.db
      .query("session_media")
      .withIndex("by_gym_created", (q) => q.eq("gymId", gymId))
      .order("desc")
      .filter((q) =>
        q.and(
          q.neq(q.field("visibility"), "private"),
          // Soft-deleted posts (moderation flow / author hide) drop out
          // of every read surface. Hard-delete still available via the
          // 90-day archive cron, which clears `gymId` entirely.
          q.eq(q.field("deletedAt"), undefined),
        ),
      )
      .paginate({ cursor: paginationOpts.cursor, numItems });

    // Filter out posts the viewer has already swiped away. Every viewer
    // (including the author) sees each post exactly once.
    const visiblePage = page.page.filter((m) => !viewedPostIds.has(m._id));

    // Dedupe author lookups: a chatty user posting 5 of the 12 visible
    // polaroids previously caused 5 redundant `profiles.by_user` reads.
    // Collect unique userIds, batch-fetch profiles + avatar URLs once,
    // then read from the map per-post. (Perf P0 — flagged 2026-05-18.)
    const uniqueAuthorIds = [...new Set(visiblePage.map((m) => m.userId))];
    const authorProfiles = await Promise.all(
      uniqueAuthorIds.map((uid) =>
        ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", uid))
          .unique(),
      ),
    );
    const authorAvatarUrls = await Promise.all(
      authorProfiles.map((p) =>
        p?.avatarStorageId
          ? ctx.storage.getUrl(p.avatarStorageId)
          : Promise.resolve(null),
      ),
    );
    // Per-author streak — one walk per unique author per page, not per
    // post. Small gym (4 members) means ~4 lookups per feed page; the
    // window is capped at 366 days so each lookup is bounded.
    const authorStreaks = await Promise.all(
      uniqueAuthorIds.map((uid) => computeAuthorStreak(ctx, uid)),
    );
    const authorMap = new Map(
      uniqueAuthorIds.map((uid, i) => [
        uid,
        {
          profile: authorProfiles[i],
          avatarUrl: authorAvatarUrls[i],
          streakDays: authorStreaks[i],
        },
      ]),
    );

    // Batch-fetch sessions: multiple posts often share the same sessionId
    // (a user posting several photos from one training block). Collecting
    // unique IDs and fetching once mirrors the `uniqueAuthorIds` block above
    // and cuts ~N/2 db.get calls on a typical page.
    const uniqueSessionIds = [...new Set(
      visiblePage.map((m) => m.sessionId).filter(Boolean),
    )];
    const sessionDocs = await Promise.all(
      uniqueSessionIds.map((sid) => ctx.db.get(sid)),
    );
    const sessionMap = new Map(
      uniqueSessionIds.map((sid, i) => [sid, sessionDocs[i]]),
    );

    const posts = await Promise.all(
      visiblePage.map(async (m) => {
        const author = authorMap.get(m.userId);
        const session = sessionMap.get(m.sessionId) ?? null;
        const [viewerLike, mediaUrl, thumbUrl] = await Promise.all([
          // O(1) point lookup — "did the calling user like this post?".
          ctx.db
            .query("feed_likes")
            .withIndex("by_post_user", (q) =>
              q.eq("postId", m._id).eq("userId", viewerId),
            )
            .unique(),
          ctx.storage.getUrl(m.storageId),
          // Hydrate the 256-px thumbnail when available so the client
          // can render stack positions 1/2 from the low-res variant
          // (~70% bandwidth cut on cold launch). Falls through to the
          // full image when the thumb hasn't been backfilled.
          m.thumbStorageId
            ? ctx.storage.getUrl(m.thumbStorageId)
            : Promise.resolve(null),
        ]);
        return {
          id: m._id,
          createdAt: m._creationTime,
          kind: m.kind,
          url: mediaUrl,
          thumbUrl,
          thumbDataUrl: m.thumbDataUrl ?? null,
          caption: m.caption ?? null,
          visibility: (m.visibility ?? "gym") as "gym" | "private",
          author: {
            userId: m.userId,
            displayName: author?.profile?.displayName ?? "Athlete",
            avatarUrl: author?.avatarUrl ?? null,
            streakDays: author?.streakDays ?? 0,
          },
          session: session
            ? {
                id: session._id,
                date: session.date,
                sessionType: session.sessionType,
                rpe: session.rpe,
                durationMinutes: session.durationMinutes,
              }
            : null,
          likeCount: m.likeCount ?? 0,
          commentCount: m.commentCount ?? 0,
          viewerLiked: !!viewerLike,
        };
      }),
    );

    return {
      page: posts,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/**
 * Lightweight version of `listFeed` returning just the latest N posts as
 * thumbnails. Used by the coach dashboard widget to render a horizontal
 * preview row without paginating. Same access check.
 */
export const recentForCoachWidget = query({
  args: { gymId: v.id("gyms"), limit: v.optional(v.number()) },
  handler: async (ctx, { gymId, limit }) => {
    await requireGymViewer(ctx, gymId);
    const cap = Math.min(Math.max(limit ?? 6, 1), 12);
    const rows = await ctx.db
      .query("session_media")
      .withIndex("by_gym_created", (q) => q.eq("gymId", gymId))
      .order("desc")
      .filter((q) =>
        q.and(
          q.neq(q.field("visibility"), "private"),
          q.eq(q.field("deletedAt"), undefined),
        ),
      )
      .take(cap);
    return await Promise.all(
      rows.map(async (m) => ({
        id: m._id,
        kind: m.kind,
        url: await ctx.storage.getUrl(m.storageId),
        createdAt: m._creationTime,
        userId: m.userId,
        // The widget filter already excludes "private" rows at query
        // time, so this is constant-`gym` by construction. Returned
        // anyway so the client shape matches `listFeed` and the
        // type narrows cleanly.
        visibility: "gym" as const,
      })),
    );
  },
});

// ─── Polaroid post creation (Community tab) ────────────────────────────

/**
 * Mint a one-time POST URL for the polaroid upload flow.
 *
 * The client POSTs the image/video bytes to the returned URL and gets
 * back a `storageId` which it then hands to `createPost` along with
 * any optional thumb / dimensions metadata.
 *
 * Auth-only — no gym check here because a user may upload before the
 * post-create call decides which gym (if any) the post lands in.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Create a polaroid post for the gym feed.
 *
 * Contract:
 *  - Caller must be authenticated and (if `visibility === "gym"`) an
 *    active member of some gym — the post is stamped with that gym's
 *    id so the `by_gym_created` index pages it into the feed.
 *  - `visibility === "private"` skips the gym lookup entirely and
 *    inserts a personal-only row (`gymId: undefined`) that still shows
 *    on the author's profile grid but never on a gym feed.
 *  - The referenced `sessionId` must belong to the caller. We don't
 *    cross-check the session's own `gymId` against the resolved one:
 *    a fighter who trains at multiple gyms might log a session under
 *    one gym but post the highlight to their currently-active one.
 *  - Rate-limited to `POST_RATE_LIMIT_PER_DAY` posts per rolling 24h
 *    window per user via the shared `rate_limits` table — spammers hit
 *    the cap fast without breaking legit power-users.
 *
 * Returns the new post id so the client can route to it / optimistic-
 * insert it at the head of the feed.
 */
export const createPost = mutation({
  args: {
    storageId: v.id("_storage"),
    sessionId: v.id("fight_camp_calendar"),
    kind: v.union(v.literal("photo"), v.literal("video")),
    caption: v.optional(v.string()),
    visibility: v.union(v.literal("gym"), v.literal("private")),
    thumbStorageId: v.optional(v.id("_storage")),
    thumbDataUrl: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (
    ctx,
    {
      storageId,
      sessionId,
      kind,
      caption,
      visibility,
      thumbStorageId,
      thumbDataUrl,
      width,
      height,
    },
  ) => {
    const userId = await requireUserId(ctx);

    // Session-ownership check first — cheapest way to reject bad input.
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session not found");
    if (session.userId !== userId) throw new Error("Not authorized");

    // Resolve the gym the post belongs to. For a "gym" post we use the
    // viewer's active membership (the `by_user_status` index makes this
    // one indexed point-lookup). For "private" posts we leave `gymId`
    // undefined so the row never matches a `by_gym_created` scan.
    let gymId = session.gymId;
    gymId = undefined;
    if (visibility === "gym") {
      const membership = await ctx.db
        .query("gym_members")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", userId).eq("status", "active"),
        )
        .first();
      // Prefer the session's own gymId if the user is still active in
      // that gym — keeps the post co-located with the training history.
      if (
        session.gymId &&
        membership &&
        membership.gymId === session.gymId
      ) {
        gymId = session.gymId;
      } else if (membership) {
        gymId = membership.gymId;
      } else {
        throw new Error("Join a gym to post to the feed");
      }
    }

    // Rate-limit AFTER all auth checks so a 401 path never burns a
    // request budget. 20 posts / rolling 24h.
    const limit = await consumeRateLimit(
      ctx,
      userId,
      "gymFeed.createPost",
      POST_RATE_LIMIT_PER_DAY,
      POST_RATE_WINDOW_MS,
    );
    if (!limit.allowed) {
      throw new Error("Daily post limit reached — try again tomorrow");
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const postId = await ctx.db.insert("session_media", {
      sessionId,
      userId,
      storageId,
      kind,
      capturedAt: todayIso,
      caption: caption?.trim() ? caption.trim() : undefined,
      gymId,
      visibility,
      // Cached counters initialised so `likeCount ?? 0` reads stay
      // O(1) and patches in `toggleLike` / `addComment` increment a
      // numeric value (vs. patching from undefined).
      likeCount: 0,
      commentCount: 0,
      thumbStorageId,
      thumbDataUrl,
      width,
      height,
    });

    return { postId };
  },
});

/**
 * Paginated, newest-first list of one user's polaroid posts. Powers
 * the Profile-tab grid.
 *
 * Privacy rule:
 *  - viewer === ownerUserId → all non-soft-deleted posts (public +
 *    private).
 *  - viewer is in the SAME active gym as the owner → only `visibility
 *    === "gym"` posts (private posts hidden).
 *  - otherwise → empty page. We don't 401 because the profile may be
 *    deep-linked from an out-of-gym share; an empty result is a
 *    gentler UX than a hard error.
 *
 * Index choice: `by_user_created` is `(userId, _creationTime)` so this
 * query's reactive scope is bounded to one user. Posting activity in
 * unrelated gyms won't invalidate this query — important for the
 * Profile page which is mounted while the feed page is also active.
 *
 * Hydrates the same shape as `listFeed` (mediaUrl, likeCount,
 * commentCount, author) so the Profile grid + Feed share their tile
 * components without an adapter.
 */
export const listProfilePosts = query({
  args: {
    ownerUserId: v.id("users"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { ownerUserId, paginationOpts }) => {
    const viewerId = await requireUserId(ctx);
    const numItems = Math.min(Math.max(paginationOpts.numItems, 1), 50);

    // Privacy gate: only owner OR same-gym viewer may see the grid.
    const isOwner = viewerId === ownerUserId;
    let canSeePublicPosts = isOwner;
    if (!isOwner) {
      // Resolve viewer's active gyms (typically one row) and check if
      // the owner is an active member of any of them. Both lookups use
      // `by_user_status` for an O(1) indexed scan; in the common case
      // a single point-check via `by_gym_user` would close the deal
      // but the membership table is small enough that the simple path
      // is fast and easy to read.
      const viewerGyms = await ctx.db
        .query("gym_members")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", viewerId).eq("status", "active"),
        )
        .collect();
      for (const vg of viewerGyms) {
        const peer = await ctx.db
          .query("gym_members")
          .withIndex("by_gym_user", (q) =>
            q.eq("gymId", vg.gymId).eq("userId", ownerUserId),
          )
          .unique();
        if (peer && peer.status === "active") {
          canSeePublicPosts = true;
          break;
        }
      }
    }

    if (!canSeePublicPosts) {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
      };
    }

    const page = await ctx.db
      .query("session_media")
      .withIndex("by_user_created", (q) => q.eq("userId", ownerUserId))
      .order("desc")
      .filter((q) =>
        isOwner
          ? // Owner sees everything except soft-deleted rows. Private
            // posts stay visible to the author.
            q.eq(q.field("deletedAt"), undefined)
          : // Same-gym peer sees only non-private, non-deleted rows.
            q.and(
              q.eq(q.field("deletedAt"), undefined),
              q.neq(q.field("visibility"), "private"),
            ),
      )
      .paginate({ cursor: paginationOpts.cursor, numItems });

    // Resolve the author profile ONCE per page (everyone in the page
    // shares the same author by construction). Saves N-1 profile reads.
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", ownerUserId))
      .unique();
    const avatarUrl = profile?.avatarStorageId
      ? await ctx.storage.getUrl(profile.avatarStorageId)
      : null;
    const streakDays = await computeAuthorStreak(ctx, ownerUserId);
    const author = {
      userId: ownerUserId,
      displayName: profile?.displayName ?? "Athlete",
      avatarUrl,
      streakDays,
    };

    const posts = await Promise.all(
      page.page.map(async (m) => {
        const [session, viewerLike, mediaUrl, thumbUrl] = await Promise.all([
          ctx.db.get(m.sessionId),
          ctx.db
            .query("feed_likes")
            .withIndex("by_post_user", (q) =>
              q.eq("postId", m._id).eq("userId", viewerId),
            )
            .unique(),
          ctx.storage.getUrl(m.storageId),
          m.thumbStorageId
            ? ctx.storage.getUrl(m.thumbStorageId)
            : Promise.resolve(null),
        ]);
        return {
          id: m._id,
          createdAt: m._creationTime,
          kind: m.kind,
          url: mediaUrl,
          thumbUrl,
          thumbDataUrl: m.thumbDataUrl ?? null,
          width: m.width ?? null,
          height: m.height ?? null,
          caption: m.caption ?? null,
          visibility: m.visibility ?? "gym",
          author,
          session: session
            ? {
                id: session._id,
                date: session.date,
                sessionType: session.sessionType,
                rpe: session.rpe,
                durationMinutes: session.durationMinutes,
              }
            : null,
          likeCount: m.likeCount ?? 0,
          commentCount: m.commentCount ?? 0,
          viewerLiked: !!viewerLike,
        };
      }),
    );

    return {
      page: posts,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
