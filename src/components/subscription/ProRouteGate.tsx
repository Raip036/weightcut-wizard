import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useSubscription } from "@/hooks/useSubscription";
import type { FeatureKey } from "@/lib/featureGates";
import { triggerHapticSelection } from "@/lib/haptics";
import { ProUpsellScreen } from "./ProUpsellScreen";

interface ProRouteGateProps {
  /** The Pro feature this whole route requires. Free users below the gate
   *  see a calm full-screen upsell instead of the page. */
  feature: FeatureKey;
  /** The page being gated. Rendered untouched for Pro users (and while the
   *  subscription state is still resolving, the gate renders nothing). */
  children: ReactNode;
  /** Override the headline on the locked screen. */
  title?: string;
  /** Override the supporting blurb on the locked screen. */
  blurb?: string;
}

const DEFAULT_TITLE = "Recovery is a Pro feature";
const DEFAULT_BLURB =
  "Track readiness, log wellness check-ins, and get your AI recovery coach — unlock it all with Pro.";

/**
 * Full-screen Pro gate for an entire page/route.
 *
 * UX contract:
 *   • Subscription still resolving → render nothing. Avoids a "locked flash"
 *     on cold start before the profile/tier query settles.
 *   • Pro user (or any tier that meets the gate) → render the page untouched.
 *   • Free user → the shared, animated {@link ProUpsellScreen} (Welcome-to-Pro
 *     theme) with an "Upgrade to Pro" CTA that opens the paywall and a subtle
 *     "Maybe later" that pops back.
 *
 * Server-side enforcement remains authoritative; this is the client-side
 * front door so free users never reach the page chrome at all.
 */
export function ProRouteGate({
  feature,
  children,
  title,
  blurb,
}: ProRouteGateProps) {
  const { checkFeatureAccess, openPaywall, isSubscriptionResolved } =
    useSubscription();
  const navigate = useNavigate();

  // Hold off painting the locked state until the tier is known, otherwise a
  // Pro user briefly sees the upsell on every cold start of this route.
  if (!isSubscriptionResolved) return null;
  if (checkFeatureAccess(feature)) return <>{children}</>;

  return (
    <ProUpsellScreen
      title={title ?? DEFAULT_TITLE}
      blurb={blurb ?? DEFAULT_BLURB}
      onUpgrade={() => {
        triggerHapticSelection();
        openPaywall();
      }}
      onDismiss={() => navigate(-1)}
    />
  );
}
