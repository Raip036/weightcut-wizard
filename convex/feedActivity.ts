/**
 * Activity feed — likes, comments, emoji reactions on the viewer's own
 * posts, plus new-teammate-joined notifications for the viewer's gym.
 *
 * Design:
 *  - Likes are grouped per post (top-3 most-recent actors + total count)
 *    so a post with 50 likes renders as one notification item, not 50.
 *  - Reactions are grouped per (post, emoji slug): one item per distinct
 *    emoji on a post with the top-3 most-recent actors + total count.
 *  - Comments are listed individually so the body preview is actionable.
 *  - Member-joined items surface athletes who joined the gym in the last
 *    30 days (one item each, capped at 20).
 *  - Every item carries a unified `ts` sort timestamp so the client can
 *    group/sort and compute the unread "New" band trivially.
 *  - Sorted descending by `ts`.
 *  - Bounded: we look at the most-recent 50 authored posts per gym, then
 *    fan-out fetch likes + comments + reactions; member joins are capped
 *    at 20. Fine for active users without blowing the read budget.
 *
 * Index notes (actual schema):
 *  - feed_likes: no `by_post` index; uses `by_post_user` with only the
 *    postId equality predicate, which Convex accepts as a prefix scan.
 *  - feed_reactions: uses `by_post_key` with only the postId equality
 *    predicate (postId-only prefix scan), same pattern as the likes.
 *  - feed_comments: has `by_post` index — used directly.
 *  - gym_members: has `by_gym` index — used directly.
 *  - session_media: has `by_user_created` index.
 *  - profiles: has `by_user` index.
 */
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import { requireGymViewer } from "./lib/gymAccess";
import type { Id, Doc } from "./_generated/dataModel";

interface ActorBrief {
  userId: Id<"users">;
  displayName: string;
  avatarUrl: string | null;
}

interface PostBrief {
  postId: Id<"session_media">;
  thumbUrl: string | null;
  thumbDataUrl: string | null;
}

interface LikeGroup {
  kind: "likes";
  post: PostBrief;
  actors: ActorBrief[];   // up to 3 most-recent actors
  totalCount: number;     // total non-self likes on this post
  latestAt: number;       // _creationTime of the most recent like
  ts: number;             // unified sort timestamp (= latestAt)
}

interface CommentItem {
  kind: "comment";
  post: PostBrief;
  actor: ActorBrief;
  commentId: Id<"feed_comments">;
  bodyPreview: string;    // truncated to ~140 chars
  createdAt: number;
  ts: number;             // unified sort timestamp (= createdAt)
}

interface ReactionGroup {
  kind: "reactions";
  post: PostBrief;
  actors: ActorBrief[];   // up to 3 most-recent actors for this emoji
  emojiKey: string;       // emoji slug (e.g. "fire")
  totalCount: number;     // total non-self reactions of this slug on the post
  latestAt: number;       // newest reaction `createdAt` for this (post, key)
  ts: number;             // unified sort timestamp (= latestAt)
}

interface MemberJoined {
  kind: "member_joined";
  actor: ActorBrief;
  joinedAt: number;       // `joinedAt` of the new membership
  ts: number;             // unified sort timestamp (= joinedAt)
}

export type ActivityItem =
  | LikeGroup
  | CommentItem
  | ReactionGroup
  | MemberJoined;

/**
 * List activity (likes, comments, reactions, and new-teammate joins) for
 * the viewer in the given gym. Likes are grouped per post (top 3
 * most-recent actors plus a total count). Reactions are grouped per
 * (post, emoji slug). Comments are listed individually. Member joins are
 * surfaced one per new member. Every item carries a unified `ts`. The
 * returned `items` array is sorted by `ts` descending, and `lastSeenAt`
 * is the viewer's `lastActivitySeenAt` so the client can render the
 * unread "New" band.
 *
 * Bounded: we look at the most-recent 50 posts the viewer authored in
 * this gym, then fan-out fetch likes + comments + reactions; member joins
 * are capped at 20. For active users that is plenty of history without
 * blowing the read budget.
 */
export const listActivity = query({
  args: { gymId: v.id("gyms") },
  handler: async (
    ctx,
    { gymId },
  ): Promise<{ items: ActivityItem[]; lastSeenAt: number }> => {
    const { userId: viewerId } = await requireGymViewer(ctx, gymId);

    // 0. Viewer profile → lastActivitySeenAt for the unread "New" band.
    const viewerProfile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", viewerId))
      .unique();
    const lastSeenAt = viewerProfile?.lastActivitySeenAt ?? 0;

    // 1. Get the viewer's most-recent 50 posts in this gym.
    const myPosts = await ctx.db
      .query("session_media")
      .withIndex("by_user_created", (q) => q.eq("userId", viewerId))
      .order("desc")
      .take(50);
    const myPostsInGym = myPosts.filter(
      (p) => p.gymId === gymId && p.deletedAt === undefined,
    );

    const postIds = myPostsInGym.map((p) => p._id);
    const postById = new Map(myPostsInGym.map((p) => [p._id, p]));

    // 2. Fan-out fetch likes, comments, and reactions per post.
    //    feed_likes / feed_reactions have no `by_post` index — use
    //    `by_post_user` / `by_post_key` with only the postId prefix
    //    (Convex allows a partial equality prefix scan).
    const likesByPost = await Promise.all(
      postIds.map((postId) =>
        ctx.db
          .query("feed_likes")
          .withIndex("by_post_user", (q) => q.eq("postId", postId))
          .order("desc")
          .take(100),
      ),
    );
    const commentsByPost = await Promise.all(
      postIds.map((postId) =>
        ctx.db
          .query("feed_comments")
          .withIndex("by_post", (q) => q.eq("postId", postId))
          .order("desc")
          .take(50),
      ),
    );
    const reactionsByPost = await Promise.all(
      postIds.map((postId) =>
        ctx.db
          .query("feed_reactions")
          .withIndex("by_post_key", (q) => q.eq("postId", postId))
          .order("desc")
          .take(100),
      ),
    );

    // 2b. New teammates: athletes who joined this gym in the last 30 days.
    const memberJoinCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentMembers = (
      await ctx.db
        .query("gym_members")
        .withIndex("by_gym", (q) => q.eq("gymId", gymId))
        .order("desc")
        .take(200)
    )
      .filter(
        (m) =>
          m.status === "active" &&
          m.userId !== viewerId &&
          m.joinedAt > memberJoinCutoff,
      )
      .sort((a, b) => b.joinedAt - a.joinedAt)
      .slice(0, 20);

    // 3. Build a map of actor profiles + avatar URLs, excluding the viewer
    //    themselves (self-engagement never surfaces in the activity feed).
    const allActorIds = new Set<Id<"users">>();
    likesByPost.forEach((rows) =>
      rows.forEach((l) => {
        if (l.userId !== viewerId) allActorIds.add(l.userId);
      }),
    );
    commentsByPost.forEach((rows) =>
      rows.forEach((c) => {
        if (c.userId !== viewerId) allActorIds.add(c.userId);
      }),
    );
    reactionsByPost.forEach((rows) =>
      rows.forEach((r) => {
        if (r.userId !== viewerId) allActorIds.add(r.userId);
      }),
    );
    recentMembers.forEach((m) => allActorIds.add(m.userId));

    const actorIds = [...allActorIds];
    const actorProfiles = await Promise.all(
      actorIds.map((uid) =>
        ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", uid))
          .unique(),
      ),
    );
    const actorAvatarUrls = await Promise.all(
      actorProfiles.map((p) =>
        p?.avatarStorageId
          ? ctx.storage.getUrl(p.avatarStorageId)
          : Promise.resolve(null),
      ),
    );
    const actorMap = new Map<Id<"users">, ActorBrief>(
      actorIds.map((uid, i) => [
        uid,
        {
          userId: uid,
          displayName: actorProfiles[i]?.displayName ?? "Athlete",
          avatarUrl: actorAvatarUrls[i] ?? null,
        },
      ]),
    );

    // 4. Resolve post thumbnails (cached so each post resolves at most once).
    const postThumbCache = new Map<Id<"session_media">, PostBrief>();
    async function getPostBrief(
      post: Doc<"session_media">,
    ): Promise<PostBrief> {
      const cached = postThumbCache.get(post._id);
      if (cached) return cached;
      const sid = post.thumbStorageId ?? post.storageId;
      const thumbUrl = sid ? await ctx.storage.getUrl(sid) : null;
      const brief: PostBrief = {
        postId: post._id,
        thumbUrl,
        thumbDataUrl: post.thumbDataUrl ?? null,
      };
      postThumbCache.set(post._id, brief);
      return brief;
    }

    // 5. Assemble activity items.
    const items: ActivityItem[] = [];

    for (let i = 0; i < postIds.length; i++) {
      const postId = postIds[i];
      const post = postById.get(postId)!;
      const likeRows = likesByPost[i].filter((l) => l.userId !== viewerId);
      const commentRows = commentsByPost[i].filter(
        (c) => c.userId !== viewerId,
      );

      if (likeRows.length > 0) {
        const brief = await getPostBrief(post);
        const topActors = likeRows
          .slice(0, 3)
          .map((l) => actorMap.get(l.userId)!)
          .filter(Boolean);
        const latestAt = likeRows[0]._creationTime;
        items.push({
          kind: "likes",
          post: brief,
          actors: topActors,
          totalCount: likeRows.length,
          latestAt,
          ts: latestAt,
        });
      }

      // Reactions: group per emoji slug (`key`). Rows are already DESC by
      // createdAt, so the first occurrence of a key is its newest reaction.
      const reactionRows = reactionsByPost[i].filter(
        (r) => r.userId !== viewerId,
      );
      const byKey = new Map<
        string,
        { rows: typeof reactionRows; latestAt: number }
      >();
      for (const r of reactionRows) {
        const group = byKey.get(r.key);
        if (group) {
          group.rows.push(r);
          if (r.createdAt > group.latestAt) group.latestAt = r.createdAt;
        } else {
          byKey.set(r.key, { rows: [r], latestAt: r.createdAt });
        }
      }
      for (const [emojiKey, group] of byKey) {
        const brief = await getPostBrief(post);
        const topActors = group.rows
          .slice(0, 3)
          .map((r) => actorMap.get(r.userId)!)
          .filter(Boolean);
        items.push({
          kind: "reactions",
          post: brief,
          actors: topActors,
          emojiKey,
          totalCount: group.rows.length,
          latestAt: group.latestAt,
          ts: group.latestAt,
        });
      }

      for (const c of commentRows) {
        const brief = await getPostBrief(post);
        const actor = actorMap.get(c.userId);
        if (!actor) continue;
        const body = c.body ?? "";
        items.push({
          kind: "comment",
          post: brief,
          actor,
          commentId: c._id,
          bodyPreview:
            body.length > 140 ? body.slice(0, 137) + "..." : body,
          createdAt: c._creationTime,
          ts: c._creationTime,
        });
      }
    }

    // 5b. New-teammate-joined items (one per recent member).
    for (const m of recentMembers) {
      const actor = actorMap.get(m.userId);
      if (!actor) continue;
      items.push({
        kind: "member_joined",
        actor,
        joinedAt: m.joinedAt,
        ts: m.joinedAt,
      });
    }

    // 6. Sort descending by unified timestamp.
    items.sort((a, b) => b.ts - a.ts);

    return { items, lastSeenAt };
  },
});

/**
 * Number of activity items newer than the viewer's `lastActivitySeenAt`
 * timestamp. Drives the unread badge on the bell icon.
 */
export const unreadActivityCount = query({
  args: { gymId: v.id("gyms") },
  handler: async (ctx, { gymId }) => {
    const { userId: viewerId } = await requireGymViewer(ctx, gymId);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", viewerId))
      .unique();
    const since = profile?.lastActivitySeenAt ?? 0;

    const myPosts = await ctx.db
      .query("session_media")
      .withIndex("by_user_created", (q) => q.eq("userId", viewerId))
      .order("desc")
      .take(50);
    const myPostIds = myPosts
      .filter((p) => p.gymId === gymId && p.deletedAt === undefined)
      .map((p) => p._id);

    // The bell (ActivityBell) renders "99+" for any count over 99, so an exact
    // count past that is never shown. Cap each per-post read at DISPLAY_CAP+1
    // and stop early once we cross the cap — this bounds a previously-unbounded
    // per-post `.collect()` (a viral post could otherwise scan hundreds of
    // rows) WITHOUT changing anything the UI displays.
    const DISPLAY_CAP = 99;
    let count = 0;
    for (const postId of myPostIds) {
      if (count > DISPLAY_CAP) break;
      // feed_likes: use by_post_user prefix scan then filter in memory
      const newLikes = await ctx.db
        .query("feed_likes")
        .withIndex("by_post_user", (q) => q.eq("postId", postId))
        .filter((q) => q.gt(q.field("_creationTime"), since))
        .take(DISPLAY_CAP + 1);
      const newComments = await ctx.db
        .query("feed_comments")
        .withIndex("by_post", (q) => q.eq("postId", postId))
        .filter((q) => q.gt(q.field("_creationTime"), since))
        .take(DISPLAY_CAP + 1);
      // feed_reactions: by_post_key prefix scan; `createdAt` is an explicit
      // field (not _creationTime), so compare against it.
      const newReactions = await ctx.db
        .query("feed_reactions")
        .withIndex("by_post_key", (q) => q.eq("postId", postId))
        .filter((q) => q.gt(q.field("createdAt"), since))
        .take(DISPLAY_CAP + 1);
      count += newLikes.filter((l) => l.userId !== viewerId).length;
      count += newComments.filter((c) => c.userId !== viewerId).length;
      count += newReactions.filter((r) => r.userId !== viewerId).length;
    }

    // New teammates who joined since `since` (status active, non-self).
    // Bounded: by_gym has no time-ordered index, so scan newest-created
    // first and cap the read, then filter in memory.
    const newMembers = await ctx.db
      .query("gym_members")
      .withIndex("by_gym", (q) => q.eq("gymId", gymId))
      .order("desc")
      .filter((q) => q.gt(q.field("joinedAt"), since))
      .take(200);
    count += newMembers.filter(
      (m) => m.status === "active" && m.userId !== viewerId,
    ).length;

    return count;
  },
});

/**
 * Stamp lastActivitySeenAt to now so the unread badge clears. Called
 * when the user opens the activity sheet.
 */
export const markActivitySeen = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return null;
    await ctx.db.patch(profile._id, { lastActivitySeenAt: Date.now() });
    return null;
  },
});
