/**
 * CutPlanReview — standalone review of the cut plan persisted on the
 * profile. Renders the same `InlinePlanDisplay` v3 timeline as the
 * onboarding finale so the user sees ONE consistent plan UI everywhere
 * (the previous bespoke wall-of-text version was replaced 2026-05-18).
 *
 * The plan source is `localStorage.wcw_cut_plan`, written by Onboarding
 * after a successful AI generation.
 *
 * Closing via the top-right X commits the post-onboarding flags and routes
 * to the dashboard — it takes over what the dedicated "Continue to
 * Dashboard" CTA used to do. That CTA and the "Save to Gallery" button were
 * removed (they clashed) in favour of this single close action.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TrendingDown, X } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { InlinePlanDisplay } from "@/components/onboarding/InlinePlanDisplay";

export default function CutPlanReview() {
  const navigate = useNavigate();

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

  const handleContinue = () => {
    triggerHaptic(ImpactStyle.Medium);
    localStorage.setItem("wcw_cut_plan_seen", "true");
    localStorage.setItem("wcw_onboarding_just_completed", "true");
    navigate("/dashboard", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background text-foreground safe-area-inset-top safe-area-inset-bottom">
      <div className="max-w-lg mx-auto px-4 pt-6 relative">
        {/* Close button — commits the plan-seen flags and routes to the
            dashboard. Takes over the old "Continue to Dashboard" action so
            there's a single, unambiguous way off this screen. */}
        <button
          type="button"
          onClick={handleContinue}
          aria-label="Close cut plan and continue to dashboard"
          className="absolute top-4 right-3 h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground/70 bg-muted/40 dark:bg-white/[0.06] border border-border/30 active:text-foreground active:bg-muted/60 transition-colors z-30"
        >
          <X className="h-4 w-4" strokeWidth={2.4} />
        </button>

        {/* Reuse the onboarding plan timeline — same component, same data
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
