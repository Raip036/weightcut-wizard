import { Plus, X, ChevronDown, Loader2, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import ErrorBoundary from "@/components/ErrorBoundary";
import type { Ingredient, Meal } from "@/pages/nutrition/types";

interface MealIdeasSectionProps {
  mealPlanIdeas: Meal[];
  setIsAiDialogOpen: (open: boolean) => void;
  generatingPlan: boolean;
  savingAllMeals: boolean;
  loggingMealId: string | null;
  expandedMealIdeas: Set<string>;
  setExpandedMealIdeas: React.Dispatch<React.SetStateAction<Set<string>>>;
  onSaveAll: (meals: Meal[]) => void;
  onClear: () => void;
  onLogIdea: (meal: Meal, mealTypeOverride?: string) => void;
}

const MEAL_TYPE_BUTTONS = [
  { type: "breakfast", label: "Bkfst" },
  { type: "lunch", label: "Lunch" },
  { type: "dinner", label: "Dinner" },
  { type: "snack", label: "Snack" },
];

export function MealIdeasSection({
  mealPlanIdeas,
  setIsAiDialogOpen,
  generatingPlan,
  savingAllMeals,
  loggingMealId,
  expandedMealIdeas,
  setExpandedMealIdeas,
  onSaveAll,
  onClear,
  onLogIdea,
}: MealIdeasSectionProps) {
  return (
    <div className="space-y-2" data-tutorial="generate-meal-plan">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Meal Plan Ideas</h2>
        <Button onClick={() => setIsAiDialogOpen(true)} size="sm" variant="ghost" className="h-8 text-xs gap-1.5 rounded-xs text-primary font-medium">
          Generate
        </Button>
      </div>
      {mealPlanIdeas.length === 0 ? (
        <div className="card-surface border-dashed py-7 text-center">
          {generatingPlan ? (
            <>
              <Loader2 className="h-5 w-5 text-primary mx-auto mb-1.5 animate-spin" />
              <p className="text-[13px] font-medium text-foreground">Generating meal ideas...</p>
              <div className="flex justify-center gap-1 mt-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </>
          ) : (
            <>
              <Utensils className="h-5 w-5 text-primary/50 mx-auto mb-1.5" />
              <p className="text-[13px] font-medium text-foreground">No meal ideas yet</p>
              <p className="text-[13px] text-foreground/60 mt-0.5">Generate AI meal suggestions above</p>
            </>
          )}
        </div>
      ) : (
        <ErrorBoundary>
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button onClick={() => onSaveAll(mealPlanIdeas)} disabled={savingAllMeals || loggingMealId !== null}
                size="sm" className="flex-1 h-8 text-xs rounded-xs">
                <Plus className="mr-1 h-3 w-3" />Save All ({mealPlanIdeas.length})
              </Button>
              <Button onClick={onClear} variant="outline" size="sm" className="h-8 text-xs rounded-xs">
                <X className="mr-1 h-3 w-3" />Clear
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {mealPlanIdeas.map((meal) => {
                const p = meal.protein_g || 0, c = meal.carbs_g || 0, f = meal.fats_g || 0;
                const pCal = p * 4, cCal = c * 4, fCal = f * 9;
                const macroTotal = pCal + cCal + fCal;
                const R = 22, CIRC = 2 * Math.PI * R;
                const pArc = macroTotal > 0 ? (pCal / macroTotal) * CIRC : 0;
                const cArc = macroTotal > 0 ? (cCal / macroTotal) * CIRC : 0;
                const fArc = macroTotal > 0 ? (fCal / macroTotal) * CIRC : 0;
                const isExpanded = expandedMealIdeas.has(meal.id);
                const hasDetails = (meal.ingredients && Array.isArray(meal.ingredients) && meal.ingredients.length > 0) || meal.recipe_notes;

                return (
                  <div key={meal.id} className="card-surface overflow-hidden transition-all duration-0">
                    <div
                      className={`p-3 ${hasDetails ? "cursor-pointer active:bg-white/[0.02] transition-colors" : ""}`}
                      onClick={() => {
                        if (!hasDetails) return;
                        setExpandedMealIdeas((prev) => {
                          const next = new Set(prev);
                          if (next.has(meal.id)) next.delete(meal.id);
                          else next.add(meal.id);
                          return next;
                        });
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="relative flex-shrink-0" style={{ width: 44, height: 44 }}>
                          <svg viewBox="0 0 56 56" className="w-full h-full -rotate-90">
                            <circle cx="28" cy="28" r={R} fill="none" stroke="hsl(var(--border) / 0.15)" strokeWidth="4" />
                            {macroTotal > 0 && (<>
                              <circle cx="28" cy="28" r={R} fill="none" stroke="#3b82f6" strokeWidth="4" strokeDasharray={`${pArc} ${CIRC - pArc}`} strokeDashoffset={0} strokeLinecap="butt" />
                              <circle cx="28" cy="28" r={R} fill="none" stroke="#f97316" strokeWidth="4" strokeDasharray={`${cArc} ${CIRC - cArc}`} strokeDashoffset={-pArc} strokeLinecap="butt" />
                              <circle cx="28" cy="28" r={R} fill="none" stroke="#a855f7" strokeWidth="4" strokeDasharray={`${fArc} ${CIRC - fArc}`} strokeDashoffset={-(pArc + cArc)} strokeLinecap="butt" />
                            </>)}
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center"><span className="text-[13px] font-bold tabular-nums">{meal.calories}</span></div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm leading-tight text-foreground">{meal.meal_name}</h4>
                          {meal.portion_size && <p className="text-[13px] text-foreground/80 mt-0.5">{meal.portion_size}</p>}
                          <div className="flex items-center gap-3 mt-2">
                            <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-blue-500" /><span className="text-[13px] tabular-nums font-medium">{Math.round(p)}g P</span></div>
                            <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-orange-500" /><span className="text-[13px] tabular-nums font-medium">{Math.round(c)}g C</span></div>
                            <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-purple-500" /><span className="text-[13px] tabular-nums font-medium">{Math.round(f)}g F</span></div>
                          </div>
                        </div>
                        {hasDetails && <ChevronDown className={`h-4 w-4 text-muted-foreground/50 flex-shrink-0 mt-1 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />}
                      </div>
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-border/20 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                          {meal.ingredients && Array.isArray(meal.ingredients) && meal.ingredients.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50 mb-1.5">Ingredients</p>
                              <div className="space-y-0.5">
                                {meal.ingredients.map((ing: Ingredient, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between text-[13px] py-0.5">
                                    <span className="text-foreground/80">{ing.name}</span>
                                    <span className="text-foreground/60 tabular-nums ml-2 flex-shrink-0">{ing.grams}g</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {meal.recipe_notes && (
                            <div className="mt-3">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50 mb-1">Method</p>
                              <p className="text-[13px] text-foreground/80 leading-relaxed">{meal.recipe_notes}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="border-t border-white/10 grid grid-cols-4 bg-black/10">
                      {MEAL_TYPE_BUTTONS.map((btn) => (
                        <button
                          key={btn.type}
                          onClick={() => onLogIdea(meal, btn.type)}
                          disabled={loggingMealId === meal.id || savingAllMeals}
                          className="flex flex-col items-center gap-0.5 py-2 text-[13px] font-medium text-foreground/80 hover:text-primary hover:bg-primary/5 active:bg-primary/10 active:scale-[0.97] transition-all disabled:opacity-40 border-r border-white/5 last:border-r-0"
                        >
                          <Plus className="h-3.5 w-3.5 text-primary" /><span>{btn.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </ErrorBoundary>
      )}
    </div>
  );
}
