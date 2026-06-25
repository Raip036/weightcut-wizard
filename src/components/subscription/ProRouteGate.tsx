import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSubscription } from "@/hooks/useSubscription";
import { useSafeDismiss } from "@/hooks/useSafeDismiss";
import { useClearStuckPointerEvents } from "@/hooks/useClearStuckPointerEvents";
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
  "Track readiness, log wellness check-ins, and get your AI recovery coach. Unlock it all with Pro.";

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
  const dismiss = useSafeDismiss();
  // Clear any stuck `body { pointer-events: none }` left by a badly-closed
  // Radix/vaul overlay so this full-screen gate's buttons aren't frozen.
  useClearStuckPointerEvents();

  // Hold off painting the locked state until the tier is known, otherwise a
  // Pro user briefly sees the upsell on every cold start of this route.
  if (!isSubscriptionResolved) return null;
  if (checkFeatureAccess(feature)) return <>{children}</>;

  // Portal to <body> so the gate anchors to the viewport, not the transformed
  // `.page-transition-page` ancestor it's rendered under (which would clip it
  // and let the page scroll out from beneath it). `z-[60]` keeps it below the
  // floating bottom nav (z-[9999]) so the user can still switch tabs; the
  // premium background fills the entire viewport (incl. behind the nav) and the
  // gate is its own `overscroll-contain` scroll container.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] h-screen-safe overflow-y-auto overscroll-contain bg-background animate-in fade-in duration-300 pointer-events-auto"
      style={{ pointerEvents: "auto" }}
    >
      <ProUpsellScreen
        title={title ?? DEFAULT_TITLE}
        blurb={blurb ?? DEFAULT_BLURB}
        onUpgrade={() => {
          triggerHapticSelection();
          openPaywall();
        }}
        onDismiss={dismiss}
      />
    </div>,
    document.body,
  );
}
