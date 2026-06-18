import { useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ProGate } from "@/components/subscription/ProGate";
import { useToast } from "@/hooks/use-toast";
import { DayPlanView } from "./dayplan/DayPlanView";
import type { DayPlan, DayPlanMeal, MealTargets } from "./types";
import { MEAL_PLAN_MIN, MEAL_PLAN_MAX } from "@/lib/mealPlan";

const CHIPS = ["High protein", "Low carb", "Budget", "Fight week prep"];

export interface MealPlanSheetProps {
  open: boolean;
  onClose: () => void;
  targets: MealTargets;
  dayPlan: DayPlan | null;
  aiPrompt: string;
  setAiPrompt: React.Dispatch<React.SetStateAction<string>>;
  mealCount: number;
  setMealCount: React.Dispatch<React.SetStateAction<number>>;
  generatingPlan: boolean;
  generateDayPlan: () => Promise<void>;
  swapMeal: (mealId: string) => Promise<void>;
  targetsChanged: boolean;
  onLogMeal: (meal: DayPlanMeal) => Promise<void>;
  onLogDay: (meals: DayPlanMeal[]) => Promise<void>;
}

export function MealPlanSheet(p: MealPlanSheetProps) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loggingDay, setLoggingDay] = useState(false);
  const [editing, setEditing] = useState(false);
  const showResult = !!p.dayPlan && !editing;

  return (
    <Sheet open={p.open} onOpenChange={(v) => !v && p.onClose()}>
      <SheetContent side="bottom" className="h-[88dvh] rounded-t-2xl overflow-y-auto p-4">
        <SheetTitle className="sr-only">Meal plan ideas</SheetTitle>
        {showResult ? (
          <div className="space-y-3">
            <button type="button" onClick={() => setEditing(true)}
              className="flex w-full items-center justify-between rounded-xl bg-muted/20 px-3 py-2 text-[11px] text-foreground/80">
              <span className="truncate">"{p.aiPrompt}" · {p.mealCount} meals</span>
              <span className="text-primary">Edit ✎</span>
            </button>
            {p.targetsChanged && <p className="text-[11px] text-[#e6c45a]">Targets changed — regenerate to refresh.</p>}
            <DayPlanView plan={p.dayPlan!} busyId={busyId} loggingDay={loggingDay}
              onLogMeal={async (m) => { setBusyId(m.id); try { await p.onLogMeal(m); } finally { setBusyId(null); } }}
              onSwapMeal={async (m) => { setBusyId(m.id); try { await p.swapMeal(m.id); } catch { toast({ title: "Couldn't swap that meal", variant: "destructive" }); } finally { setBusyId(null); } }}
              onLogDay={async () => { setLoggingDay(true); try { await p.onLogDay(p.dayPlan!.meals); } finally { setLoggingDay(false); } }}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <h2 className="text-[16px] font-bold">Meal plan ideas</h2>
              <p className="text-[11px] text-muted-foreground">
                A full day to hit {p.targets.kcal} kcal · {p.targets.protein}P / {p.targets.carbs}C / {p.targets.fats}F
              </p>
            </div>
            <Textarea value={p.aiPrompt} onChange={(e) => p.setAiPrompt(e.target.value)}
              placeholder="high protein, no dairy, I train BJJ at 5pm…" rows={2}
              className="resize-none rounded-xl border-border/30 bg-muted/20 text-[13px]" />
            <div className="flex flex-wrap gap-2">
              {CHIPS.map((c) => (
                <button key={c} type="button" onClick={() => p.setAiPrompt((prev) => (prev ? prev.trimEnd() + " " + c : c))}
                  className="rounded-full bg-muted/40 px-2.5 py-1 text-[12px] text-muted-foreground active:bg-muted/60">{c}</button>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-foreground/80">Meals in the day</span>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => p.setMealCount((n) => Math.max(MEAL_PLAN_MIN, n - 1))}
                  className="h-7 w-7 rounded-lg bg-muted/40 text-lg font-bold">−</button>
                <b className="w-4 text-center">{p.mealCount}</b>
                <button type="button" onClick={() => p.setMealCount((n) => Math.min(MEAL_PLAN_MAX, n + 1))}
                  className="h-7 w-7 rounded-lg bg-muted/40 text-lg font-bold">＋</button>
              </div>
            </div>
            <ProGate feature="AI_MEAL_PLANNER" className="w-full">
              <button type="button" disabled={p.generatingPlan}
                onClick={async () => { await p.generateDayPlan(); setEditing(false); }}
                className="w-full rounded-2xl bg-primary py-3 text-[13px] font-semibold text-primary-foreground active:scale-[0.99] disabled:opacity-50">
                {p.generatingPlan ? "Generating…" : "Generate my day ✦"}
              </button>
            </ProGate>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
