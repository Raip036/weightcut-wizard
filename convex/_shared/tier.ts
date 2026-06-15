/**
 * Tier semantics for the post-gems pricing model.
 *
 * Only two tiers exist for now:
 *   - "free": default. Cannot invoke pro-gated features.
 *   - "pro":  paid subscription (monthly/annual/lifetime). A free trial is
 *             represented the same way — as an *active RevenueCat
 *             entitlement* with a finite future `subscriptionExpiresAt` (the
 *             trial end). There is no separate device-clock trial source: the
 *             `trialEndsAt` / `trialStartedAt` columns are analytics-only and
 *             MUST NOT grant Pro.
 *
 * Core invariant: a non-lifetime entitlement MUST always carry a finite,
 * future expiry. A null/absent expiry grants Pro ONLY for
 * `premium_lifetime`. Any other non-free tier with a missing or past expiry
 * resolves to "free" — this is the defensive read guard that stops a
 * malformed write from granting "Pro forever, free".
 *
 * `effectiveTier(profile)` is the single source of truth. Every code path
 * that needs to know "is this user pro?" funnels through here so adding a
 * third tier (e.g. "pro_plus") is a one-place change.
 *
 * Keep this file in lockstep with the analogous client-side helpers (see
 * `src/lib/featureGates.ts`). The server is the authority, but the client
 * should arrive at the same answer or the upfront gating UX is wrong.
 */

import type { Doc } from "../_generated/dataModel";

export type Tier = "free" | "pro";

/**
 * Profile shape this helper depends on. Accepts any object exposing the
 * subscription / trial columns we care about — typed loosely so callers can
 * pass a partial projection without satisfying every `Doc<"profiles">`
 * field. `null` returns `"free"` so callers don't have to short-circuit.
 */
export type TierProfileShape = Pick<
  Doc<"profiles">,
  "subscriptionTier" | "subscriptionExpiresAt"
> & {
  trialEndsAt?: number | null;
};

/** Returns `"pro"` if the user has an active paid entitlement; otherwise
 *  `"free"`.
 *
 *  Bounded-expiry rule (F1): a null/undefined `subscriptionExpiresAt` grants
 *  Pro ONLY for `premium_lifetime`. Every other non-free tier requires a
 *  finite, future expiry (`typeof expiresAt === "number" && expiresAt >
 *  nowMs`). A trial is just an active non-lifetime entitlement whose expiry
 *  is the trial end — there is no `trialEndsAt` branch (F4). */
export function effectiveTier(
  profile: TierProfileShape | null | undefined,
  nowMs: number = Date.now(),
): Tier {
  if (!profile) return "free";

  const tier = profile.subscriptionTier;
  const expiresAt = profile.subscriptionExpiresAt;

  const isNonFreeTier =
    typeof tier === "string" && tier.length > 0 && tier !== "free";
  if (!isNonFreeTier) return "free";

  // Lifetime is the only tier permitted to have no expiry.
  if (tier === "premium_lifetime") {
    if (expiresAt == null) return "pro";
    // A lifetime row carrying an expiry is unusual, but honour it: still
    // Pro while the expiry is in the future.
    return typeof expiresAt === "number" && expiresAt > nowMs ? "pro" : "free";
  }

  // All other non-free tiers REQUIRE a finite, future expiry.
  if (typeof expiresAt === "number" && expiresAt > nowMs) return "pro";

  return "free";
}

/**
 * True iff `actual` satisfies the `required` tier.
 *
 * With only two tiers the rules are trivial:
 *   - required === "free": always true.
 *   - required === "pro":  true only if actual === "pro".
 *
 * Keeping this as an ordered comparison (rather than direct equality) means
 * adding a "pro_plus" later requires changing this function and nothing
 * else.
 */
export function meetsTier(actual: Tier, required: Tier): boolean {
  const rank: Record<Tier, number> = { free: 0, pro: 1 };
  return rank[actual] >= rank[required];
}
