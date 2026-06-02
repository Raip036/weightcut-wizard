import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  X,
  RefreshCw,
  Plus,
  Sparkles,
  ChevronDown,
  Drumstick,
  CalendarDays,
  AlertTriangle,
} from "lucide-react";
import type { DietAnalysisResult, NutrientGap } from "@/types/dietAnalysis";
import { cn } from "@/lib/utils";

// Status colour for a micronutrient ring / gap — red (low) → amber (ok) →
// emerald (good). Reads "am I covered?" at a glance instead of leaning on
// per-nutrient brand colours that carry no good/bad meaning.
function status(pct: number): { color: string; label: string } {
  if (pct >= 70) return { color: "rgb(16 185 129)", label: "good" };
  if (pct >= 40) return { color: "rgb(245 158 11)", label: "getting there" };
  return { color: "rgb(239 68 68)", label: "low" };
}

const SEVERITY_RANK: Record<NutrientGap["severity"], number> = {
  critical: 0,
  moderate: 1,
  low: 2,
};

/** Strip a trailing quantity so "Salmon (100g)" seeds the search as "Salmon". */
function cleanFoodName(food: string): string {
  return food.replace(/\s*\([^)]*\)\s*$/, "").trim() || food.trim();
}

function NutrientRing({ name, percentRDA }: { name: string; percentRDA: number }) {
  const size = 56;
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(percentRDA / 100, 1);
  const offset = circumference * (1 - progress);
  const { color, label } = status(percentRDA);

  return (
    <div
      className="flex flex-col items-center gap-1"
      role="img"
      aria-label={`${name}: ${percentRDA}% of daily target, ${label}`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-border/20" />
          {progress > 0 && (
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
              strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dashoffset 0.8s ease" }} />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[11px] font-bold tabular-nums" style={{ color }}>{percentRDA}%</span>
        </div>
      </div>
      <span className="text-[9px] text-muted-foreground/70 text-center leading-tight">{name}</span>
    </div>
  );
}

// Defensive: the AI sometimes returns rows with missing string fields.
const clean = (t: string | null | undefined) =>
  typeof t === "string" ? t.replace(/—/g, " - ").replace(/–/g, "-") : "";

/** Small "+ Add" pill that seeds the food search with a suggested food. */
function AddFoodButton({ food, onAddFood }: { food: string; onAddFood?: (food: string) => void }) {
  if (!onAddFood) return null;
  return (
    <button
      type="button"
      onClick={() => onAddFood(cleanFoodName(food))}
      className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-primary/15 text-primary text-[11px] font-bold active:scale-[0.96] active:bg-primary/25 transition-all"
      aria-label={`Add ${cleanFoodName(food)} to your meals`}
    >
      <Plus className="h-3 w-3" strokeWidth={3} />
      Add
    </button>
  );
}

const SECTION_LABEL =
  "text-[10px] uppercase tracking-widest text-muted-foreground font-semibold";

interface DietAnalysisCardProps {
  analysis: DietAnalysisResult;
  onDismiss: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** Seeds the food search with a suggested food for one-tap logging. */
  onAddFood?: (food: string) => void;
}

export function DietAnalysisCard({ analysis, onDismiss, onRefresh, refreshing, onAddFood }: DietAnalysisCardProps) {
  const prefersReduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);

  const pv = analysis.proteinVerdict;
  const wt = analysis.weeklyTrend;

  // Gaps, most-severe first (then lowest %RDA within a severity).
  const sortedGaps = useMemo(
    () =>
      [...(analysis.gaps ?? [])].sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          a.percentRDA - b.percentRDA,
      ),
    [analysis.gaps],
  );
  // Rings: surface the lowest micros first so gaps lead.
  const sortedMicros = useMemo(
    () => [...(analysis.micronutrients ?? [])].sort((a, b) => a.percentRDA - b.percentRDA),
    [analysis.micronutrients],
  );

  // The single most important takeaway. Protein wins when it's notably
  // short (it's what matters most for a cutting fighter); otherwise the
  // worst micronutrient gap leads.
  const headline = useMemo(() => {
    if (pv && pv.verdict === "low" && pv.shortfallG >= 15) {
      return {
        label: "Today's priority",
        value: `+${pv.shortfallG}g protein`,
        detail: `You're at ${pv.gPerKg} g/kg — aim for ~${pv.targetGPerKg} to hold muscle while cutting.`,
        tone: "amber" as const,
      };
    }
    const worst = sortedGaps[0];
    if (worst) {
      return {
        label: "Biggest gap today",
        value: worst.nutrient,
        detail: `${worst.percentRDA}% of target — ${clean(worst.reason)}`,
        tone: worst.severity === "critical" ? ("red" as const) : ("amber" as const),
      };
    }
    if (pv && pv.verdict === "on_track") {
      return {
        label: "Looking solid",
        value: "Protein on track",
        detail: `${pv.gPerKg} g/kg today — right in the muscle-sparing zone.`,
        tone: "green" as const,
      };
    }
    return null;
  }, [pv, sortedGaps]);

  const headlineTone = {
    red: "from-red-500/15 ring-red-500/25 text-red-300",
    amber: "from-amber-500/15 ring-amber-500/25 text-amber-300",
    green: "from-emerald-500/15 ring-emerald-500/25 text-emerald-300",
  };

  const RING_COLLAPSED = 6;
  const GAPS_COLLAPSED = 3;
  const SUGG_COLLAPSED = 3;
  const visibleMicros = expanded ? sortedMicros : sortedMicros.slice(0, RING_COLLAPSED);
  const visibleGaps = expanded ? sortedGaps : sortedGaps.slice(0, GAPS_COLLAPSED);
  const suggestions = analysis.suggestions ?? [];
  const visibleSuggestions = expanded ? suggestions : suggestions.slice(0, SUGG_COLLAPSED);
  const hasMore =
    sortedMicros.length > RING_COLLAPSED ||
    sortedGaps.length > GAPS_COLLAPSED ||
    suggestions.length > SUGG_COLLAPSED ||
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-foreground">Diet Analysis</p>
        <div className="flex items-center gap-0.5">
          <button onClick={onRefresh} disabled={refreshing} aria-label="Re-analyse"
            className="h-8 w-8 flex items-center justify-center rounded-xs text-muted-foreground/60 active:text-foreground active:bg-muted/40 transition-colors disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button onClick={onDismiss} aria-label="Dismiss"
            className="h-8 w-8 flex items-center justify-center rounded-xs text-muted-foreground/60 active:text-foreground active:bg-muted/40 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Headline insight — the one thing to act on. */}
      {headline && (
        <motion.div
          initial={prefersReduced ? false : { opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: prefersReduced ? 0 : 0.1, ease: "backOut" }}
          className={cn(
            "rounded-2xl bg-gradient-to-br to-transparent ring-1 px-4 py-3",
            headlineTone[headline.tone],
          )}
        >
          <p className="text-[10px] uppercase tracking-widest font-bold opacity-80">{headline.label}</p>
          <p className="mt-0.5 text-[20px] font-extrabold tracking-tight text-foreground leading-tight">{headline.value}</p>
          <p className="mt-1 text-[12.5px] text-foreground/80 leading-snug">{headline.detail}</p>
        </motion.div>
      )}

      {/* Summary */}
      {analysis.summary && (
        <p className="text-[13px] text-foreground/90 leading-relaxed">{clean(analysis.summary)}</p>
      )}

      {/* Protein today + 7-day trend strip. */}
      {(pv || wt) && (
        <div className={cn("grid gap-2", pv && wt ? "grid-cols-2" : "grid-cols-1")}>
          {pv && (
            <div className="rounded-xl border border-border/40 bg-card/40 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <Drumstick className="h-3.5 w-3.5 text-primary" />
                <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80">Protein today</span>
              </div>
              <p className="mt-1 text-[18px] font-extrabold tabular-nums leading-none text-foreground">
                {pv.gPerKg}
                <span className="text-[11px] font-bold text-muted-foreground/70"> g/kg</span>
              </p>
              <p className="mt-1 text-[11px] leading-tight"
                style={{ color: pv.verdict === "low" ? "rgb(245 158 11)" : "rgb(16 185 129)" }}>
                {pv.verdict === "low"
                  ? `${pv.shortfallG}g short of ${pv.targetG}g`
                  : pv.verdict === "high"
                    ? `${pv.actualG}g — well covered`
                    : `On target (${pv.actualG}/${pv.targetG}g)`}
              </p>
            </div>
          )}
          {wt && (
            <div className="rounded-xl border border-border/40 bg-card/40 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-primary" />
                <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80">This week</span>
              </div>
              <p className="mt-1 text-[18px] font-extrabold tabular-nums leading-none text-foreground">
                {wt.proteinAvgGPerKg != null ? (
                  <>{wt.proteinAvgGPerKg}<span className="text-[11px] font-bold text-muted-foreground/70"> g/kg</span></>
                ) : wt.proteinAvgG != null ? (
                  <>{wt.proteinAvgG}<span className="text-[11px] font-bold text-muted-foreground/70"> g P</span></>
                ) : (
                  <>{wt.calorieAvgKcal}<span className="text-[11px] font-bold text-muted-foreground/70"> kcal</span></>
                )}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground/80 leading-tight line-clamp-2">{clean(wt.note)}</p>
            </div>
          )}
        </div>
      )}

      {/* Micronutrient rings — status-coloured, lows first. */}
      {visibleMicros.length > 0 && (
        <div>
          <p className={cn(SECTION_LABEL, "text-center mb-3")}>Micronutrients</p>
          <div className="grid grid-cols-4 gap-2 justify-items-center">
            {visibleMicros.map((n) => (
              <NutrientRing key={n.name} name={n.name} percentRDA={n.percentRDA} />
            ))}
          </div>
        </div>
      )}

      {/* Top gaps — warm-tinted (these are the problems). */}
      {visibleGaps.length > 0 && (
        <div>
          <p className={cn(SECTION_LABEL, "mb-2")}>Gaps to close</p>
          <div className="space-y-1.5">
            {visibleGaps.map((gap) => {
              const c = status(gap.percentRDA).color;
              return (
                <div key={gap.nutrient} className="rounded-xl bg-amber-500/[0.06] ring-1 ring-amber-500/15 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: c }} />
                    <span className="text-[13px] font-semibold text-foreground flex-1">{gap.nutrient}</span>
                    <span className="text-[11px] tabular-nums font-semibold" style={{ color: c }}>{gap.percentRDA}%</span>
                  </div>
                  {gap.reason && (
                    <p className="text-[12px] text-foreground/75 leading-relaxed mt-0.5 ml-4">{clean(gap.reason)}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Suggestions to fix gaps — one-tap add. */}
      {visibleSuggestions.length > 0 && (
        <div>
          <p className={cn(SECTION_LABEL, "mb-2")}>Add to close them</p>
          <div className="space-y-1.5">
            {visibleSuggestions.map((s, i) => (
              <div key={i} className="rounded-xl bg-primary/[0.06] ring-1 ring-primary/15 px-3.5 py-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground">{s.food}</p>
                    <p className="text-[12px] text-foreground/75 leading-relaxed mt-0.5">{clean(s.reason)}</p>
                  </div>
                  <AddFoodButton food={s.food} onAddFood={onAddFood} />
                </div>
                {(s.nutrients ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {s.nutrients.map((n) => (
                      <span key={n} className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">{n}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expanded detail. */}
      {expanded && (
        <motion.div
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          className="space-y-4"
        >
          {/* Per-meal breakdown */}
          {(analysis.mealBreakdown?.length ?? 0) > 0 && (
            <div>
              <p className={cn(SECTION_LABEL, "mb-2")}>Per meal</p>
              <div className="space-y-1">
                {analysis.mealBreakdown!.map((meal, i) => (
                  <div key={i} className="px-3 py-2 rounded-xl bg-muted/15">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-primary">{meal.mealType}</span>
                      <span className="text-[13px] font-medium text-foreground truncate">{meal.mealName}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                      {(meal.keyNutrients ?? []).map((n, j) => (
                        <span key={j} className="text-[10px] text-foreground/70">
                          <span className="font-medium text-foreground/90">{n.name}</span> {n.amount}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-meal upgrades */}
          {(analysis.mealAdditions?.length ?? 0) > 0 && (
            <div>
              <p className={cn(SECTION_LABEL, "mb-2")}>Upgrade each meal</p>
              <div className="space-y-1.5">
                {analysis.mealAdditions!.map((meal, i) =>
                  (meal.additions ?? []).length > 0 ? (
                    <div key={i} className="rounded-xl bg-muted/15 px-3.5 py-2.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-primary">{meal.mealType}</span>
                        <span className="text-[13px] font-medium text-foreground truncate">{meal.mealName}</span>
                      </div>
                      <div className="space-y-1.5">
                        {(meal.additions ?? []).map((a, j) => (
                          <div key={j} className="flex items-start gap-2">
                            <div className="h-4 w-4 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <Plus className="h-2.5 w-2.5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12.5px] font-medium text-foreground leading-snug">{clean(a.item)}</p>
                              {a.benefit && (
                                <p className="text-[11.5px] text-foreground/70 leading-relaxed mt-0.5">{clean(a.benefit)}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          )}

          {/* Vitamin all-rounders — one-tap add. */}
          {(analysis.vitaminRounders?.length ?? 0) > 0 && (
            <div>
              <p className={cn(SECTION_LABEL, "mb-2")}>Vitamin all-rounders</p>
              <div className="space-y-1.5">
                {analysis.vitaminRounders!.map((v, i) => (
                  <div key={i} className="rounded-xl bg-primary/[0.06] ring-1 ring-primary/15 px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                      <p className="text-[13px] font-semibold text-foreground flex-1">{v.food}</p>
                      <AddFoodButton food={v.food} onAddFood={onAddFood} />
                    </div>
                    {v.reason && (
                      <p className="text-[12px] text-foreground/75 leading-relaxed mt-1">{clean(v.reason)}</p>
                    )}
                    {(v.vitamins ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {v.vitamins.map((n) => (
                          <span key={n} className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">{n}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* See full breakdown / Show less. */}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full h-9 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-muted-foreground/80 active:text-foreground transition-colors"
        >
          {expanded ? "Show less" : "See full breakdown"}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
      )}

      {/* No data at all — gentle fallback (rare; AI returned nothing usable). */}
      {!headline && !analysis.summary && sortedMicros.length === 0 && (
        <div className="flex items-center gap-2 text-muted-foreground/70 text-[12.5px]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Couldn't read enough to analyse — log a couple more meals and try again.
        </div>
      )}
    </motion.div>
  );
}
