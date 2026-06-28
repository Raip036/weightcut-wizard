import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
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

  // Escape hatch: a returning user can be authenticated (`isSessionValid`)
  // yet have their profile resolve to null (orphaned/missing profile row),
  // leaving `userId` null forever — the loader below would spin indefinitely
  // and the navigation effect would never fire. After a grace window in that
  // exact stuck state, fall back to /auth so the user is never dead-ended.
  useEffect(() => {
    if (isLoading || userId) return;
    if (!isSessionValid) return;
    const t = setTimeout(() => {
      navigate("/auth", { replace: true });
    }, 8000);
    return () => clearTimeout(t);
  }, [isLoading, userId, isSessionValid, navigate]);

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
    /* Page bg uses var(--background) (#0F0F0F / neutral-1000) — the
       previous `dark:bg-[#020204]` override forced an off-brand black,
       removed so the welcome page matches the rest of the app. */
    <div
      className="min-h-[100dvh] bg-background text-foreground flex flex-col transition-opacity duration-200"
      style={{ opacity: exiting ? 0 : 1 }}
    >
      {/* Top spacer — honors safe-area inset so the wizard hero sits
          below the iOS status bar / dynamic island. The previous
          logo + ThemeToggle bar was removed; the wizard mascot below
          is the brand mark now. */}
      <div
        aria-hidden
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
      />

      {/* Body — vertical stack: hero (centered in remaining space) →
          CTA stack pinned to the bottom. The hero wrapper uses flex-1
          so it absorbs the available height while the CTAs stay anchored
          regardless of viewport size. */}
      <div className="flex-1 flex flex-col px-6 py-4">
        {/* Hero — 3D wizard + headline + subhead. flex-1 inside the
            body so it occupies the middle ground. `justify-center`
            centers the wizard+text block vertically; the small mt-6
            below (down from mt-16) brings the headline up close to
            the wizard's feet rather than separating them with empty
            space. */}
        <div className="flex-1 flex flex-col items-center justify-center">
          {/* Wizard mascot with floating bob — wrapped in a relative
              container so the sparkles can position absolutely around it. */}
          <div className="relative">
            <motion.img
              src={wizard3D}
              alt="FightCamp Wizard mascot"
              className="w-[300px] h-[300px] object-contain select-none pointer-events-none"
              draggable={false}
              initial={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
              animate={
                prefersReducedMotion
                  ? { opacity: 1 }
                  : { opacity: 1, y: [0, -8, 0] }
              }
              transition={
                prefersReducedMotion
                  ? { duration: 0 }
                  : {
                      opacity: { duration: 0.5, ease: "easeOut" },
                      y: { duration: 4, repeat: Infinity, ease: "easeInOut" },
                    }
              }
              style={{
                filter:
                  "drop-shadow(0 16px 32px rgba(64, 104, 239, 0.35)) drop-shadow(0 6px 16px rgba(0, 0, 0, 0.5))",
              }}
            />

            {/* Sparkles — 5 around the wizard, each with its own
                position, color, size, and twinkle loop so the magic
                feels alive rather than mechanically synced. */}
            {!prefersReducedMotion && (
              <>
                <motion.span
                  aria-hidden
                  className="absolute"
                  style={{ top: 18, right: -10 }}
                  animate={{ opacity: [0.3, 1, 0.3], y: [0, -6, 0], rotate: [0, 20, 0] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
                >
                  <Sparkles className="h-5 w-5 text-brand-wizard-lilac" strokeWidth={1.4} fill="currentColor" />
                </motion.span>
                <motion.span
                  aria-hidden
                  className="absolute"
                  style={{ top: 36, left: -8 }}
                  animate={{ opacity: [0.25, 0.85, 0.25], y: [0, 4, 0], scale: [0.85, 1.05, 0.85] }}
                  transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
                >
                  <Sparkles className="h-4 w-4 text-brand-dream-cyan" strokeWidth={1.4} fill="currentColor" />
                </motion.span>
                <motion.span
                  aria-hidden
                  className="absolute"
                  style={{ top: 90, right: 24 }}
                  animate={{ opacity: [0.2, 0.75, 0.2], y: [0, -4, 0] }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut", delay: 1.4 }}
                >
                  <Sparkles className="h-3 w-3 text-white/90" strokeWidth={1.5} fill="currentColor" />
                </motion.span>
                <motion.span
                  aria-hidden
                  className="absolute"
                  style={{ bottom: 60, left: 12 }}
                  animate={{ opacity: [0.3, 0.9, 0.3], y: [0, 3, 0], rotate: [0, -18, 0] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
                >
                  <Sparkles className="h-[14px] w-[14px] text-brand-wizard-lilac" strokeWidth={1.4} fill="currentColor" />
                </motion.span>
                <motion.span
                  aria-hidden
                  className="absolute"
                  style={{ top: 8, left: 80 }}
                  animate={{ opacity: [0.15, 0.7, 0.15], scale: [0.7, 1, 0.7] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 1.1 }}
                >
                  <Sparkles className="h-[10px] w-[10px] text-brand-dream-cyan" strokeWidth={1.5} fill="currentColor" />
                </motion.span>
              </>
            )}
          </div>

          {/* Headline + subhead. mt-6 keeps the text close to the
              wizard's feet — the previous mt-16 left an awkward void
              between them. Title uses Sora display at 34px to amplify
              the size contrast against the 13px Inter body. */}
          <motion.div
            initial={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut", delay: 0.2 }}
            className="text-center mt-6"
          >
            <h1 className="font-display text-[34px] font-bold tracking-tight leading-[1.1] text-white">
              Make weight. Stay safe. Win the cut.
            </h1>
            <p className="mt-4 text-[13px] text-muted-foreground leading-snug max-w-[32ch] mx-auto">
              Built by fighters for fighters. AI plans every meal, every weigh-in, every camp.
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
            className="no-tap-select w-full h-[54px] rounded-xs bg-primary text-primary-foreground font-bold text-[16px] flex items-center justify-center gap-2 active:scale-[0.97] transition-transform disabled:opacity-70"
          >
            Get Started
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => navigateWithTransition("/auth")}
            disabled={exiting}
            className="no-tap-select w-full h-[46px] rounded-xs border border-border/70 text-foreground font-semibold text-[14px] flex items-center justify-center active:scale-[0.98] transition-transform hover:bg-muted/30 disabled:opacity-70"
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
