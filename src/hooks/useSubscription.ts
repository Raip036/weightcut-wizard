import { useCallback } from "react";
import { useSubscriptionContext } from "@/contexts/SubscriptionContext";
import {
  FEATURE_GATES,
  meetsTier,
  parseProFeatureError,
  type FeatureKey,
  type Tier,
} from "@/lib/featureGates";

/**
 * Public surface for tier / paywall state used throughout the app.
 *
 * Replaces the previous gem-based API. Components should:
 *   1. Call `checkFeatureAccess(featureKey)` (or `useFeatureAccess`) before
 *      invoking an AI action so free users see the paywall instead of
 *      bouncing off a server-side error.
 *   2. Call `handlePaywallError(error)` on any caught error from an AI
 *      action; if the error is a `PRO_FEATURE_REQUIRED:*` it'll open the
 *      paywall automatically and return true.
 */
export function useSubscription() {
  const ctx = useSubscriptionContext();

  /** Synchronous client-side gate check for any feature. */
  const checkFeatureAccess = useCallback(
    (featureKey: FeatureKey): boolean => {
      const required = FEATURE_GATES[featureKey].minTier;
      return meetsTier(ctx.tier, required);
    },
    [ctx.tier],
  );

  /**
   * Inspect an error thrown by an AI action and, if it's a
   * `PRO_FEATURE_REQUIRED:*` rejection, open the paywall. Returns `true`
   * when the error was handled so the caller can suppress a generic toast.
   */
  const handlePaywallError = useCallback(
    (error: unknown): boolean => {
      const featureKey = parseProFeatureError(error);
      if (!featureKey) return false;
      if (ctx.isPremium) {
        // Edge case: server says no, RC says yes. The wrapper already tried
        // to self-heal; don't spam the paywall on a stale profile.
        return true;
      }
      ctx.openPaywall();
      return true;
    },
    [ctx],
  );

  return {
    isPremium: ctx.isPremium,
    tier: ctx.tier as Tier,
    rawTier: ctx.rawTier,
    expiresAt: ctx.expiresAt,
    isInTrial: ctx.isInTrial,
    trialEndsAt: ctx.trialEndsAt,
    willRenew: ctx.willRenew,
    isTrialActive: ctx.isTrialActive,
    isSubscriptionResolved: ctx.isSubscriptionResolved,
    isPaywallOpen: ctx.isPaywallOpen,
    checkFeatureAccess,
    handlePaywallError,
    openPaywall: ctx.openPaywall,
    closePaywall: ctx.closePaywall,
    showWelcomePro: ctx.showWelcomePro,
    dismissWelcomePro: ctx.dismissWelcomePro,
  };
}
