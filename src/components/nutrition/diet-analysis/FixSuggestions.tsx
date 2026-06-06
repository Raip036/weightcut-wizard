import { Sparkles } from "lucide-react";
import { clean } from "@/lib/dietAnalysis";
import { AddFoodButton } from "./AddFoodButton";
import type { FoodSuggestion, VitaminRounder } from "@/types/dietAnalysis";

const SECTION_LABEL =
  "text-[10px] uppercase tracking-widest text-muted-foreground font-semibold";

export function FixSuggestions({
  suggestions,
  rounders,
  onAddFood,
}: {
  suggestions: FoodSuggestion[];
  rounders: VitaminRounder[];
  onAddFood?: (food: string) => void;
}) {
  if (suggestions.length === 0 && rounders.length === 0) return null;
  return (
    <div className="space-y-4">
      {suggestions.length > 0 && (
        <div>
          <p className={`${SECTION_LABEL} mb-2`}>Add to close them</p>
          <div className="space-y-1.5">
            {suggestions.map((s, i) => (
              <div
                key={`${s.food}-${i}`}
                className="rounded-xl bg-primary/[0.06] ring-1 ring-primary/15 px-3.5 py-2.5"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground">{s.food}</p>
                    <p className="text-[12px] text-foreground/75 leading-relaxed mt-0.5">
                      {clean(s.reason)}
                    </p>
                  </div>
                  <AddFoodButton food={s.food} onAddFood={onAddFood} />
                </div>
                {(s.nutrients ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {s.nutrients.map((n) => (
                      <span
                        key={n}
                        className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium"
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {rounders.length > 0 && (
        <div>
          <p className={`${SECTION_LABEL} mb-2`}>Vitamin all-rounders</p>
          <div className="space-y-1.5">
            {rounders.map((v, i) => (
              <div
                key={`${v.food}-${i}`}
                className="rounded-xl bg-primary/[0.06] ring-1 ring-primary/15 px-3.5 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  <p className="text-[13px] font-semibold text-foreground flex-1">{v.food}</p>
                  <AddFoodButton food={v.food} onAddFood={onAddFood} />
                </div>
                {v.reason && (
                  <p className="text-[12px] text-foreground/75 leading-relaxed mt-1">
                    {clean(v.reason)}
                  </p>
                )}
                {(v.vitamins ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {v.vitamins.map((n) => (
                      <span
                        key={n}
                        className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium"
                      >
                        {n}
                      </span>
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
