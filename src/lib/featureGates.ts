// MUST stay in sync with convex/_shared/featureGates.ts
//
// Single source of truth (client-side) for what's gated behind a paid tier.
// To gate a new feature: add a key here AND in the server-side mirror.
// To free a feature up: change `minTier` to "free".
// To introduce a "trial" or "pro_plus" tier later: extend the `Tier` union
// and update `meetsTier` — call sites stay untouched.

export type Tier = "free" | "pro";

/** Rank used by `meetsTier`. Higher numbers = greater entitlement. */
const TIER_RANK: Record<Tier, number> = {
  free: 0,
  pro: 1,
};

export const FEATURE_GATES = {
  // AI features — all pro-only post-refactor.
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
  // Future expansion examples (kept commented for now):
  // ADVANCED_LEADERBOARDS: { minTier: "pro" as const },
  // EXPORT_DATA: { minTier: "pro" as const },
} as const;

export type FeatureKey = keyof typeof FEATURE_GATES;

/** True if `actual` tier is at least as privileged as `required`. */
export function meetsTier(actual: Tier, required: Tier): boolean {
  return TIER_RANK[actual] >= TIER_RANK[required];
}

/** Error message prefix the server throws on a gate miss.
 *  Format: `PRO_FEATURE_REQUIRED:<FeatureKey>`. */
export const PRO_REQUIRED_PREFIX = "PRO_FEATURE_REQUIRED:";

/**
 * Parse a thrown error/message and return the `FeatureKey` if it was a
 * pro-feature gate rejection, otherwise `null`.
 */
export function parseProFeatureError(err: unknown): FeatureKey | null {
  if (!err) return null;
  const msg = err instanceof Error ? err.message : String(err);
  const idx = msg.indexOf(PRO_REQUIRED_PREFIX);
  if (idx === -1) return null;
  const tail = msg.slice(idx + PRO_REQUIRED_PREFIX.length).trim();
  // Trim trailing punctuation/whitespace the server may have appended.
  const key = tail.split(/[\s,;:"']/, 1)[0] as FeatureKey;
  return key in FEATURE_GATES ? key : null;
}
