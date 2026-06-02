/**
 * Internal queries on the `profiles` table — callable from Convex actions via
 * `ctx.runQuery(internal.profiles_internal.*)`.
 *
 * Kept separate from `profiles.ts` because the surface there is user-scoped
 * via `requireUserId(ctx)`. Actions resolve the userId out-of-band (via
 * `internal.lib_auth.getMyUserId`) and then pass it explicitly.
 */
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { effectiveTier } from "./_shared/tier";

export const getByUserId = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const getDietaryPreferences = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("user_dietary_preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
  },
});

/**
 * Every userId whose profile resolves to `tier === "pro"` (active paid
 * subscription OR active trial) right now. Single source of truth for
 * "is Pro" is `effectiveTier` in `_shared/tier.ts` — DO NOT inline the
 * tier check here, that's how the two surfaces drift.
 *
 * Used by `internal.actions.recovery.campCompass.runWeeklyForAllProUsers`
 * (the Sunday cron) to fan out the Camp Compass generation. Bounded by a
 * full scan of `profiles`; profile-row counts are roughly equal to the
 * total user base so this is O(N) but with N in the low thousands for
 * the foreseeable future. Switch to a (subscriptionTier, indexed) scan
 * if/when the profile table grows large enough that this is a concern.
 */
export const listActiveProUserIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<Id<"users">>> => {
    const profiles = await ctx.db.query("profiles").collect();
    const now = Date.now();
    return profiles
      .filter((p) => effectiveTier(p, now) === "pro")
      .map((p) => p.userId);
  },
});
