/**
 * Server-side feature gate registry.
 *
 * Single source of truth for what's gated and at which tier. Replaces the
 * old `enforceGemGate` (which deducted 1 gem per AI call) with a
 * tier-comparison: gated features need the user's effective tier to meet
 * the feature's `minTier` requirement.
 *
 * Adding a new gated feature: add a key here, then call
 * `enforceFeatureGate(ctx, userId, "MY_KEY")` from the action handler.
 *
 * Freeing a feature: change its `minTier` to `"free"` — no call-site
 * changes needed.
 *
 * Keep keys in lockstep with `src/lib/featureGates.ts` (the client
 * counterpart) so the upfront gating UX and the server enforcement agree.
 */

import type { ActionCtx, QueryCtx, MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { effectiveTier, meetsTier, type Tier } from "./tier";

export const FEATURE_GATES = {
  // AI features (all pro-only post-refactor)
  AI_MEAL_ANALYSIS: { minTier: "pro" as const },
  AI_WIZARD_CHAT: { minTier: "pro" as const },
  AI_WORKOUT_GENERATOR: { minTier: "pro" as const },
  AI_MEAL_PLANNER: { minTier: "pro" as const },
  // TEMP: Recovery ungated for now (was pro)
  AI_RECOVERY_COACH: { minTier: "free" as const },
  AI_WEIGHT_PROTOCOL: { minTier: "pro" as const },
  AI_FIGHT_CAMP_COACH: { minTier: "pro" as const },
  AI_HYDRATION_INSIGHTS: { minTier: "pro" as const },
  AI_TRAINING_INSIGHTS: { minTier: "pro" as const },
  AI_TRAINING_SUMMARY: { minTier: "pro" as const },
  AI_TRAINING_COACH_PATHS: { minTier: "pro" as const },
  AI_SPARRING_PLAN: { minTier: "pro" as const },
  AI_DAILY_WISDOM: { minTier: "pro" as const },
  AI_FIGHT_WEEK_ANALYSIS: { minTier: "pro" as const },
  AI_CUT_PLAN: { minTier: "pro" as const },
  AI_TECHNIQUE_CHAINS: { minTier: "pro" as const },
  AI_AUDIO_TRANSCRIBE: { minTier: "pro" as const },
  AI_REHYDRATION_PROTOCOL: { minTier: "pro" as const },
  AI_WEIGHT_ANALYSIS: { minTier: "pro" as const },
  AI_LOOKUP_INGREDIENT: { minTier: "pro" as const },
  AI_BARCODE_ANALYSIS: { minTier: "pro" as const },
  AI_DIET_ANALYSIS: { minTier: "pro" as const },
  // Feature-area gate (non-AI): the whole Recovery surface — wellness
  // check-ins, readiness, recovery dashboard + coaching — is Pro-only.
  // TEMP: Recovery ungated for now (was pro)
  RECOVERY: { minTier: "free" as const },
  // Future expansion examples (kept commented for now):
  // ADVANCED_LEADERBOARDS: { minTier: "pro" as const },
  // EXPORT_DATA: { minTier: "pro" as const },
} as const;

export type FeatureKey = keyof typeof FEATURE_GATES;

/**
 * Throws `Error("PRO_FEATURE_REQUIRED:<KEY>")` when the calling user's
 * effective tier doesn't satisfy the feature's `minTier`. The error code
 * is the stable contract the client `callWithProRecovery` wrapper matches
 * against to trigger a paywall.
 *
 * Returns `{ tier }` so callers that want to branch on free vs. pro
 * downstream (e.g. cheaper models for free users once we have free-tier
 * features) can do so without a second profile read.
 */
export async function enforceFeatureGate(
  ctx: ActionCtx,
  userId: Id<"users">,
  featureKey: FeatureKey,
): Promise<{ tier: Tier }> {
  const profile = await ctx.runQuery(internal.profiles_internal.getByUserId, {
    userId,
  });
  const tier = effectiveTier(profile);
  const required = FEATURE_GATES[featureKey].minTier;
  if (!meetsTier(tier, required)) {
    throw new Error(`PRO_FEATURE_REQUIRED:${featureKey}`);
  }
  return { tier };
}

/**
 * Query/mutation-context counterpart to `enforceFeatureGate`. Reads the
 * profile directly via `ctx.db` (mutations/queries don't have `ctx.runQuery`)
 * and throws the same `PRO_FEATURE_REQUIRED:<KEY>` contract when the user's
 * effective tier doesn't satisfy the feature's `minTier`.
 *
 * Call right after resolving `userId` and before any DB write.
 */
export async function requireFeatureGate(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  featureKey: FeatureKey,
): Promise<void> {
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const tier = effectiveTier(profile);
  if (!meetsTier(tier, FEATURE_GATES[featureKey].minTier)) {
    throw new Error(`PRO_FEATURE_REQUIRED:${featureKey}`);
  }
}
