/**
 * Binds PostHog identity to the app's auth + subscription state.
 *
 *   - identify(userId) once a real userId resolves → events stitch into one
 *     person across sessions, which is what makes retention / return-rate work.
 *   - reset() when the user logs out (real id → null) so the next person on the
 *     device starts a fresh anonymous identity.
 *
 * Renders nothing. Mount inside UserProvider + SubscriptionProvider.
 */
import { useEffect, useRef } from "react";
import { useUser } from "@/contexts/UserContext";
import { useSubscription } from "@/hooks/useSubscription";
import { identifyUser, resetAnalytics } from "@/lib/analytics";

export function AnalyticsBridge() {
  const { userId, profile } = useUser();
  const { tier, isPremium, isInTrial } = useSubscription();
  const prevUserId = useRef<string | null>(null);

  useEffect(() => {
    const realId = userId && userId !== "pending" ? userId : null;

    if (realId) {
      // Person properties only — strictly non-PII (no email/name/free text).
      identifyUser(realId, {
        tier,
        is_premium: isPremium,
        is_in_trial: isInTrial,
        goal_type: profile?.goal_type ?? null,
        weigh_in_timing: profile?.weigh_in_timing ?? null,
      });
    } else if (prevUserId.current) {
      // Was logged in, now logged out → clear identity.
      resetAnalytics();
    }

    prevUserId.current = realId;
  }, [userId, tier, isPremium, isInTrial, profile?.goal_type, profile?.weigh_in_timing]);

  return null;
}

export default AnalyticsBridge;
