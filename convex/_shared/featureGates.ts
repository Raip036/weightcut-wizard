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
  AI_RECOVERY_COACH: { minTier: "pro" as const },
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
  // Onboarding plan generation is the ONLY free AI feature. It backs the
  // first-time cut/weight-plan generated during onboarding so a brand-new
  // user gets a plan before paying. Non-onboarding plan regeneration (e.g.
  // starting the next camp) stays Pro under AI_CUT_PLAN / AI_WEIGHT_PROTOCOL.
  AI_ONBOARDING_PLAN: { minTier: "free" as const },
  // Feature-area gate (non-AI): the Pro Recovery surface — readiness,
  // recovery dashboard, hydration tracking + AI coaching — is Pro-only.
  // NOTE: the free daily wellness CHECK-IN (`wellness.upsertCheckin`, which
  // feeds the fight-form-score ring) is intentionally NOT gated by this key
  // and stays reachable by free users.
  RECOVERY: { minTier: "pro" as const },
  // Creating MORE than one fight camp. A free user's single camp is the one
  // auto-created during the fighter ONBOARDING flow; every other creation
  // path (manual "start a new camp", the post-fight overlay, re-running
  // onboarding) is Pro. NOTE: this key is the flat gate for the manual paths.
  // The onboarding-blessed first camp is enforced separately in
  // `assertCanCreateCamp` (convex/_shared/campLimit.ts), which knows whether
  // a request is the onboarding auto-create. See the design doc.
  MULTIPLE_FIGHT_CAMPS: { minTier: "pro" as const },
  // Future expansion examples (kept commented for now):
  // ADVANCED_LEADERBOARDS: { minTier: "pro" as const },
  // EXPORT_DATA: { minTier: "pro" as const },
} as const;

export type FeatureKey = keyof typeof FEATURE_GATES;

/**
 * DEV-ONLY paywall bypass. When the Convex env var `DEV_GATE_BYPASS` is
 * exactly "true", every feature gate resolves to Pro instead of throwing.
 * This is the backend mirror of the frontend `import.meta.env.DEV` bypass in
 * `WeightProtocol.tsx` (and elsewhere), so the full Pro surface — including
 * the AI generation actions the UI can now reach on dev — is testable without
 * a real subscription.
 *
 * Set ONLY on the dev deployment: `npx convex env set DEV_GATE_BYPASS true`.
 * Production must never carry this variable, so the gate stays fully enforced
 * there. `process` is guarded for the same reason the Groq helper guards it —
 * the value is read in a Node action runtime.
 */
function devGateBypassEnabled(): boolean {
  return (
    typeof process !== "undefined" &&
    !!process.env &&
    process.env.DEV_GATE_BYPASS === "true"
  );
}

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
  // Dev-only short-circuit: skip the profile read and the throw entirely.
  if (devGateBypassEnabled()) return { tier: "pro" };
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
  // Dev-only short-circuit: mirror `enforceFeatureGate`.
  if (devGateBypassEnabled()) return;
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const tier = effectiveTier(profile);
  if (!meetsTier(tier, FEATURE_GATES[featureKey].minTier)) {
    throw new Error(`PRO_FEATURE_REQUIRED:${featureKey}`);
  }
}
