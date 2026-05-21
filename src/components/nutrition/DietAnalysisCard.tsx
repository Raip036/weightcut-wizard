import { X, RefreshCw, Plus, Sparkles } from "lucide-react";
import type { DietAnalysisResult } from "@/types/dietAnalysis";

const NUTRIENT_COLORS: Record<string, string> = {
  "Vitamin A": "#f59e0b",
  "Vitamin C": "#ef4444",
  "Vitamin D": "#eab308",
  "Iron": "#dc2626",
  "Calcium": "#14b8a6",
  "Magnesium": "#10b981",
  "Zinc": "#0ea5e9",
  "Fiber": "#84cc16",
};

function NutrientRing({ name, percentRDA, color }: { name: string; percentRDA: number; color: string }) {
  const size = 56;
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(percentRDA / 100, 1);
  const offset = circumference * (1 - progress);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
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
      <span className="text-[9px] text-muted-foreground/60 text-center leading-tight">{name}</span>
    </div>
  );
}

// Defensive: the AI sometimes returns rows with missing string fields
// (summary / reason). Coerce to "" so a sparse response can't crash the
// page on `t.replace(...)` \u2014 the empty cells just render blank.
const clean = (t: string | null | undefined) =>
  typeof t === "string"
    ? t.replace(/\u2014/g, " - ").replace(/\u2013/g, "-")
    : "";

interface DietAnalysisCardProps {
  analysis: DietAnalysisResult;
  onDismiss: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}

export function DietAnalysisCard({ analysis, onDismiss, onRefresh, refreshing }: DietAnalysisCardProps) {
  return (
    <div className="card-surface p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-foreground">Diet Analysis</p>
        <div className="flex items-center gap-0.5">
          <button onClick={onRefresh} disabled={refreshing}
            className="h-8 w-8 flex items-center justify-center rounded-xs text-muted-foreground/40 active:text-foreground active:bg-muted/40 transition-colors disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button onClick={onDismiss}
            className="h-8 w-8 flex items-center justify-center rounded-xs text-muted-foreground/40 active:text-foreground active:bg-muted/40 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Summary */}
      <p className="text-[13px] text-foreground leading-relaxed">{clean(analysis.summary)}</p>

      {/* Micronutrient Rings */}
      {analysis.micronutrients?.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold text-center mb-3">Micronutrients</p>
          <div className="grid grid-cols-4 gap-2 justify-items-center">
            {analysis.micronutrients.map((nutrient) => (
              <NutrientRing key={nutrient.name} name={nutrient.name} percentRDA={nutrient.percentRDA}
                color={NUTRIENT_COLORS[nutrient.name] || "#888"} />
            ))}
          </div>
        </div>
      )}

      {/* Per-Meal Breakdown */}
      {analysis.mealBreakdown?.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Per Meal</p>
          <div className="space-y-0 rounded-xs overflow-hidden border-2 border-border">
            {analysis.mealBreakdown.map((meal, i) => (
              <div key={i} className={`px-3.5 py-2.5 ${i > 0 ? 'border-t-2 border-border' : ''}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-primary">{meal.mealType}</span>
                  <span className="text-[13px] font-medium text-foreground truncate">{meal.mealName}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(meal.keyNutrients ?? []).map((n, j) => (
                    <span key={j} className="text-[10px] text-foreground/80">
                      <span className="font-medium text-foreground">{n.name}</span> {n.amount}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gaps */}
      {analysis.gaps?.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Gaps</p>
          <div className="space-y-0 rounded-xs overflow-hidden border-2 border-border">
            {analysis.gaps.map((gap, i) => {
              const dotColor = { critical: 'bg-red-400', moderate: 'bg-amber-400', low: 'bg-yellow-400' }[gap.severity] ?? 'bg-yellow-400';
              return (
                <div key={gap.nutrient} className={`px-3.5 py-2.5 ${i > 0 ? 'border-t-2 border-border' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${dotColor} flex-shrink-0`} />
                    <span className="text-[13px] font-medium text-foreground flex-1">{gap.nutrient}</span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{gap.percentRDA}% RDA</span>
                  </div>
                  <p className="text-[12px] text-foreground/80 leading-relaxed mt-0.5 ml-4">{clean(gap.reason)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {analysis.suggestions?.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Add to Your Diet</p>
          <div className="space-y-1.5">
            {analysis.suggestions.map((s, i) => (
              <div key={i} className="rounded-xs bg-muted/20 px-3.5 py-2.5 border-2 border-border">
                <p className="text-[13px] font-semibold text-foreground">{s.food}</p>
                <p className="text-[12px] text-foreground/80 leading-relaxed mt-0.5">{clean(s.reason)}</p>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {(s.nutrients ?? []).map((n) => (
                    <span key={n} className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">{n}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-Meal Upgrades — what to add to each meal the user actually ate */}
      {analysis.mealAdditions && analysis.mealAdditions.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Upgrade Each Meal</p>
          <div className="space-y-1.5">
            {analysis.mealAdditions.map((meal, i) => (
              (meal.additions ?? []).length > 0 && (
                <div key={i} className="rounded-xs bg-muted/20 px-3.5 py-2.5 border-2 border-border">
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
                            <p className="text-[11.5px] text-foreground/75 leading-relaxed mt-0.5">{clean(a.benefit)}</p>
                          )}
                          {(a.nutrients ?? []).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {a.nutrients.map((n) => (
                                <span key={n} className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">{n}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            ))}
          </div>
        </div>
      )}

      {/* Vitamin All-Rounders — single foods that close multiple gaps at once */}
      {analysis.vitaminRounders && analysis.vitaminRounders.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Vitamin All-Rounders</p>
          <div className="space-y-1.5">
            {analysis.vitaminRounders.map((v, i) => (
              <div key={i} className="rounded-xs bg-primary/5 px-3.5 py-2.5 border-2 border-primary/20">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  <p className="text-[13px] font-semibold text-foreground">{v.food}</p>
                </div>
                {v.reason && (
                  <p className="text-[12px] text-foreground/80 leading-relaxed mt-1">{clean(v.reason)}</p>
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
    </div>
  );
}
