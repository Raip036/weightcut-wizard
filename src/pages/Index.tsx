import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { ThemeToggle } from "@/components/ThemeToggle";
import wizardNutrition from "@/assets/wizard-nutrition.webp";
import wizard3D from "@/assets/wizard_3D.png";
import { useAuth } from "@/contexts/UserContext";
import { WizardLoader } from "@/components/ui/WizardLoader";

// Cold-start grace period: Convex auth can briefly report
// `{ isLoading: false, isAuthenticated: false }` between mount and
// session restoration for a returning user. Without this guard, the
// landing CTA would flash for a frame in that window between the splash
// fade and the dashboard. We hold the splash for this long on first paint.
const BOOT_GRACE_MS = 1200;

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

      {/* Body — vertical stack: hero (centered in remaining space) →
          CTA stack pinned to the bottom. The hero wrapper uses flex-1
          so it absorbs the available height while the CTAs stay anchored
          regardless of viewport size. */}
      <div className="flex-1 flex flex-col px-6 py-4">
        {/* Hero — 3D wizard + headline + subhead. flex-1 inside the
            body so it occupies the middle ground; items-center keeps
            everything horizontally aligned. */}
        <div className="flex-1 flex flex-col items-center justify-center">
        <motion.img
          src={wizard3D}
          alt="FightCamp Wizard mascot"
          className="w-[180px] h-[180px] object-contain select-none pointer-events-none"
          draggable={false}
          initial={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
          animate={
            prefersReducedMotion
              ? { opacity: 1 }
              : { opacity: 1, y: [0, -6, 0] }
          }
          transition={
            prefersReducedMotion
              ? { duration: 0 }
              : {
                  opacity: { duration: 0.4, ease: "easeOut" },
                  y: { duration: 4, repeat: Infinity, ease: "easeInOut" },
                }
          }
          style={{
            filter:
              "drop-shadow(0 12px 24px rgba(64, 104, 239, 0.25)) drop-shadow(0 4px 12px rgba(0, 0, 0, 0.4))",
          }}
        />

        {/* Headline + subhead. Sora display via the `font-display` family;
            Inter (default sans) for the body copy. Centered text matches
            the centered wizard above and the centered CTAs below. */}
        <motion.div
          initial={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut", delay: 0.15 }}
          className="text-center mt-6"
        >
          <h1 className="font-display text-[26px] font-bold tracking-tight leading-[1.15] text-white">
            Make weight. Stay safe. Win the cut.
          </h1>
          <p className="mt-3 text-[13px] text-muted-foreground leading-snug max-w-[34ch] mx-auto">
            Built by fighters for fighters. Stop guessing your cut. AI plans every meal, every weigh-in, every camp.
          </p>
        </motion.div>
        </div>

        {/* CTA stack — pinned to the bottom of the body, below the
            flex-1 hero area. */}
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
            onClick={() => navigateWithTransition("/coach/welcome")}
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
