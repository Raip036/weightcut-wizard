/**
 * Gym queries + mutations.
 *
 * Replaces Supabase `gyms` table CRUD and the `my_gyms_overview` RPC.
 * Invite codes are 6-character alphanumeric. Generated client-side with a
 * retry-on-collision loop — the schema's by_invite_code unique semantic is
 * enforced here in application code (Convex has no UNIQUE constraints).
 */
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUserId } from "./lib/auth";

// Match CoachSetup.tsx alphabet (no ambiguous chars: 0/O, 1/I/L)
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

function generateCodeString(): string {
  let out = "";
  // Math.random is fine here — collision probability is < 1 in 30^6, and
  // the loop in `generateUniqueInviteCode` retries on the rare collision.
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

async function generateUniqueInviteCode(ctx: MutationCtx): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateCodeString();
    const existing = await ctx.db
      .query("gyms")
      .withIndex("by_invite_code", (q) => q.eq("inviteCode", code))
      .first();
    if (!existing) return code;
  }
  throw new Error("Failed to generate unique invite code after 10 attempts");
}

// ─────────────────────────────────────────────────────────────────────────
// Shape helpers — return snake_case to match the existing client code so
// no React component rewrites are required for shape.
// ─────────────────────────────────────────────────────────────────────────

function toClientGym(row: Doc<"gyms">, logoUrl: string | null = null) {
  return {
    id: row._id,
    name: row.name,
    owner_user_id: row.ownerUserId,
    invite_code: row.inviteCode,
    location: row.location ?? null,
    logo_url: logoUrl,
    disciplines: row.disciplines ?? null,
    fighter_count: row.fighterCount ?? null,
    about: row.about ?? null,
    updated_at: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    created_at: new Date(row._creationTime).toISOString(),
  };
}

/**
 * Resolve a gym's logo storage id to a long-lived URL via Convex File
 * Storage. Returns null if no logo is set (or if the storage object has
 * been deleted out-of-band).
 */
async function getGymLogoUrl(
  ctx: QueryCtx | MutationCtx,
  gym: Doc<"gyms">,
): Promise<string | null> {
  if (!gym.logoStorageId) return null;
  return await ctx.storage.getUrl(gym.logoStorageId);
}

// ─────────────────────────────────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────────────────────────────────

/**
 * All gyms the current user is part of (as owner OR active member). Returns
 * the gym row enriched with member metadata (memberId, joined_at, share_data)
 * and the coach's display name. Replicates the SQL `my_gyms_overview` RPC.
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);

    // 1. Find every active membership for this user.
    const memberships = await ctx.db
      .query("gym_members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    // 2. Fan-out fetch each gym + its owner profile (for coach name).
    const rows = await Promise.all(
      memberships.map(async (m) => {
        const gym = await ctx.db.get(m.gymId);
        if (!gym) return null;
        const [coachProfile, logoUrl] = await Promise.all([
          ctx.db
            .query("profiles")
            .withIndex("by_user", (q) => q.eq("userId", gym.ownerUserId))
            .unique(),
          getGymLogoUrl(ctx, gym),
        ]);
        return {
          member_id: m._id,
          gym_id: gym._id,
          gym_name: gym.name,
          gym_location: gym.location ?? null,
          gym_logo_url: logoUrl,
          coach_user_id: gym.ownerUserId,
          coach_name: coachProfile?.displayName ?? null,
          share_data: !!m.shareData,
          joined_at: new Date(m.joinedAt).toISOString(),
        };
      }),
    );

    return rows
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (a.joined_at < b.joined_at ? -1 : 1));
  },
});

export const getById = query({
  args: { gymId: v.id("gyms") },
  handler: async (ctx, { gymId }) => {
    const userId = await requireUserId(ctx);
    const gym = await ctx.db.get(gymId);
    if (!gym) return null;

    // Only the owner OR an active member may see the full gym record
    // (including the invite code, location, about copy, etc.). Any other
    // signed-in user gets a public-safe stub so the UI can still render a
    // gym name in shared contexts (e.g. fight-offer recipient list) without
    // leaking the invite code that would let them silently join.
    const isOwner = gym.ownerUserId === userId;
    let isMember = false;
    if (!isOwner) {
      const membership = await ctx.db
        .query("gym_members")
        .withIndex("by_gym_user", (q) =>
          q.eq("gymId", gymId).eq("userId", userId),
        )
        .unique();
      isMember = !!membership && membership.status === "active";
    }
    if (!isOwner && !isMember) {
      return {
        id: gym._id,
        name: gym.name,
        owner_user_id: null,
        invite_code: null,
        location: null,
        logo_url: null,
        disciplines: null,
        fighter_count: null,
        about: null,
        updated_at: null,
        created_at: new Date(gym._creationTime).toISOString(),
      };
    }
    return toClientGym(gym, await getGymLogoUrl(ctx, gym));
  },
});

/**
 * Look up a gym by invite code (for the JoinGym preview card). No auth gate
 * — invite codes are intentionally guessable-but-rate-limited; pre-auth
 * users hit this from the JoinGym landing.
 */
export const getByInviteCode = query({
  args: { inviteCode: v.string() },
  handler: async (ctx, { inviteCode }) => {
    const code = inviteCode.trim().toUpperCase();
    if (code.length !== CODE_LEN) return null;
    const gym = await ctx.db
      .query("gyms")
      .withIndex("by_invite_code", (q) => q.eq("inviteCode", code))
      .first();
    if (!gym) return null;
    return toClientGym(gym, await getGymLogoUrl(ctx, gym));
  },
});

/**
 * Aggregate counts for the Corner gym header.
 *
 * Returns:
 *  - `memberCount` — currently-active members of the gym. Bounded via
 *    `.take(500)` so a hypothetical 5000-member chain doesn't blow the
 *    per-query read budget; typical gyms come in under 200 so this is
 *    effectively the true count for v1.
 *  - `activePosters7d` — distinct users who posted to the gym feed in the
 *    last 7 days. Read off the `by_gym_created` index (the same one the
 *    feed uses) so the storage cost is one extra short index scan per
 *    Corner-header render — no separate aggregate table needed.
 *
 * Access: auth-required, gym-membership gated. Non-members get a `null`
 * return rather than a thrown error. The throw used to surface as a
 * generic "Server Error" in the client console during transient states
 * (just-joined membership, just-left, mismatched cached gymId on a feed
 * page that the user can still legitimately reach). Returning null keeps
 * the count data gated (no leak to random signed-in users) while letting
 * the client degrade gracefully to the no-subtitle state.
 */
export const getMemberCount = query({
  args: { gymId: v.id("gyms") },
  handler: async (ctx, { gymId }) => {
    const userId = await requireUserId(ctx);
    const membership = await ctx.db
      .query("gym_members")
      .withIndex("by_gym_user", (q) => q.eq("gymId", gymId).eq("userId", userId))
      .unique();
    if (!membership || membership.status !== "active") {
      return null;
    }

    // `by_gym` is `[gymId]` so this is a range scan bounded to one gym.
    // `.take(500)` caps the scan; the `status` filter then drops out
    // non-active rows from that capped window. For v1 every gym fits.
    const members = await ctx.db
      .query("gym_members")
      .withIndex("by_gym", (q) => q.eq("gymId", gymId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .take(500);
    const memberCount = members.length;

    // Active-poster window: 7 days. We pull the 200 newest posts off the
    // gym's `by_gym_created` index — at the volumes we expect (≤30
    // posts/day per chatty gym) 200 covers the whole 7d window with room
    // to spare. Trim to the 7d threshold post-fetch and dedupe by author.
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    const recentPosts = await ctx.db
      .query("session_media")
      .withIndex("by_gym_created", (q) => q.eq("gymId", gymId))
      .order("desc")
      .take(200);
    const activeUserIds = new Set<Id<"users">>();
    for (const p of recentPosts) {
      if (p._creationTime > cutoff) {
        activeUserIds.add(p.userId);
      }
    }
    const activePosters7d = activeUserIds.size;

    // Today's poster set — drives the "X of N trained today" banner.
    // Reuses the same `recentPosts` scan so we don't pay a second index
    // probe. Uses UTC midnight for the day boundary so members on tour
    // see consistent rollover with the server (matches the other
    // capturedAt-based queries).
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const startOfTodayMs = todayUtc.getTime();
    const todayUserIds = new Set<Id<"users">>();
    for (const p of recentPosts) {
      if (p._creationTime >= startOfTodayMs) {
        todayUserIds.add(p.userId);
      }
    }
    const activePostersToday = todayUserIds.size;
    const viewerPostedToday = todayUserIds.has(userId);

    return {
      memberCount,
      activePosters7d,
      activePostersToday,
      viewerPostedToday,
    };
  },
});

/** Gyms owned by the current coach. Used by CoachDashboard. */
export const listOwned = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("gyms")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .collect();
    const sorted = rows.sort((a, b) => a._creationTime - b._creationTime);
    return Promise.all(
      sorted.map(async (g) => toClientGym(g, await getGymLogoUrl(ctx, g))),
    );
  },
});

// ─────────────────────────────────────────────────────────────────────────
// MUTATIONS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create a gym. Promotes the current user to `role: "coach"` (idempotent)
 * and inserts them into `gym_members` as a coach member of the new gym.
 * Replaces the multi-step CoachSetup flow in one atomic Convex mutation.
 */
export const create = mutation({
  args: {
    name: v.string(),
    location: v.optional(v.string()),
    disciplines: v.optional(v.array(v.string())),
    fighterCount: v.optional(v.number()),
    about: v.optional(v.string()),
    coachDisplayName: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { name, location, disciplines, fighterCount, about, coachDisplayName },
  ) => {
    const userId = await requireUserId(ctx);
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error("Gym name is required");

    // 1. Promote the calling user to `coach` role (idempotent) and stash
    //    a display name if one was supplied (coach onboarding collects
    //    both gym + coach details on the same screen).
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const profilePatch: Record<string, unknown> = { updatedAt: Date.now() };
    if (profile && profile.role !== "coach") profilePatch.role = "coach";
    const trimmedDisplay = coachDisplayName?.trim();
    if (trimmedDisplay && profile && profile.displayName !== trimmedDisplay) {
      profilePatch.displayName = trimmedDisplay;
    }
    if (profile && Object.keys(profilePatch).length > 1) {
      await ctx.db.patch(profile._id, profilePatch as any);
    }

    // 2. Insert the gym with a unique invite code.
    const inviteCode = await generateUniqueInviteCode(ctx);
    const cleanDisciplines = disciplines
      ?.map((d) => d.trim())
      .filter((d) => d.length > 0);
    const gymId = await ctx.db.insert("gyms", {
      name: trimmedName,
      ownerUserId: userId,
      inviteCode,
      location: location?.trim() || undefined,
      disciplines:
        cleanDisciplines && cleanDisciplines.length > 0
          ? cleanDisciplines
          : undefined,
      fighterCount:
        typeof fighterCount === "number" && fighterCount >= 0
          ? Math.floor(fighterCount)
          : undefined,
      about: about?.trim() || undefined,
      updatedAt: Date.now(),
    });

    // 3. Add the coach as a coach-role member of their own gym.
    await ctx.db.insert("gym_members", {
      gymId,
      userId,
      memberRole: "coach",
      status: "active",
      shareData: true,
      joinedAt: Date.now(),
    });

    const gym = await ctx.db.get(gymId);
    if (!gym) return null;
    return toClientGym(gym, await getGymLogoUrl(ctx, gym));
  },
});

/** Coach-only: update gym fields (name / location / disciplines / fighter
 *  count / about — logo goes through the dedicated `setLogo` storage
 *  mutation below). Pass `null` to any optional field to clear it. */
export const update = mutation({
  args: {
    gymId: v.id("gyms"),
    name: v.optional(v.string()),
    location: v.optional(v.union(v.string(), v.null())),
    disciplines: v.optional(v.union(v.array(v.string()), v.null())),
    fighterCount: v.optional(v.union(v.number(), v.null())),
    about: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (
    ctx,
    { gymId, name, location, disciplines, fighterCount, about },
  ) => {
    const userId = await requireUserId(ctx);
    const gym = await ctx.db.get(gymId);
    if (!gym) throw new Error("Gym not found");
    if (gym.ownerUserId !== userId) {
      throw new Error("Only the gym owner can update this gym");
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (name !== undefined) {
      const t = name.trim();
      if (!t) throw new Error("Gym name cannot be empty");
      patch.name = t;
    }
    if (location !== undefined) {
      patch.location = location === null ? undefined : location.trim() || undefined;
    }
    if (disciplines !== undefined) {
      if (disciplines === null) {
        patch.disciplines = undefined;
      } else {
        const cleaned = disciplines.map((d) => d.trim()).filter((d) => d);
        patch.disciplines = cleaned.length > 0 ? cleaned : undefined;
      }
    }
    if (fighterCount !== undefined) {
      patch.fighterCount =
        fighterCount === null || fighterCount < 0
          ? undefined
          : Math.floor(fighterCount);
    }
    if (about !== undefined) {
      patch.about = about === null ? undefined : about.trim() || undefined;
    }
    await ctx.db.patch(gymId, patch as any);
  },
});

/**
 * Step 1 of the gym-logo upload flow: returns a one-time POST URL. Gated
 * to the gym owner so randoms can't burn through quota.
 */
export const generateLogoUploadUrl = mutation({
  args: { gymId: v.id("gyms") },
  handler: async (ctx, { gymId }) => {
    const userId = await requireUserId(ctx);
    await assertGymOwner(ctx, gymId, userId);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Step 2 of the gym-logo upload flow: persist the `storageId`. Deletes the
 * previous logo storage BEFORE patching the new id so a race-condition
 * never orphans the old file. Pass `storageId: null` to clear the logo.
 */
export const setLogo = mutation({
  args: {
    gymId: v.id("gyms"),
    storageId: v.union(v.id("_storage"), v.null()),
  },
  handler: async (ctx, { gymId, storageId }) => {
    const userId = await requireUserId(ctx);
    const gym = await assertGymOwner(ctx, gymId, userId);

    if (gym.logoStorageId && gym.logoStorageId !== storageId) {
      try {
        await ctx.storage.delete(gym.logoStorageId);
      } catch {
        /* prior file already missing — ignore */
      }
    }

    await ctx.db.patch(gymId, {
      logoStorageId: storageId ?? undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Join (or re-join) a gym via invite code. Idempotent — re-joining flips
 * status back to "active" if the user was previously "removed". Replaces
 * the JoinGym.tsx upsert into gym_members.
 */
export const joinByInviteCode = mutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, { inviteCode }) => {
    const userId = await requireUserId(ctx);
    const code = inviteCode.trim().toUpperCase();
    if (code.length !== CODE_LEN) throw new Error("Invalid invite code");

    const gym = await ctx.db
      .query("gyms")
      .withIndex("by_invite_code", (q) => q.eq("inviteCode", code))
      .first();
    if (!gym) throw new Error("Invite code not recognised");

    const existing = await ctx.db
      .query("gym_members")
      .withIndex("by_gym_user", (q) =>
        q.eq("gymId", gym._id).eq("userId", userId),
      )
      .unique();

    if (existing) {
      // Re-activate a previously-removed membership; preserve role.
      await ctx.db.patch(existing._id, {
        status: "active",
        shareData: true,
        joinedAt: Date.now(),
      });
      return { gymId: gym._id, memberId: existing._id };
    }

    const memberId = await ctx.db.insert("gym_members", {
      gymId: gym._id,
      userId,
      memberRole: "athlete",
      status: "active",
      shareData: true,
      joinedAt: Date.now(),
    });
    return { gymId: gym._id, memberId };
  },
});

/**
 * Re-roll a gym's invite code (coach-only). Useful if the existing code
 * has been leaked. Returns the new code.
 */
export const regenerateInviteCode = mutation({
  args: { gymId: v.id("gyms") },
  handler: async (ctx, { gymId }) => {
    const userId = await requireUserId(ctx);
    const gym = await ctx.db.get(gymId);
    if (!gym) throw new Error("Gym not found");
    if (gym.ownerUserId !== userId) {
      throw new Error("Only the gym owner can regenerate the invite code");
    }
    const newCode = await generateUniqueInviteCode(ctx);
    await ctx.db.patch(gymId, { inviteCode: newCode, updatedAt: Date.now() });
    return newCode;
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Helper exports for cross-module use (announcements, coach.ts).
// Not exported as Convex functions.
// ─────────────────────────────────────────────────────────────────────────

export async function assertGymOwner(
  ctx: QueryCtx | MutationCtx,
  gymId: Id<"gyms">,
  userId: Id<"users">,
): Promise<Doc<"gyms">> {
  const gym = await ctx.db.get(gymId);
  if (!gym) throw new Error("Gym not found");
  if (gym.ownerUserId !== userId) {
    throw new Error("Only the gym owner can perform this action");
  }
  return gym;
}

export async function assertGymMember(
  ctx: QueryCtx | MutationCtx,
  gymId: Id<"gyms">,
  userId: Id<"users">,
): Promise<Doc<"gym_members">> {
  const member = await ctx.db
    .query("gym_members")
    .withIndex("by_gym_user", (q) => q.eq("gymId", gymId).eq("userId", userId))
    .unique();
  if (!member || member.status !== "active") {
    throw new Error("Not a member of this gym");
  }
  return member;
}
