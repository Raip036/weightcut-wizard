import { RotateCcw } from "lucide-react";
import type { DayPlanMeal } from "@/pages/nutrition/types";
import { cn } from "@/lib/utils";

const TAG_TONE = (label: string) =>
  /pre-?training/i.test(label) ? "bg-[#2a2410] text-[#e6c45a]"
  : /post-?training/i.test(label) ? "bg-[#1f2a1c] text-[#7fd08a]"
  : "bg-[#1a2740] text-[#7fb0ff]";

export function MealPlanCard({ meal, onLog, onSwap, busy }: {
  meal: DayPlanMeal; onLog: () => void; onSwap: () => void; busy?: boolean;
}) {
  return (
    <div className="card-surface rounded-2xl border border-border/40 p-3">
      <div>
        <span className={cn("inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide", TAG_TONE(meal.timingLabel))}>
          {meal.timingLabel}
        </span>
        <div className="mt-1.5">
          <span className="font-semibold text-[13px]">{meal.name || "Meal"}</span>
        </div>
        <div className="mt-1 flex gap-2 text-[11px]">
          <span className="font-bold text-foreground">{meal.calories} kcal</span>
          <span className="font-semibold" style={{ color: "hsl(152 64% 47%)" }}>{Math.round(meal.protein)}P</span>
          <span className="font-semibold" style={{ color: "hsl(35 92% 58%)" }}>{Math.round(meal.carbs)}C</span>
          <span className="font-semibold" style={{ color: "hsl(217 91% 58%)" }}>{Math.round(meal.fats)}F</span>
        </div>
        {meal.why && <p className="mt-1.5 border-l-2 border-primary/40 pl-2 text-[11px] italic text-muted-foreground">{meal.why}</p>}
      </div>
      <div className="mt-2 space-y-2">
        {meal.ingredients.length > 0 && (
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Ingredients</div>
            <p className="text-[11.5px] text-foreground/80">{meal.ingredients.map((g) => `${g.name} ${g.grams}g`).join(" · ")}</p>
          </div>
        )}
        {meal.prep && (
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Prep</div>
            <p className="text-[11.5px] text-foreground/80">{meal.prep}</p>
          </div>
        )}
      </div>
      <div className="mt-2.5 flex gap-2">
        <button type="button" disabled={busy} onClick={onLog}
          className="flex-1 rounded-lg bg-primary/15 py-2 text-[11.5px] font-semibold text-primary active:scale-[0.98] disabled:opacity-50">Log meal</button>
        <button type="button" disabled={busy} onClick={onSwap}
          className="rounded-lg bg-muted/30 px-3 py-2 text-[11.5px] text-foreground/80 active:scale-[0.98] disabled:opacity-50">
          <RotateCcw className="inline h-3.5 w-3.5" /> Swap</button>
      </div>
    </div>
  );
}
