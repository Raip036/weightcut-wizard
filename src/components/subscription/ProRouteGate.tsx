import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router-dom";
import wizardImg from "@/assets/wizard_3D.png";
import { useSubscription } from "@/hooks/useSubscription";
import type { FeatureKey } from "@/lib/featureGates";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";

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
 *   • Free user → a centered, on-brand "locked" upsell screen with the wizard
 *     hero, a lock chip, a headline + blurb, an "Upgrade to Pro" CTA that
 *     opens the paywall, and a subtle "Maybe later" that pops back.
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
  const prefersReduced = useReducedMotion();

  // Hold off painting the locked state until the tier is known, otherwise a
  // Pro user briefly sees the upsell on every cold start of this route.
  if (!isSubscriptionResolved) return null;
  if (checkFeatureAccess(feature)) return <>{children}</>;

  return (
    <motion.div
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center bg-background"
      initial={prefersReduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: prefersReduced ? 0 : 0.45, ease: "easeOut" }}
    >
      <div className="relative z-10 flex flex-col items-center w-full max-w-[340px]">
        {/* Wizard hero — gently floating. */}
        <motion.img
          src={wizardImg}
          alt=""
          draggable={false}
          className="h-[120px] w-[120px] object-contain select-none pointer-events-none"
          initial={prefersReduced ? false : { opacity: 0, y: 12 }}
          animate={
            prefersReduced
              ? { opacity: 1, y: 0 }
              : { opacity: 1, y: [0, -8, 0] }
          }
          transition={
            prefersReduced
              ? { duration: 0 }
              : {
                  opacity: { duration: 0.5, ease: "easeOut" },
                  y: { duration: 4, repeat: Infinity, ease: "easeInOut" },
                }
          }
        />

        {/* Lock chip. */}
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary ring-1 ring-primary/20">
          <Icon name="lockClosedOutline" size={13} />
          Pro
        </span>

        {/* Headline. */}
        <h1 className="mt-4 text-[24px] font-extrabold tracking-tight leading-tight text-foreground">
          {title ?? DEFAULT_TITLE}
        </h1>

        {/* Blurb. */}
        <p className="mt-2 text-[14px] leading-snug text-muted-foreground">
          {blurb ?? DEFAULT_BLURB}
        </p>

        {/* Primary CTA → paywall. */}
        <button
          type="button"
          onClick={() => {
            triggerHapticSelection();
            openPaywall();
          }}
          className={cn(
            "mt-7 w-full h-12 rounded-2xl text-[15px] font-bold text-primary-foreground",
            "bg-gradient-to-r from-primary to-secondary active:scale-[0.98] transition-transform",
          )}
          style={{ boxShadow: "0 0 24px hsl(var(--primary) / 0.35)" }}
        >
          Upgrade to Pro
        </button>

        {/* Ghost dismiss → back. */}
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mt-3 h-10 text-[14px] font-semibold text-muted-foreground active:text-foreground transition-colors"
        >
          Maybe later
        </button>
      </div>
    </motion.div>
  );
}
