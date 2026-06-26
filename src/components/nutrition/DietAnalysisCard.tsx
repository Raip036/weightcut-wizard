import { useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { X, RefreshCw, ChevronDown, Drumstick, CalendarDays, AlertTriangle } from "lucide-react";
import type { DietAnalysisResult, NutrientGap } from "@/types/dietAnalysis";
import { groupByCategory, clean } from "@/lib/dietAnalysis";
import { cn } from "@/lib/utils";
import { CoverageHero } from "./diet-analysis/CoverageHero";
import { MicronutrientGroup } from "./diet-analysis/MicronutrientGroup";
import { FoodNutrientMap } from "./diet-analysis/FoodNutrientMap";
import { GapsList } from "./diet-analysis/GapsList";
import { FixSuggestions } from "./diet-analysis/FixSuggestions";
import { MealUpgrades } from "./diet-analysis/MealUpgrades";
import { InsightsRow } from "./diet-analysis/InsightsRow";

const SEVERITY_RANK: Record<NutrientGap["severity"], number> = {
  critical: 0,
  moderate: 1,
  low: 2,
};

// Persist the minimise/expand choice so the card stays how the user left it
// across reloads and revisits, until they change it.
const MINIMISED_KEY = "diet_analysis_minimised";

interface DietAnalysisCardProps {
  analysis: DietAnalysisResult;
  onDismiss: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** Seeds the food search with a suggested food for one-tap logging. */
  onAddFood?: (food: string) => void;
}

export function DietAnalysisCard({
  analysis,
  onDismiss,
  onRefresh,
  refreshing,
  onAddFood,
}: DietAnalysisCardProps) {
  const prefersReduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);

  // Whole-card minimise. Initialised from localStorage so the card opens in the
  // state the user last chose, and persists on every toggle.
  const [minimised, setMinimised] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MINIMISED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleMinimised = () =>
    setMinimised((m) => {
      const next = !m;
      try {
        localStorage.setItem(MINIMISED_KEY, next ? "1" : "0");
      } catch {
        /* ignore storage failures */
      }
      return next;
    });

  const pv = analysis.proteinVerdict;
  const wt = analysis.weeklyTrend;

  const sortedGaps = useMemo(
    () =>
      [...(analysis.gaps ?? [])].sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          a.percentRDA - b.percentRDA,
      ),
    [analysis.gaps],
  );

  const groups = useMemo(
    () => groupByCategory(analysis.micronutrients ?? []),
    [analysis.micronutrients],
  );
  const hasMicros = (analysis.micronutrients?.length ?? 0) > 0;

  const GAPS_COLLAPSED = 3;
  const visibleGaps = expanded ? sortedGaps : sortedGaps.slice(0, GAPS_COLLAPSED);

  const hasExpandable =
    sortedGaps.length > GAPS_COLLAPSED ||
    (analysis.mealBreakdown?.length ?? 0) > 0 ||
    (analysis.mealAdditions?.length ?? 0) > 0 ||
    (analysis.vitaminRounders?.length ?? 0) > 0;

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
      className="card-surface p-4 space-y-4"
    >
      {/* Header — tap title/chevron to minimise or expand the whole card. */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={toggleMinimised}
          aria-expanded={!minimised}
          aria-label={minimised ? "Expand diet analysis" : "Minimise diet analysis"}
          className="flex items-center gap-1.5 -ml-1 rounded-xs px-1 py-0.5 active:bg-muted/40 transition-colors"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground/70 transition-transform",
              minimised && "-rotate-90",
            )}
          />
          <p className="text-[13px] font-semibold text-foreground">Diet Analysis</p>
        </button>
        <div className="flex items-center gap-0.5">
          {!minimised && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Re-analyse"
              className="h-8 w-8 flex items-center justify-center rounded-xs text-muted-foreground/60 active:text-foreground active:bg-muted/40 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          )}
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="h-8 w-8 flex items-center justify-center rounded-xs text-muted-foreground/60 active:text-foreground active:bg-muted/40 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {!minimised && (
          <motion.div
            key="da-body"
            initial={prefersReduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            className="space-y-4 overflow-hidden"
          >
      {/* Coverage hero */}
      {hasMicros && (
        <CoverageHero micronutrients={analysis.micronutrients} topGap={sortedGaps[0]} />
      )}

      {/* Summary */}
      {analysis.summary && (
        <p className="text-[13px] text-foreground/90 leading-relaxed">{clean(analysis.summary)}</p>
      )}

      {/* Protein today + 7-day trend */}
      {(pv || wt) && (
        <div className={cn("grid gap-2", pv && wt ? "grid-cols-2" : "grid-cols-1")}>
          {pv && (
            <div className="rounded-xl border border-border/40 bg-card/40 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <Drumstick className="h-3.5 w-3.5 text-primary" />
                <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80">
                  Protein today
                </span>
              </div>
              <p className="mt-1 text-[18px] font-extrabold tabular-nums leading-none text-foreground">
                {pv.gPerKg}
                <span className="text-[11px] font-bold text-muted-foreground/70"> g/kg</span>
              </p>
              <p className="mt-1 text-[11px] leading-tight text-muted-foreground/80">
                {pv.verdict === "low"
                  ? `${pv.shortfallG}g short of ${pv.targetG}g`
                  : pv.verdict === "high"
                    ? `${pv.actualG}g, well covered`
                    : `On target (${pv.actualG}/${pv.targetG}g)`}
              </p>
            </div>
          )}
          {wt && (
            <div className="rounded-xl border border-border/40 bg-card/40 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-primary" />
                <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80">
                  This week
                </span>
              </div>
              <p className="mt-1 text-[18px] font-extrabold tabular-nums leading-none text-foreground">
                {wt.proteinAvgGPerKg != null ? (
                  <>
                    {wt.proteinAvgGPerKg}
                    <span className="text-[11px] font-bold text-muted-foreground/70"> g/kg</span>
                  </>
                ) : wt.proteinAvgG != null ? (
                  <>
                    {wt.proteinAvgG}
                    <span className="text-[11px] font-bold text-muted-foreground/70"> g P</span>
                  </>
                ) : (
                  <>
                    {wt.calorieAvgKcal}
                    <span className="text-[11px] font-bold text-muted-foreground/70"> kcal</span>
                  </>
                )}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground/80 leading-snug">
                {clean(wt.note)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Micronutrient groups */}
      {hasMicros && (
        <div className="space-y-4">
          <MicronutrientGroup title="Vitamins" micros={groups.vitamins} />
          <MicronutrientGroup title="Minerals" micros={groups.minerals} />
          <MicronutrientGroup title="Fatty acids" micros={groups.fattyAcids} />
          <MicronutrientGroup title="Other" micros={groups.other} />
        </div>
      )}

      {/* Where it came from */}
      <FoodNutrientMap contributions={analysis.foodContributions ?? []} />

      {/* Gaps */}
      <GapsList gaps={visibleGaps} />

      {/* Fixes (suggestions always; rounders only when expanded) */}
      <FixSuggestions
        suggestions={analysis.suggestions ?? []}
        rounders={expanded ? analysis.vitaminRounders ?? [] : []}
        onAddFood={onAddFood}
      />

      {/* Health / performance insights */}
      <InsightsRow insights={analysis.keyInsights ?? []} />

      {/* Expanded detail */}
      {expanded && (
        <motion.div
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
        >
          <MealUpgrades
            breakdown={analysis.mealBreakdown ?? []}
            additions={analysis.mealAdditions ?? []}
          />
        </motion.div>
      )}

      {/* Expand toggle */}
      {hasExpandable && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full h-9 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-muted-foreground/80 active:text-foreground transition-colors"
        >
          {expanded ? "Show less" : "See full breakdown"}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
      )}

      {/* Empty fallback */}
      {!analysis.summary && !hasMicros && (
        <div className="flex items-center gap-2 text-muted-foreground/70 text-[12.5px]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Couldn't read enough to analyse, log a couple more meals and try again.
        </div>
      )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
