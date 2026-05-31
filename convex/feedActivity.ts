/**
 * Activity feed — likes and comments on the viewer's own posts.
 *
 * Design:
 *  - Likes are grouped per post (top-3 most-recent actors + total count)
 *    so a post with 50 likes renders as one notification item, not 50.
 *  - Comments are listed individually so the body preview is actionable.
 *  - Sorted descending by latest interaction time.
 *  - Bounded: we look at the most-recent 50 authored posts per gym, then
 *    fan-out fetch likes + comments. Fine for active users without
 *    blowing the read budget.
 *
 * Index notes (actual schema):
 *  - feed_likes: no `by_post` index; uses `by_post_user` with only the
 *    postId equality predicate, which Convex accepts as a prefix scan.
 *  - feed_comments: has `by_post` index — used directly.
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
}

interface CommentItem {
  kind: "comment";
  post: PostBrief;
  actor: ActorBrief;
  commentId: Id<"feed_comments">;
  bodyPreview: string;    // truncated to ~140 chars
  createdAt: number;
}

export type ActivityItem = LikeGroup | CommentItem;

/**
 * List activity (likes and comments) on the viewer's own posts in the
 * given gym. Likes are grouped per post (top 3 most-recent actors plus a
 * total count). Comments are listed individually. The returned array is
 * sorted by latest interaction time descending.
 *
 * Bounded: we look at the most-recent 50 posts the viewer authored in
 * this gym, then fan-out fetch likes + comments. For active users that
 * is plenty of history without blowing the read budget.
 */
export const listActivity = query({
  args: { gymId: v.id("gyms") },
  handler: async (ctx, { gymId }) => {
    const { userId: viewerId } = await requireGymViewer(ctx, gymId);

    // 1. Get the viewer's most-recent 50 posts in this gym.
    const myPosts = await ctx.db
      .query("session_media")
      .withIndex("by_user_created", (q) => q.eq("userId", viewerId))
      .order("desc")
      .take(50);
    const myPostsInGym = myPosts.filter(
      (p) => p.gymId === gymId && p.deletedAt === undefined,
    );
    if (myPostsInGym.length === 0) return [] as ActivityItem[];

    const postIds = myPostsInGym.map((p) => p._id);
    const postById = new Map(myPostsInGym.map((p) => [p._id, p]));

    // 2. Fan-out fetch likes and comments per post.
    //    feed_likes has no `by_post` index — use `by_post_user` with only
    //    the postId prefix (Convex allows a partial equality prefix scan).
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
        items.push({
          kind: "likes",
          post: brief,
          actors: topActors,
          totalCount: likeRows.length,
          latestAt: likeRows[0]._creationTime,
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
        });
      }
    }

    // 6. Sort descending by latest interaction time.
    items.sort((a, b) => {
      const at = a.kind === "likes" ? a.latestAt : a.createdAt;
      const bt = b.kind === "likes" ? b.latestAt : b.createdAt;
      return bt - at;
    });

    return items;
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
    if (myPostIds.length === 0) return 0;

    let count = 0;
    for (const postId of myPostIds) {
      // feed_likes: use by_post_user prefix scan then filter in memory
      const newLikes = await ctx.db
        .query("feed_likes")
        .withIndex("by_post_user", (q) => q.eq("postId", postId))
        .filter((q) => q.gt(q.field("_creationTime"), since))
        .collect();
      const newComments = await ctx.db
        .query("feed_comments")
        .withIndex("by_post", (q) => q.eq("postId", postId))
        .filter((q) => q.gt(q.field("_creationTime"), since))
        .collect();
      count += newLikes.filter((l) => l.userId !== viewerId).length;
      count += newComments.filter((c) => c.userId !== viewerId).length;
    }
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
