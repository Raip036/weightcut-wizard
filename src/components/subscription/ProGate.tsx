import type { ReactNode } from "react";
import { useSubscription } from "@/hooks/useSubscription";
import type { FeatureKey } from "@/lib/featureGates";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";

interface ProGateProps {
  /** The Pro feature this CTA invokes. When a free user is below the
   *  gate, the wrapper paints a glass-blur lock state and routes taps
   *  to the paywall instead of letting the wrapped button fire. */
  feature: FeatureKey;
  /** The button / CTA being gated. Its own onClick fires unchanged for
   *  Pro users; for free users it's neutralized by `pointer-events-none`
   *  and the wrapper handles the tap. */
  children: ReactNode;
  /** Override the chip text (defaults to "Pro"). Useful when a feature
   *  has a more specific upsell hook ("Pro plan", "Pro feature"). */
  label?: string;
  /** Optional class on the gate wrapper. Use to add `w-full`, margins,
   *  or other layout sugar without touching the inner button. */
  className?: string;
}

/**
 * Glass-blur lock-off wrapper for Pro-gated CTAs.
 *
 * UX contract:
 *   • Pro user → no wrapper, no overlay; children render & behave
 *     exactly as the caller wrote them (zero layout cost).
 *   • Free user → children are frosted (`filter: blur + saturate` +
 *     reduced opacity) and `pointer-events-none` so they can't fire.
 *     A centered glass chip (lockClosedOutline + "PRO") floats over
 *     the button. A tap anywhere routes to the paywall.
 *   • Subscription state still resolving → children render as-is to
 *     avoid a "locked flash" on cold start.
 *
 * Server-side enforcement (`enforceFeatureGate`) is authoritative; this
 * component is UX sugar to keep free users from bouncing off a
 * `PRO_FEATURE_REQUIRED` error mid-action.
 */
export function ProGate({
  feature,
  children,
  label = "Pro",
  className = "",
}: ProGateProps) {
  const { checkFeatureAccess, openPaywall, isSubscriptionResolved } =
    useSubscription();

  // Don't paint the locked state while the profile query is still in
  // flight; that produces a brief lock flash on every cold-start of a
  // page that contains a Pro CTA.
  if (!isSubscriptionResolved) return <>{children}</>;
  if (checkFeatureAccess(feature)) return <>{children}</>;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label} feature, tap to upgrade`}
      onClick={() => {
        triggerHapticSelection();
        openPaywall(feature);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          triggerHapticSelection();
          openPaywall(feature);
        }
      }}
      className={`relative cursor-pointer select-none ${className}`}
    >
      {/* Phantom children: take up the exact dimensions of the real
          button so the wrapper sizes match the unlocked state. They're
          invisible + pointer-events-none, so users never interact with
          the original CTA when locked. */}
      <div aria-hidden className="pointer-events-none invisible">
        {children}
      </div>
      {/* Replacement CTA: a clean "Upgrade to Pro" button that fills
          the same footprint. Matches the app's standard rounded-xs
          primary button styling so it slots into any page layout. */}
      <div className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-xs bg-primary text-primary-foreground px-2 active:scale-[0.98] transition-transform">
        <Icon name="lockClosedOutline" size={14} className="shrink-0" />
        <span className="text-[13px] font-bold tracking-tight whitespace-nowrap">
          Upgrade to {label}
        </span>
      </div>
    </div>
  );
}
