import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { ThemeToggle } from "@/components/ThemeToggle";
import wizardNutrition from "@/assets/wizard-nutrition.webp";
import { useAuth } from "@/contexts/UserContext";
import { WizardLoader } from "@/components/ui/WizardLoader";

// Cold-start grace period: Convex auth can briefly report
// `{ isLoading: false, isAuthenticated: false }` between mount and
// session restoration for a returning user. Without this guard, the
// landing CTA would flash for a frame in that window between the splash
// fade and the dashboard. We hold the splash for this long on first paint.
const BOOT_GRACE_MS = 1200;

// ── Price model ──────────────────────────────────────────────────────
// Headline UK monthly costs for the three professional services
// FightCamp Wizard collapses into one app. Sources: Boxing Science /
// John Gaule Nutrition (nutritionist), More Than Muscle / Strength
// Ambassadors (S&C), TreatCompare / HMDG Barometer (physio).
// Erring slightly conservative so the number reads credible, not hyped.
const PRO_COSTS = {
  nutritionist: 160,
  sandc: 300,
  recovery: 300,
} as const;
const PRO_TOTAL = PRO_COSTS.nutritionist + PRO_COSTS.sandc + PRO_COSTS.recovery; // £760
const APP_PRICE = 12.99;
const MONTHLY_SAVINGS = Math.round(PRO_TOTAL - APP_PRICE); // £747

// Bar chart geometry — heights are percentages of the plot area so the
// stack reads at a glance: nutritionist is the small one, S&C and
// recovery tie for the chunky ones, app price is a hairline next door.
// We pick a compact plot height (96px) so the legend underneath stays
// visible on iPhone SE without overflow.
const PLOT_HEIGHT_PX = 96;
const PRO_SEG_PCT = {
  nutritionist: (PRO_COSTS.nutritionist / PRO_TOTAL) * 100, // ~21%
  sandc: (PRO_COSTS.sandc / PRO_TOTAL) * 100, // ~39.5%
  recovery: (PRO_COSTS.recovery / PRO_TOTAL) * 100, // ~39.5%
};
// App bar would mathematically be ~1.6px tall at 96px plot height —
// floor it so it's still readable + tappable without misrepresenting
// the comparison (the size disparity is the message anyway).
const APP_BAR_PX = Math.max(10, Math.round((APP_PRICE / PRO_TOTAL) * PLOT_HEIGHT_PX));

// Legend row used under the bar chart. Colour dot matches the
// corresponding segment in the stacked bar so the user can map
// the geometry to a real service at a glance.
function LegendRow({ color, label, price }: { color: string; label: string; price: number }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${color}`} aria-hidden />
        <span className="text-[13px] text-foreground/90 truncate">{label}</span>
      </div>
      <span className="text-[13px] font-semibold tabular-nums text-muted-foreground flex-shrink-0">
        £{price}<span className="text-[10px] font-medium ml-0.5">/mo</span>
      </span>
    </div>
  );
}

const Index = () => {
  const navigate = useNavigate();
  const { userId, hasProfile, isLoading, isCoach, isSessionValid } = useAuth();
  const prefersReducedMotion = useReducedMotion();

  // Hold the splash for a brief window even when auth has "settled" to
  // no-session — Convex can flicker through that state on cold start
  // before restoring a returning user's session.
  const [bootGraceExpired, setBootGraceExpired] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setBootGraceExpired(true), BOOT_GRACE_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (isLoading) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") === "true") {
      navigate("/auth?reset=true");
      return;
    }
    if (userId) {
      if (isCoach) {
        navigate("/coach", { replace: true });
        return;
      }
      if (hasProfile) {
        // Restore the last protected route the user was on if RouteTracker
        // persisted one. Falls back to /dashboard for first-ever launches
        // or when the stored value is unsafe.
        let target = "/dashboard";
        try {
          const stored = localStorage.getItem("lastRoute");
          if (
            stored &&
            stored.startsWith("/") &&
            stored !== "/" &&
            stored !== "/auth" &&
            !stored.startsWith("/onboarding")
          ) {
            target = stored;
          }
        } catch {
          /* privacy mode — silently fall back to /dashboard */
        }
        navigate(target, { replace: true });
      } else {
        navigate("/onboarding", { replace: true });
      }
    }
  }, [userId, hasProfile, isLoading, isCoach, navigate]);

  const [exiting, setExiting] = useState(false);
  const navigateWithTransition = useCallback(
    (path: string) => {
      setExiting(true);
      setTimeout(() => navigate(path), 220);
    },
    [navigate],
  );

  // Guard against the bar-chart flashing in the gap between Convex auth
  // resolving (`isSessionValid` → true) and the profile query landing.
  // During that window `userId` is internally "pending" (exposed as null)
  // and `isLoading` is already false, so without `isSessionValid` here a
  // returning user would briefly see the landing page after the 1200ms
  // boot grace before the navigation effect kicks in.
  if (isLoading || isSessionValid || userId || !bootGraceExpired) {
    return <WizardLoader />;
  }

  // Staggered bar reveal: nutritionist → S&C → recovery → app bar.
  // Each segment grows from the bottom with `originY: 1`.
  const segmentTransition = { duration: 0.9, ease: [0.22, 1, 0.36, 1] as const };
  const segmentAnim = (delay: number) =>
    prefersReducedMotion
      ? { initial: { scaleY: 1 }, animate: { scaleY: 1 }, transition: { duration: 0 } }
      : {
          initial: { scaleY: 0 },
          animate: { scaleY: 1 },
          transition: { ...segmentTransition, delay },
        };

  return (
    <div
      className="min-h-[100dvh] bg-background dark:bg-[#020204] text-foreground flex flex-col transition-opacity duration-200"
      style={{ opacity: exiting ? 0 : 1 }}
    >
      {/* Top bar — logo left, theme toggle right */}
      <div
        className="flex items-center justify-between px-5"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 10px)",
          paddingBottom: "8px",
        }}
      >
        <img
          src={wizardNutrition}
          alt="FightCamp Wizard"
          className="h-9 w-9 rounded-xl object-contain ring-1 ring-primary/20 bg-background/50 p-0.5"
        />
        <ThemeToggle />
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col px-6 pt-2">
        {/* Headline */}
        <div className="text-center">
          <h1 className="text-[26px] font-black tracking-tight leading-tight text-foreground">
            Stop paying a team.
          </h1>
          <p className="text-[13px] text-muted-foreground mt-1.5 leading-snug">
            Make weight without four invoices.
          </p>
        </div>

        {/* Savings hero */}
        <motion.div
          initial={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="text-center mt-4"
        >
          <p className="text-[10px] uppercase tracking-[0.18em] text-primary/70 font-bold">
            You save
          </p>
          <p className="display-number text-[48px] font-black leading-none tabular-nums text-primary mt-1">
            £{MONTHLY_SAVINGS}
            <span className="text-[18px] text-muted-foreground font-semibold ml-1">/mo</span>
          </p>
          <p className="text-[11px] text-muted-foreground/70 mt-1">
            £{((PRO_TOTAL - APP_PRICE) * 12).toLocaleString("en-GB", { maximumFractionDigits: 0 })} a year vs hiring the team
          </p>
        </motion.div>

        {/* Chart card — each column owns its own label + price + bar,
            all centered on the bar's horizontal axis. Price labels live
            in normal flex flow (never absolute) so nothing can clip on
            small viewports. */}
        <div className="glass-card rounded-2xl border border-border/50 p-4 mt-3">
          <div className="flex items-end justify-between gap-6">
            {/* Pro stack column */}
            <div className="flex-1 flex flex-col items-center">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
                The team
              </p>
              <p className="text-[24px] font-black tabular-nums leading-none text-foreground mt-1">
                £{PRO_TOTAL}
                <span className="text-[11px] text-muted-foreground/80 font-semibold ml-0.5">/mo</span>
              </p>
              <div
                className="w-full max-w-[120px] mt-3 rounded-xl overflow-hidden flex flex-col-reverse ring-1 ring-border/30"
                style={{ height: `${PLOT_HEIGHT_PX}px` }}
              >
                {/* Nutrition (bottom, smallest) → S&C → Recovery (top).
                    Each segment grows from the bottom with a staggered
                    scaleY for a satisfying "stack rising" reveal. */}
                <motion.div
                  {...segmentAnim(0.15)}
                  style={{ originY: 1, height: `${PRO_SEG_PCT.nutritionist}%` }}
                  className="w-full bg-amber-500/85 border-b border-background/30"
                />
                <motion.div
                  {...segmentAnim(0.27)}
                  style={{ originY: 1, height: `${PRO_SEG_PCT.sandc}%` }}
                  className="w-full bg-destructive/75 border-b border-background/30"
                />
                <motion.div
                  {...segmentAnim(0.39)}
                  style={{ originY: 1, height: `${PRO_SEG_PCT.recovery}%` }}
                  className="w-full bg-violet-400/75"
                />
              </div>
            </div>

            {/* App column */}
            <div className="flex-1 flex flex-col items-center">
              <p className="text-[10px] uppercase tracking-[0.18em] text-primary font-semibold">
                FightCamp Wizard
              </p>
              <p className="text-[24px] font-black tabular-nums leading-none text-primary mt-1">
                £{APP_PRICE}
                <span className="text-[11px] text-muted-foreground/80 font-semibold ml-0.5">/mo</span>
              </p>
              <div
                className="w-full max-w-[120px] mt-3 flex flex-col-reverse"
                style={{ height: `${PLOT_HEIGHT_PX}px` }}
              >
                <motion.div
                  initial={prefersReducedMotion ? { scaleY: 1 } : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={
                    prefersReducedMotion
                      ? { duration: 0 }
                      : { delay: 1.1, type: "spring", stiffness: 260, damping: 18 }
                  }
                  style={{ originY: 1, height: `${APP_BAR_PX}px` }}
                  className="w-full bg-primary rounded-lg shadow-lg shadow-primary/30"
                />
              </div>
            </div>
          </div>

          {/* Legend — full-word service names with colour dots that
              match the bar segments. Ordered to match the stack from
              bottom-to-top so the cheapest service (Nutrition) leads. */}
          <div className="mt-3 pt-3 border-t border-border/40 space-y-1.5">
            <LegendRow color="bg-amber-500/85" label="Nutrition" price={PRO_COSTS.nutritionist} />
            <LegendRow color="bg-destructive/75" label="Strength & Conditioning" price={PRO_COSTS.sandc} />
            <LegendRow color="bg-violet-400/75" label="Recovery" price={PRO_COSTS.recovery} />
          </div>
        </div>

        <div className="flex-1" />

        {/* CTA stack */}
        <div className="w-full space-y-2.5 pb-2">
          <button
            // First-time "Get Started" routes through the animated wizard
            // intro cutscene at /welcome. The cutscene's own CTAs forward
            // to /auth?mode=signup, so the existing sign-up contract is
            // preserved. "I already have an account" still bypasses the
            // cutscene and goes straight to /auth below.
            onClick={() => navigateWithTransition("/welcome")}
            disabled={exiting}
            className="no-tap-select w-full h-[54px] rounded-2xl bg-primary text-primary-foreground font-bold text-[16px] flex items-center justify-center gap-2 active:scale-[0.97] transition-transform disabled:opacity-70 shadow-lg shadow-primary/20"
          >
            Get Started
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => navigateWithTransition("/auth")}
            disabled={exiting}
            className="no-tap-select w-full h-[46px] rounded-2xl border border-border/70 text-foreground font-semibold text-[14px] flex items-center justify-center active:scale-[0.98] transition-transform hover:bg-muted/30 disabled:opacity-70"
          >
            I already have an account
          </button>
          <button
            onClick={() => navigateWithTransition("/coach/login")}
            disabled={exiting}
            className="no-tap-select w-full text-center text-[12px] text-muted-foreground/70 hover:text-muted-foreground transition-colors py-1 disabled:opacity-50"
          >
            I'm a coach →
          </button>
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground/60"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <button
          onClick={() => navigate("/legal?tab=privacy")}
          className="hover:text-foreground transition-colors"
        >
          Privacy
        </button>
        <span>·</span>
        <button
          onClick={() => navigate("/legal?tab=terms")}
          className="hover:text-foreground transition-colors"
        >
          Terms
        </button>
      </div>
    </div>
  );
};

export default Index;
