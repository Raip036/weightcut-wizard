/**
 * CutPlanReview, standalone review of the cut plan persisted on the
 * profile. Renders the same `InlinePlanDisplay` v3 timeline as the
 * onboarding finale so the user sees ONE consistent plan UI everywhere
 * (the previous bespoke wall-of-text version was replaced 2026-05-18).
 *
 * The plan source is `localStorage.wcw_cut_plan`, written by Onboarding
 * after a successful AI generation.
 *
 * Closing via the top-right X commits the post-onboarding flags and routes
 * to the dashboard, it takes over what the dedicated "Continue to
 * Dashboard" CTA used to do. That CTA and the "Save to Gallery" button were
 * removed (they clashed) in favour of this single close action.
 *
 * 2026-06-06, premium pass: a slow, animated blue aurora drifts behind the
 * content layer to match the Recovery feature's editorial polish. The aurora
 * is purely decorative (`pointer-events-none`, behind a relative content
 * layer) and freezes to a static glow when reduced-motion is requested.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { useMutation } from "convex/react";
import { Button } from "@/components/ui/button";
import { TrendingDown, X } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { InlinePlanDisplay } from "@/components/onboarding/InlinePlanDisplay";
import { ProUpsellScreen } from "@/components/subscription/ProUpsellScreen";
import { useSubscription } from "@/hooks/useSubscription";
import { useProfile } from "@/contexts/UserContext";
import { api } from "@/../convex/_generated/api";

// ── Aurora background ──────────────────────────────────────────────────
// Two large, low-opacity primary-blue radial blobs that drift slowly behind
// the plan. Mirrors the Recovery hero's `blur-2xl` glow trick, scaled up to
// fill the page. Sits behind a `relative z-10` content layer and never
// intercepts taps. Honours reduced-motion by rendering a static glow.
function PlanAurora() {
  const prefersReduced = useReducedMotion();
  const blob =
    "radial-gradient(circle at center, hsl(var(--primary) / 0.5) 0%, transparent 70%)";
  // Perf: two GPU-promoted, TRANSLATE-ONLY blobs at blur-2xl. Animating only
  // translate (never scale) keeps the blurred bitmap cached on the compositor
  // so it never re-rasterizes per frame, animating scale on a heavily-blurred
  // element was the cause of the open-plan jank. `translateZ(0)` + willChange
  // forces a dedicated GPU layer so the drift is a cheap compositor transform.
  const gpu = {
    background: blob,
    willChange: "transform",
    transform: "translateZ(0)",
  } as const;

  if (prefersReduced) {
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-32 -left-24 h-[420px] w-[420px] rounded-full opacity-[0.10] blur-2xl"
          style={{ background: blob }}
        />
        <div
          className="absolute top-1/3 -right-28 h-[440px] w-[440px] rounded-full opacity-[0.08] blur-2xl"
          style={{ background: blob }}
        />
      </div>
    );
  }

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute -top-32 -left-24 h-[420px] w-[420px] rounded-full opacity-[0.10] blur-2xl"
        style={gpu}
        animate={{ x: [0, 40, -10, 0], y: [0, 30, 60, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute top-1/3 -right-28 h-[440px] w-[440px] rounded-full opacity-[0.08] blur-2xl"
        style={gpu}
        animate={{ x: [0, -32, 12, 0], y: [0, 44, 16, 0] }}
        transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

export default function CutPlanReview() {
  const navigate = useNavigate();
  const { isPremium, isSubscriptionResolved, openPaywall } = useSubscription();
  const { profile } = useProfile();
  const markOnboardingPaywallShown = useMutation(api.profiles.markOnboardingPaywallShown);
  // Post-onboarding soft paywall: shown once when a free user closes this plan
  // review at the value peak. Server flag (onboarding_paywall_shown_at) makes it
  // once-per-account; this state just drives the in-session overlay swap.
  const [showSoftPaywall, setShowSoftPaywall] = useState(false);

  const planData = useMemo(() => {
    try {
      const raw = localStorage.getItem("wcw_cut_plan");
      if (!raw) return null;
      return JSON.parse(raw) as any;
    } catch {
      return null;
    }
  }, []);

  if (!planData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <TrendingDown className="h-10 w-10 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">No plan generated yet.</p>
          <Button onClick={() => navigate("/dashboard", { replace: true })}>
            Go to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const isWeightLoss = planData?.planType === "weight_loss";

  // Commit the plan-seen flag and route to the dashboard. The single exit.
  const goToDashboard = () => {
    // Wrap in try/catch: iOS WKWebView (private mode / storage pressure) can
    // throw on setItem, which would abort before navigation and strand the user.
    try {
      localStorage.setItem("wcw_cut_plan_seen", "true");
    } catch {
      /* non-fatal, the planClosed router state below covers this case */
    }
    // ALWAYS leave via an explicit route with replace:true.
    //
    // Why not navigate(-1): it silently no-ops under iOS WKWebView (and when
    // this page is the first history entry), and the page was reached via
    // `{replace:true}` from several flows so there's often nothing to pop.
    //
    // Why `state.planClosed`: the Dashboard mounts an "unseen plan" guard that
    // redirects back to /cut-plan whenever `wcw_cut_plan` exists and
    // `wcw_cut_plan_seen` is falsy. On iOS the setItem above isn't reliably
    // durable, so the guard would read it back as unseen and snap the user
    // straight back here, the bounce loop that made the X "do nothing".
    // Router state is IN-MEMORY (immune to localStorage volatility), so the
    // guard reads `planClosed` and skips the redirect. This guarantees exit.
    navigate("/dashboard", { replace: true, state: { planClosed: true } });
  };

  // Close action. At the value peak (free user closing their reviewed plan),
  // show the post-onboarding soft paywall once before leaving; otherwise exit.
  const handleContinue = () => {
    triggerHaptic(ImpactStyle.Medium);
    const eligible =
      isSubscriptionResolved &&
      !isPremium &&
      !!profile &&
      !profile.onboarding_paywall_shown_at &&
      !showSoftPaywall;
    if (eligible) {
      // Mark seen now so the dashboard "unseen plan" guard won't bounce us back
      // when we eventually navigate out from the paywall.
      try {
        localStorage.setItem("wcw_cut_plan_seen", "true");
      } catch {
        /* non-fatal */
      }
      markOnboardingPaywallShown({}).catch(() => {
        /* non-fatal: a missed CAS just means it may show once more later */
      });
      setShowSoftPaywall(true);
      return;
    }
    goToDashboard();
  };

  if (showSoftPaywall) {
    return (
      <div className="min-h-screen w-full overflow-y-auto bg-background">
        <ProUpsellScreen
          source="cut_plan_review"
          title="Unlock your full fight camp"
          blurb="Your starter plan is yours to keep. Go Pro for everything that wins fight week."
          perks={[
            "Full day-by-day fight-week protocol",
            "Hour-by-hour rehydration timeline",
            "AI cornerman chat, anytime",
            "Unlimited meal and diet analysis",
            "Weekly training and recovery insights",
          ]}
          upgradeLabel="Unlock Pro"
          dismissLabel="Continue with my free plan"
          onUpgrade={() => openPaywall("cut_plan_review")}
          onDismiss={goToDashboard}
        />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground safe-area-inset-top safe-area-inset-bottom overflow-hidden">
      {/* Animated blue aurora behind everything. */}
      <PlanAurora />

      {/* Content layer, sits above the aurora. */}
      <div className="relative z-10 max-w-lg mx-auto px-4 pt-6">
        {/* Close button, commits the plan-seen flags and routes to the
            dashboard. Takes over the old "Continue to Dashboard" action so
            there's a single, unambiguous way off this screen. */}
        <button
          type="button"
          onClick={handleContinue}
          aria-label="Close cut plan and continue to dashboard"
          className="absolute top-4 right-3 h-9 w-9 flex items-center justify-center rounded-full bg-muted/70 text-foreground border border-border/60 shadow-sm backdrop-blur-sm active:scale-95 active:bg-muted transition-all z-30"
        >
          <X className="h-[18px] w-[18px]" strokeWidth={2.6} />
        </button>

        {/* Reuse the onboarding plan timeline, same component, same data
            shape. Its sticky CTA is hidden here (`showContinue={false}`); the
            close X above handles routing. */}
        <InlinePlanDisplay
          plan={planData}
          planType={isWeightLoss ? "weight_loss" : "cut"}
          onContinue={handleContinue}
          showContinue={false}
        />
      </div>
    </div>
  );
}
