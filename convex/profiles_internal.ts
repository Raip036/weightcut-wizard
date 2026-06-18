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

/** A single reconciliation candidate — only the fields the daily safety-net
 *  cron needs to re-verify against RevenueCat. */
export interface SubscriptionBoundaryCandidate {
  userId: Id<"users">;
  subscriptionTier: string;
  subscriptionExpiresAt: number;
  revenuecatCustomerId?: string;
}

/**
 * Candidates for the daily subscription reconciliation cron (fix F6, server
 * portion). Returns every non-free, non-lifetime profile whose
 * `subscriptionExpiresAt` falls in a window straddling now:
 *
 *     now − BOUNDARY_LOOKBACK_MS  ≤  expiresAt  ≤  now + BOUNDARY_LOOKAHEAD_MS
 *
 * i.e. expired up to ~2 days ago OR expiring within ~1 day. That window is
 * where a MISSED `RENEWAL` webhook bites: a paying user whose stored expiry is
 * about to lapse (or just lapsed) even though RevenueCat shows them renewed.
 * The cron re-verifies these against the RC REST API so they self-heal without
 * reopening the app, and confirms genuine expirations.
 *
 * `premium_lifetime` is skipped — it has no expiry to reconcile (and may
 * legitimately carry a null `subscriptionExpiresAt`).
 *
 * Cost note: there is no index on the subscription columns, so this does a
 * full `profiles` scan + in-memory filter — same pattern (and same O(N), N ≈
 * total user base, low thousands) as `listActiveProUserIds` above. The window
 * filter keeps the *returned* set tiny (only boundary users), so the
 * downstream per-user RC REST calls are bounded even though the scan is not.
 * Add a `(subscriptionTier, subscriptionExpiresAt)` index if the profile table
 * grows large enough that the scan itself becomes a concern.
 */
export const listSubscriptionsNearBoundary = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<SubscriptionBoundaryCandidate>> => {
    const now = Date.now();
    const lookbackMs = 2 * 24 * 60 * 60 * 1000; // 2 days
    const lookaheadMs = 1 * 24 * 60 * 60 * 1000; // 1 day
    const windowStart = now - lookbackMs;
    const windowEnd = now + lookaheadMs;

    const profiles = await ctx.db.query("profiles").collect();
    const candidates: Array<SubscriptionBoundaryCandidate> = [];
    for (const p of profiles) {
      const tier = p.subscriptionTier;
      if (typeof tier !== "string" || tier.length === 0 || tier === "free") {
        continue;
      }
      // Lifetime has no expiry to reconcile — skip outright.
      if (tier === "premium_lifetime") continue;
      const expiresAt = p.subscriptionExpiresAt;
      if (typeof expiresAt !== "number") continue;
      if (expiresAt < windowStart || expiresAt > windowEnd) continue;
      candidates.push({
        userId: p.userId,
        subscriptionTier: tier,
        subscriptionExpiresAt: expiresAt,
        revenuecatCustomerId: p.revenuecatCustomerId,
      });
    }
    return candidates;
  },
});
