import { Plus } from "lucide-react";
import { clean } from "@/lib/dietAnalysis";
import type { MealAddition, MealNutrientBreakdown } from "@/types/dietAnalysis";

const SECTION_LABEL =
  "text-[10px] uppercase tracking-widest text-muted-foreground font-semibold";

export function MealUpgrades({
  breakdown,
  additions,
}: {
  breakdown: MealNutrientBreakdown[];
  additions: MealAddition[];
}) {
  return (
    <div className="space-y-4">
      {breakdown.length > 0 && (
        <div>
          <p className={`${SECTION_LABEL} mb-2`}>Per meal</p>
          <div className="space-y-1">
            {breakdown.map((meal, i) => (
              <div key={i} className="px-3 py-2 rounded-xl bg-muted/15">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-primary">
                    {meal.mealType}
                  </span>
                  <span className="text-[13px] font-medium text-foreground truncate">
                    {meal.mealName}
                  </span>
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

      {additions.length > 0 && (
        <div>
          <p className={`${SECTION_LABEL} mb-2`}>Upgrade each meal</p>
          <div className="space-y-1.5">
            {additions.map((meal, i) =>
              (meal.additions ?? []).length > 0 ? (
                <div key={i} className="rounded-xl bg-muted/15 px-3.5 py-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-primary">
                      {meal.mealType}
                    </span>
                    <span className="text-[13px] font-medium text-foreground truncate">
                      {meal.mealName}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {(meal.additions ?? []).map((a, j) => (
                      <div key={j} className="flex items-start gap-2">
                        <div className="h-4 w-4 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Plus className="h-2.5 w-2.5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12.5px] font-medium text-foreground leading-snug">
                            {clean(a.item)}
                          </p>
                          {a.benefit && (
                            <p className="text-[11.5px] text-foreground/70 leading-relaxed mt-0.5">
                              {clean(a.benefit)}
                            </p>
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
    </div>
  );
}
