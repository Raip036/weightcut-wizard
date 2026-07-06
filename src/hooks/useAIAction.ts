/**
 * Drop-in replacement for `useAction(...)` on Convex AI actions that are
 * pro-gated server-side. Every gated AI action call site should use this
 * hook instead of `useAction` directly so:
 *
 *   1. A stale Convex `profile.subscription*` row doesn't manifest as a
 *      user-visible `PRO_FEATURE_REQUIRED` for paying pro customers.
 *   2. (Optional) Free users get an upfront paywall before the action is
 *      ever dispatched — no token round-trip, no error toast.
 *
 * Behaviour matches `useAction` exactly on the happy path. On a thrown
 * `PRO_FEATURE_REQUIRED:*` error, the returned function:
 *   1. Reads `customerInfo` from the RC SDK.
 *   2. If RC confirms pro, calls `api.actions.activatePremium` so Convex
 *      catches up to the real entitlement window.
 *   3. Refreshes the reactive profile query.
 *   4. Retries the original action exactly once. If it throws again, the
 *      error propagates so the UI's normal paywall path runs.
 *
 * Optional `featureKey` second arg enables the upfront client gate: when
 * the current tier doesn't meet the feature's `minTier`, the returned
 * function opens the paywall and rejects with the same error shape the
 * server would have thrown — so caller `.catch` blocks behave identically
 * regardless of which side rejected.
 */
import { useCallback } from "react";
import { useAction } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import { callWithProRecovery } from "@/lib/aiCallWrapper";
import { useSubscription } from "@/hooks/useSubscription";
import {
  FEATURE_GATES,
  meetsTier,
  PRO_REQUIRED_PREFIX,
  type FeatureKey,
} from "@/lib/featureGates";

// Loosened action-function shape — the convex/react types are complex
// generics that don't widen cleanly across action signatures, so we
// re-derive the args/return inline at the call boundary.
type AnyActionRef = Parameters<typeof useAction>[0];

export function useAIAction<TRef extends AnyActionRef>(
  actionRef: TRef,
  featureKey?: FeatureKey,
): ReturnType<typeof useAction<TRef>> {
  const rawAction = useAction(actionRef);
  const activatePremium = useAction(api.actions.activatePremium.run);
  const { refreshProfile } = useUser();
  const { tier, openPaywall } = useSubscription();

  return useCallback(
    ((args: unknown) => {
      // Upfront client gate. Skips the network round-trip on free users
      // and matches the server's error shape so callers handle one path.
      if (featureKey) {
        const required = FEATURE_GATES[featureKey].minTier;
        if (!meetsTier(tier, required)) {
          openPaywall(featureKey);
          return Promise.reject(
            new Error(`${PRO_REQUIRED_PREFIX}${featureKey}`),
          );
        }
      }

      return callWithProRecovery(
        rawAction as (a: unknown) => Promise<unknown>,
        args,
        {
          activatePremium: activatePremium as unknown as () => Promise<unknown>,
        },
        { onRecovered: async () => { await refreshProfile(); } },
      );
    }) as unknown as ReturnType<typeof useAction<TRef>>,
    [rawAction, activatePremium, refreshProfile, tier, openPaywall, featureKey],
  );
}
