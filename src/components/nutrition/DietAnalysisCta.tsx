import { useState } from "react";
import { Sparkles, ChevronRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useSubscription } from "@/hooks/useSubscription";
import { ShimmerCrownBadge } from "@/components/subscription/ShimmerCrownBadge";
import { DietAnalysisTeaserDialog } from "./DietAnalysisTeaserDialog";

interface DietAnalysisCtaProps {
  /** Whether any meal is logged for the selected day. */
  hasMeals: boolean;
  /** True while an analysis is in flight (disables the Pro button). */
  loading: boolean;
  /** Kicks off the real analysis, only reached by Pro users. */
  onAnalyse: () => void;
}

/**
 * The "Analyse my day" call-to-action below the meal list.
 *
 * Pro users get the functional button (with a subtle gradient hairline +
 * glow). Free users get a fully-legible locked teaser that opens a value
 * preview before the paywall. Renders nothing until there's a meal to
 * analyse, and stays hidden until the subscription tier has resolved to
 * avoid a free→pro flicker on cold start (same guard `ProGate` uses).
 */
export function DietAnalysisCta({ hasMeals, loading, onAnalyse }: DietAnalysisCtaProps) {
  const { checkFeatureAccess, isSubscriptionResolved } = useSubscription();
  const [teaserOpen, setTeaserOpen] = useState(false);
  const prefersReduced = useReducedMotion();

  if (!hasMeals || !isSubscriptionResolved) return null;

  if (checkFeatureAccess("AI_DIET_ANALYSIS")) {
    // ── Pro: functional button with a faint blue→cyan hairline + glow ──
    return (
      <div className="rounded-2xl bg-gradient-to-r from-primary/40 to-secondary/40 p-px shadow-[0_0_24px_hsl(var(--primary)/0.12)]">
        <button
          onClick={onAnalyse}
          disabled={loading}
          className="card-surface w-full p-4 flex items-center gap-3 active:scale-[0.98] transition-transform rounded-2xl text-left"
        >
          <span className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5 text-primary" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[14px] font-semibold text-foreground">Analyse my day</span>
            <span className="block text-[12px] text-muted-foreground/80 leading-snug">
              Your protein g/kg and micronutrient gaps for today
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
        </button>
      </div>
    );
  }

  // ── Free: premium Pro card matching the "Meal plan ideas" card (gradient
  //    tint + inset ring/glow + shimmer sweep + Unlock pill). Tapping opens the
  //    value-preview teaser before the paywall. ──
  return (
    <>
      <motion.button
        onClick={() => setTeaserOpen(true)}
        initial={prefersReduced ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        whileTap={prefersReduced ? undefined : { scale: 0.99 }}
        transition={prefersReduced ? { duration: 0 } : { duration: 0.4, ease: "easeOut" }}
        aria-label="Analyse my day - a Pro feature, tap to unlock"
        className="relative w-full overflow-hidden rounded-2xl p-4 text-left transition-transform"
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
              <h3 className="text-[14px] font-semibold text-foreground">Analyse my day</h3>
              <span className="text-[9px] font-bold uppercase tracking-wide text-primary">
                Pro
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground leading-snug">
              See your protein g/kg &amp; micronutrient gaps
            </p>
          </div>
          <span className="shrink-0 rounded-xl bg-gradient-to-r from-primary to-secondary px-3 py-2 text-[12px] font-bold text-primary-foreground">
            Unlock
          </span>
        </div>
      </motion.button>

      <DietAnalysisTeaserDialog open={teaserOpen} onOpenChange={setTeaserOpen} />
    </>
  );
}
