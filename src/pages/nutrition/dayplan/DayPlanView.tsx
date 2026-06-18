import type { DayPlan, DayPlanMeal } from "@/pages/nutrition/types";
import { MealPlanCard } from "./MealPlanCard";

export function DayPlanView({ plan, onLogMeal, onSwapMeal, onLogDay, busyId, loggingDay }: {
  plan: DayPlan;
  onLogMeal: (m: DayPlanMeal) => void; onSwapMeal: (m: DayPlanMeal) => void; onLogDay: () => void;
  busyId?: string | null; loggingDay?: boolean;
}) {
  const t = plan.targets, s = plan.totals;
  return (
    <div className="space-y-2">
      <div className="rounded-2xl border border-[#1e2a3d] bg-[#101826] p-3">
        <div className="flex items-center justify-between">
          <div><span className="font-bold text-foreground">{s.kcal.toLocaleString()}</span>
            <span className="text-[11px] text-muted-foreground"> / {t.kcal.toLocaleString()} kcal</span></div>
          <span className={`text-[10px] font-semibold ${plan.onTarget ? "text-[#5fd08a]" : "text-[#e6c45a]"}`}>
            {plan.onTarget ? "✓ on target" : "≈ close"}</span>
        </div>
        <div className="mt-2 flex gap-3 text-[10.5px] text-muted-foreground">
          <span>{Math.round(s.protein)} / {t.protein}P</span>
          <span>{Math.round(s.carbs)} / {t.carbs}C</span>
          <span>{Math.round(s.fats)} / {t.fats}F</span>
        </div>
      </div>
      {plan.meals.map((m) => (
        <MealPlanCard key={m.id} meal={m} onLog={() => onLogMeal(m)} onSwap={() => onSwapMeal(m)} busy={busyId === m.id} />
      ))}
      <button type="button" onClick={onLogDay} disabled={loggingDay}
        className="w-full rounded-2xl bg-primary py-3 text-[13px] font-semibold text-primary-foreground active:scale-[0.99] disabled:opacity-50">
        {loggingDay ? "Logging…" : "Log whole day"}</button>
    </div>
  );
}
