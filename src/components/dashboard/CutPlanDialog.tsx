/**
 * CutPlanDialog — thin bottom-sheet wrapper around the canonical
 * `InlinePlanDisplay` timeline. Kept as a wrapper (not deleted) so any
 * pre-existing call sites keep working — but the legacy bespoke
 * wall-of-text rendering it used to do was removed on 2026-05-18 to
 * guarantee the user sees the SAME plan UI everywhere (onboarding,
 * /cut-plan review, profile, dashboard).
 *
 * The plan source remains `localStorage.wcw_cut_plan`, same JSON the
 * route-based CutPlanReview reads.
 */
import { useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Icon } from "@/components/ui/Icon";
import { InlinePlanDisplay } from "@/components/onboarding/InlinePlanDisplay";

interface CutPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CutPlanDialog({ open, onOpenChange }: CutPlanDialogProps) {
  const planData = useMemo(() => {
    try {
      const raw = localStorage.getItem("wcw_cut_plan");
      if (!raw) return null;
      return JSON.parse(raw) as any;
    } catch {
      return null;
    }
    // Re-read every time the sheet opens — the plan can be regenerated
    // elsewhere in the app and we want fresh data on each present.

  }, []);

  if (!planData) return null;

  const isWeightLoss = planData?.planType === "weight_loss";
  const title = isWeightLoss ? "Your Weight Loss Plan" : "Your Weight Cut Plan";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[90vh] rounded-t-2xl flex flex-col p-0 gap-0 [&>button]:hidden"
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
        </div>

        <SheetHeader className="px-5 pb-3 pt-1 text-left shrink-0 relative pr-12">
          <SheetTitle className="text-lg font-bold">{title}</SheetTitle>
          <p className="text-xs text-muted-foreground">Personalised · Science-backed · Adaptive</p>
          {/* Explicit close — Radix's built-in X is suppressed via the
              SheetContent class so this button is the only exit. */}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close cut plan"
            className="absolute right-3 top-1 h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground/80 bg-muted/40 dark:bg-white/[0.06] border border-border/30 active:text-foreground active:bg-muted/60 transition-colors"
          >
            <Icon name="closeOutline" size={16} />
          </button>
        </SheetHeader>

        <div
          className="flex-1 min-h-0 overflow-y-auto scrollbar-hide scroll-touch"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)" }}
        >
          {/* Reuse the canonical onboarding plan timeline — same component,
              same data shape, identical visuals to /cut-plan + /weight-plan
              and the post-onboarding review. `onContinue` simply dismisses
              the sheet since this surface is a read-only revisit. */}
          <InlinePlanDisplay
            plan={planData}
            planType={isWeightLoss ? "weight_loss" : "cut"}
            onContinue={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
