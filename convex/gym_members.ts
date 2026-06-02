/**
 * Gym membership queries + mutations.
 *
 * Membership controls coach <-> athlete visibility. `shareData` is the
 * athlete-side privacy gate; flipping it false hides their weight/meal/etc
 * from the coach (enforced in coach.ts aggregation queries).
 */
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import { assertGymOwner, assertGymMember } from "./gyms";

function toClientMember(row: Doc<"gym_members">) {
  return {
    id: row._id,
    gym_id: row.gymId,
    user_id: row.userId,
    member_role: row.memberRole,
    status: row.status,
    share_data: row.shareData,
    joined_at: new Date(row.joinedAt).toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────────────────────────────────

/** Coach-only: list members of a gym (with display_name + avatar joined). */
export const listForGym = query({
  args: { gymId: v.id("gyms") },
  handler: async (ctx, { gymId }) => {
    const userId = await requireUserId(ctx);
    await assertGymOwner(ctx, gymId, userId);

    const members = await ctx.db
      .query("gym_members")
      .withIndex("by_gym", (q) => q.eq("gymId", gymId))
      .collect();

    return Promise.all(
      members.map(async (m) => {
        const profile = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", m.userId))
          .unique();
        const avatarUrl = profile?.avatarStorageId
          ? await ctx.storage.getUrl(profile.avatarStorageId)
          : null;
        return {
          ...toClientMember(m),
          display_name: profile?.displayName ?? null,
          avatar_url: avatarUrl,
        };
      }),
    );
  },
});

/**
 * Member-only: list all active members of a gym the caller belongs to.
 *
 * Mirrors `listForGym` (coach-only) but flips the gate: any active member
 * of the gym may see the roster. Returns the lightweight {userId,
 * displayName, avatarUrl} shape consumed by the GymProfileSheet — we don't
 * leak share_data / member_role / status here, since neither is rendered
 * in the public-to-gym member list.
 *
 * Sorted by joinedAt ascending so longer-tenured members appear first
 * (matches the coach-side list and feels stable as the gym grows).
 */
export const listMembersForActiveMember = query({
  args: { gymId: v.id("gyms") },
  handler: async (ctx, { gymId }) => {
    const userId = await requireUserId(ctx);
    // Caller must be an active member of this gym.
    const membership = await ctx.db
      .query("gym_members")
      .withIndex("by_gym_user", (q) => q.eq("gymId", gymId).eq("userId", userId))
      .first();
    if (!membership || membership.status !== "active") {
      throw new Error("Not authorized");
    }

    const rows = await ctx.db
      .query("gym_members")
      .withIndex("by_gym", (q) => q.eq("gymId", gymId))
      .collect();
    const active = rows
      .filter((r) => r.status === "active")
      .sort((a, b) => a.joinedAt - b.joinedAt);

    return Promise.all(
      active.map(async (r) => {
        const profile = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", r.userId))
          .first();
        let avatarUrl: string | null = null;
        if (profile?.avatarStorageId) {
          avatarUrl = await ctx.storage.getUrl(profile.avatarStorageId);
        }
        return {
          userId: r.userId,
          displayName: profile?.displayName ?? "Member",
          avatarUrl,
        };
      }),
    );
  },
});

/** Current user's membership row for a specific gym (or null). */
export const getMineForGym = query({
  args: { gymId: v.id("gyms") },
  handler: async (ctx, { gymId }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db
      .query("gym_members")
      .withIndex("by_gym_user", (q) =>
        q.eq("gymId", gymId).eq("userId", userId),
      )
      .unique();
    return row ? toClientMember(row) : null;
  },
});

// ─────────────────────────────────────────────────────────────────────────
// MUTATIONS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Coach-only: invite an athlete (or coach) to join a gym. Creates a pending
 * `gym_invites` row that the TARGET user must explicitly accept via
 * `acceptGymInvite` — replaces the prior direct-insert flow that silently
 * added a member with `shareData: true` (i.e. forced data-sharing without
 * consent). The target user retains full control over whether they join AND
 * whether they share data once they accept.
 *
 * If an existing active membership already exists, this is a no-op (returns
 * null) — re-inviting an active member doesn't escalate any state.
 */
export const addMember = mutation({
  args: {
    gymId: v.id("gyms"),
    userId: v.id("users"),
    memberRole: v.union(v.literal("coach"), v.literal("athlete")),
  },
  handler: async (ctx, { gymId, userId: targetUserId, memberRole }) => {
    const userId = await requireUserId(ctx);
    await assertGymOwner(ctx, gymId, userId);

    const existingMember = await ctx.db
      .query("gym_members")
      .withIndex("by_gym_user", (q) =>
        q.eq("gymId", gymId).eq("userId", targetUserId),
      )
      .unique();
    if (existingMember && existingMember.status === "active") {
      return null; // already a member, nothing to do
    }

    const existingInvite = await ctx.db
      .query("gym_invites")
      .withIndex("by_gym_user", (q) =>
        q.eq("gymId", gymId).eq("userId", targetUserId),
      )
      .unique();
    if (existingInvite && existingInvite.status === "pending") {
      return existingInvite._id; // already pending
    }
    if (existingInvite) {
      await ctx.db.patch(existingInvite._id, {
        invitedByUserId: userId,
        memberRole,
        status: "pending",
        createdAt: Date.now(),
      });
      return existingInvite._id;
    }
    return await ctx.db.insert("gym_invites", {
      gymId,
      userId: targetUserId,
      invitedByUserId: userId,
      memberRole,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

/**
 * Target-user only: accept a pending gym invite. Creates an `active`
 * membership with `shareData: false` (opt-in via `updateMyMembership`) and
 * deletes the invite row. Throws if the caller isn't the invite's target.
 */
export const acceptGymInvite = mutation({
  args: { inviteId: v.id("gym_invites") },
  handler: async (ctx, { inviteId }) => {
    const userId = await requireUserId(ctx);
    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new Error("Invite not found");
    if (invite.userId !== userId) {
      throw new Error("Only the invited user can accept this invite");
    }
    if (invite.status !== "pending") {
      throw new Error("Invite is no longer pending");
    }

    const existing = await ctx.db
      .query("gym_members")
      .withIndex("by_gym_user", (q) =>
        q.eq("gymId", invite.gymId).eq("userId", userId),
      )
      .unique();
    let memberId;
    if (existing) {
      await ctx.db.patch(existing._id, {
        memberRole: invite.memberRole,
        status: "active",
        shareData: false, // explicit opt-in required
        joinedAt: Date.now(),
      });
      memberId = existing._id;
    } else {
      memberId = await ctx.db.insert("gym_members", {
        gymId: invite.gymId,
        userId,
        memberRole: invite.memberRole,
        status: "active",
        shareData: false, // explicit opt-in required
        joinedAt: Date.now(),
      });
    }
    await ctx.db.delete(invite._id);
    return memberId;
  },
});

/**
 * Target-user only: decline a pending gym invite. Deletes the invite row;
 * no membership is created.
 */
export const declineGymInvite = mutation({
  args: { inviteId: v.id("gym_invites") },
  handler: async (ctx, { inviteId }) => {
    const userId = await requireUserId(ctx);
    const invite = await ctx.db.get(inviteId);
    if (!invite) return;
    if (invite.userId !== userId) {
      throw new Error("Only the invited user can decline this invite");
    }
    await ctx.db.delete(invite._id);
  },
});

/**
 * Member-only self-service patch over their own gym_members row. Currently
 * just flips `shareData`, but designed as the single mutation a member uses
 * to control their privacy/role state on a gym they belong to. Enforces
 * `auth.userId === row.userId` so a coach can never force a member's
 * privacy toggle.
 */
export const updateMyMembership = mutation({
  args: {
    memberId: v.id("gym_members"),
    shareData: v.optional(v.boolean()),
    /** Coach-only flag: surface the gym social feed on the coach dashboard.
     *  Allowed for any member to toggle on their own row, but only meaningful
     *  for `memberRole: "coach"` (athletes' dashboard doesn't render the
     *  widget). Defaulted to undefined / false; the coach explicitly opts
     *  in from gym settings. */
    feedVisibleOnDashboard: v.optional(v.boolean()),
  },
  handler: async (ctx, { memberId, shareData, feedVisibleOnDashboard }) => {
    const userId = await requireUserId(ctx);
    const member = await ctx.db.get(memberId);
    if (!member) throw new Error("Membership not found");
    if (member.userId !== userId) {
      throw new Error("Only the member can update their own membership");
    }
    const patch: Record<string, unknown> = {};
    if (shareData !== undefined) patch.shareData = shareData;
    if (feedVisibleOnDashboard !== undefined) patch.feedVisibleOnDashboard = feedVisibleOnDashboard;
    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(memberId, patch as any);
  },
});

/** List pending invites for the calling user (target). */
export const listMyInvites = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const invites = await ctx.db
      .query("gym_invites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();
    return Promise.all(
      invites.map(async (i) => {
        const gym = await ctx.db.get(i.gymId);
        return {
          id: i._id,
          gym_id: i.gymId,
          gym_name: gym?.name ?? null,
          member_role: i.memberRole,
          created_at: new Date(i.createdAt).toISOString(),
        };
      }),
    );
  },
});

/**
 * Mark every `session_media` post and `feed_comments` row authored by
 * `userId` inside `gymId` as `authorState: "former_member"`. Used by all
 * three remove-member paths so a departing user's posts continue to
 * render in the gym feed (preserving conversation continuity) while
 * carrying a clear "(former member)" tag on the author overlay.
 *
 * Why not hard-delete? Replies, reactions, and references on neighbouring
 * posts would dangle. Keeping the post + soft-tagging the author is the
 * least surprising behaviour for the rest of the gym.
 *
 * Scope: only rows where `session_media.gymId === gymId` AND
 * `session_media.userId === userId` are touched — leaving the user in
 * another gym they belong to is unaffected. Comments are scoped via
 * their parent post's gymId (resolved per-comment) so a comment the
 * leaving user wrote on someone else's post in this gym also gets
 * tagged.
 *
 * Cheap: a member's post history in one gym is bounded by the rate
 * limit (20 posts/day cap) × tenure, well under any per-mutation write
 * budget on realistic accounts. The `by_user_created` index scopes the
 * scan to one user.
 */
async function tagPostsAndCommentsAsFormerMember(
  ctx: MutationCtx,
  gymId: Id<"gyms">,
  userId: Id<"users">,
): Promise<{ postsTagged: number; commentsTagged: number }> {
  // Walk this user's posts via the user-scoped index, then filter to the
  // gym leaving (vs. a separate `by_gym_user_created` index — overkill
  // for the size of one user's post history).
  const userPosts = await ctx.db
    .query("session_media")
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .collect();
  const postsInGym = userPosts.filter((p) => p.gymId === gymId);
  await Promise.all(
    postsInGym.map((p) =>
      ctx.db.patch(p._id, { authorState: "former_member" }),
    ),
  );

  // Same for comments — scope by user via `by_user`, then keep only
  // comments whose parent post lives in this gym. The parent fetch is
  // bounded by the user's total comment count, which is also small per
  // gym in practice.
  const userComments = await ctx.db
    .query("feed_comments")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const commentParents = await Promise.all(
    userComments.map((c) => ctx.db.get(c.postId)),
  );
  const commentsInGym = userComments.filter((_c, i) => {
    const parent = commentParents[i];
    return parent?.gymId === gymId;
  });
  await Promise.all(
    commentsInGym.map((c) =>
      ctx.db.patch(c._id, { authorState: "former_member" }),
    ),
  );

  return {
    postsTagged: postsInGym.length,
    commentsTagged: commentsInGym.length,
  };
}

/**
 * Remove a member from a gym (soft-delete: status = "removed"). The
 * user's prior posts and comments in this gym are soft-tagged as
 * `authorState: "former_member"` so the feed shows a "(former member)"
 * label rather than disappearing the content. Hard-delete is reserved
 * for full-account deletion (see deleteAccountMutations.ts).
 *
 * Permissions:
 *   - Coach (gym owner): can remove anyone except themselves.
 *   - Member: can "leave" by removing themselves.
 */
export const removeMember = mutation({
  args: { memberId: v.id("gym_members") },
  handler: async (ctx, { memberId }) => {
    const userId = await requireUserId(ctx);
    const member = await ctx.db.get(memberId);
    if (!member) throw new Error("Member not found");

    const gym = await ctx.db.get(member.gymId);
    if (!gym) throw new Error("Gym not found");

    const isOwner = gym.ownerUserId === userId;
    const isSelf = member.userId === userId;
    if (!isOwner && !isSelf) {
      throw new Error("Cannot remove this member");
    }
    if (isOwner && isSelf) {
      throw new Error("Gym owner cannot remove themselves");
    }

    await ctx.db.patch(memberId, { status: "removed" });
    await tagPostsAndCommentsAsFormerMember(ctx, member.gymId, member.userId);
  },
});

/**
 * Convenience: remove a gym member by user id (used by AthleteDetail's
 * "remove athlete" button which has athleteUserId in scope, not memberId).
 */
export const removeAthleteByUserId = mutation({
  args: { gymId: v.id("gyms"), athleteUserId: v.id("users") },
  handler: async (ctx, { gymId, athleteUserId }) => {
    const userId = await requireUserId(ctx);
    await assertGymOwner(ctx, gymId, userId);
    const member = await ctx.db
      .query("gym_members")
      .withIndex("by_gym_user", (q) =>
        q.eq("gymId", gymId).eq("userId", athleteUserId),
      )
      .unique();
    if (!member) throw new Error("Athlete is not in this gym");
    await ctx.db.patch(member._id, { status: "removed" });
    await tagPostsAndCommentsAsFormerMember(ctx, gymId, athleteUserId);
  },
});

/**
 * Variant used by MyGym's AthleteDetail flow when the coach doesn't know
 * the specific gym — finds the active membership across all of this
 * coach's gyms and removes it. Resolves the ambiguity in
 * AthleteDetail.tsx's original `.update().eq("user_id", athleteId)` which
 * relied on RLS to scope the update.
 */
export const removeAthleteFromMyGyms = mutation({
  args: { athleteUserId: v.id("users") },
  handler: async (ctx, { athleteUserId }) => {
    const userId = await requireUserId(ctx);
    // All gyms this user owns
    const ownedGyms = await ctx.db
      .query("gyms")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .collect();
    let removed = 0;
    for (const gym of ownedGyms) {
      const member = await ctx.db
        .query("gym_members")
        .withIndex("by_gym_user", (q) =>
          q.eq("gymId", gym._id).eq("userId", athleteUserId),
        )
        .unique();
      if (member && member.status === "active") {
        await ctx.db.patch(member._id, { status: "removed" });
        await tagPostsAndCommentsAsFormerMember(ctx, gym._id, athleteUserId);
        removed += 1;
      }
    }
    if (removed === 0) throw new Error("Athlete not found in any of your gyms");
    return removed;
  },
});

/** Coach-only: change a member's role. */
export const updateRole = mutation({
  args: {
    memberId: v.id("gym_members"),
    memberRole: v.union(v.literal("coach"), v.literal("athlete")),
  },
  handler: async (ctx, { memberId, memberRole }) => {
    const userId = await requireUserId(ctx);
    const member = await ctx.db.get(memberId);
    if (!member) throw new Error("Member not found");
    await assertGymOwner(ctx, member.gymId, userId);
    await ctx.db.patch(memberId, { memberRole });
  },
});

/**
 * Athlete-only: toggle the data-sharing flag for one of their gyms. When
 * false the coach aggregation queries hide weight/meal/training data for
 * this athlete (the membership row still exists).
 */
export const setShareData = mutation({
  args: { memberId: v.id("gym_members"), shareData: v.boolean() },
  handler: async (ctx, { memberId, shareData }) => {
    const userId = await requireUserId(ctx);
    const member = await ctx.db.get(memberId);
    if (!member) throw new Error("Member not found");
    if (member.userId !== userId) {
      throw new Error("Only the member can change their share-data setting");
    }
    await ctx.db.patch(memberId, { shareData });
  },
});

// Re-export so other modules importing membership helpers stay tidy.
export { assertGymMember };
