import { useState } from "react";
import { Sparkles, ChevronRight, Lock } from "lucide-react";
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

  // ── Free: legible locked teaser → value preview before the paywall ──
  return (
    <>
      <motion.button
        onClick={() => setTeaserOpen(true)}
        initial={prefersReduced ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        whileTap={prefersReduced ? undefined : { scale: 0.98 }}
        transition={prefersReduced ? { duration: 0 } : { duration: 0.4, ease: "easeOut" }}
        className="card-surface w-full p-4 flex items-center gap-3 rounded-2xl text-left"
      >
        {/* Shimmering crown crest: shared premium marker */}
        <ShimmerCrownBadge size={40} />
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-foreground">Analyse my day</span>
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary ring-1 ring-primary/20 leading-none">
              Pro
            </span>
          </span>
          <span className="block text-[12px] text-muted-foreground/80 leading-snug mt-0.5">
            See your protein g/kg &amp; micronutrient gaps
          </span>
        </span>
        <Lock className="h-4 w-4 text-muted-foreground/50 shrink-0" />
      </motion.button>

      <DietAnalysisTeaserDialog open={teaserOpen} onOpenChange={setTeaserOpen} />
    </>
  );
}
