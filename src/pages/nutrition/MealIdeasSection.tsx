import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { ShimmerCrownBadge } from "@/components/subscription/ShimmerCrownBadge";
import { ProUpsellScreen } from "@/components/subscription/ProUpsellScreen";
import { useSubscription } from "@/hooks/useSubscription";
import { triggerHapticSelection } from "@/lib/haptics";

/** The reasons a free user should unlock AI meal plans — shown on the wall. */
const MEAL_PLAN_PERKS = [
  "A full day of meals built to hit your exact calorie & macro targets",
  "Swap any meal you don't fancy for an instant alternative",
  "Tune it to you - high protein, low carb, budget or fight-week prep",
  "Log the whole day, or a single meal, in one tap",
];

export function MealIdeasSection({ onOpen, lastPlanSummary }: {
  onOpen: () => void; lastPlanSummary?: string | null;
}) {
  const { checkFeatureAccess, openPaywall, isSubscriptionResolved } = useSubscription();
  const prefersReduced = useReducedMotion();
  const [wallOpen, setWallOpen] = useState(false);

  // Pro (or still resolving — avoid a locked flash on cold start) → the plain
  // card that opens the meal-plan sheet directly.
  if (!isSubscriptionResolved || checkFeatureAccess("AI_MEAL_PLANNER")) {
    return (
      <div className="card-surface rounded-2xl border border-border/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[14px] font-semibold">Meal plan ideas</h3>
            <p className="text-[12px] text-muted-foreground">
              {lastPlanSummary ?? "Generate a full day that hits your targets"}
            </p>
          </div>
          <button type="button" onClick={onOpen}
            className="rounded-xl bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground active:scale-[0.98]">
            {lastPlanSummary ? "Open" : "Generate"}
          </button>
        </div>
      </div>
    );
  }

  // Free user → a shimmering crown Pro card. Tapping anywhere opens the full
  // premium upsell wall (the shared ProUpsellScreen used by the other gates).
  return (
    <>
      <button
        type="button"
        onClick={() => { triggerHapticSelection(); setWallOpen(true); }}
        aria-label="Meal plan ideas - a Pro feature, tap to unlock"
        className="relative w-full overflow-hidden rounded-2xl p-4 text-left active:scale-[0.99] transition-transform"
        style={{
          background:
            "linear-gradient(135deg, hsl(217 91% 58% / 0.12) 0%, hsl(221 83% 46% / 0.06) 60%, transparent 100%)",
          boxShadow: "inset 0 0 0 1px hsl(217 91% 58% / 0.35), 0 0 22px hsl(217 91% 58% / 0.10)",
        }}
      >
        {/* periodic gloss shimmer sweeping across the card */}
        {!prefersReduced && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-white/10"
            style={{ transform: "skewX(-20deg)" }}
            initial={{ x: "-160%" }}
            animate={{ x: "460%" }}
            transition={{ duration: 1.3, ease: "easeOut", repeat: Infinity, repeatDelay: 3.2, delay: 1 }}
          />
        )}

        <div className="relative flex items-center gap-3.5">
          <ShimmerCrownBadge size={42} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-semibold">Meal plan ideas</h3>
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary ring-1 ring-primary/25">
                Pro
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Generate a full day that hits your targets
            </p>
          </div>
          <span className="shrink-0 rounded-xl bg-gradient-to-r from-primary to-secondary px-3 py-2 text-[12px] font-bold text-primary-foreground">
            Unlock
          </span>
        </div>
      </button>

      {wallOpen &&
        createPortal(
          <div className="fixed inset-0 z-[60] h-screen-safe overflow-y-auto overscroll-contain bg-background animate-in fade-in duration-300">
            <ProUpsellScreen
              title="Unlock AI meal plans"
              blurb="Let the Wizard plan a full day of meals tuned to your targets and training - then log it in a tap."
              perks={MEAL_PLAN_PERKS}
              onUpgrade={() => { triggerHapticSelection(); setWallOpen(false); openPaywall(); }}
              onDismiss={() => setWallOpen(false)}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
