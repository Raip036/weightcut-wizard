import { useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ProGate } from "@/components/subscription/ProGate";
import { useToast } from "@/hooks/use-toast";
import { DayPlanView } from "./dayplan/DayPlanView";
import { ProtocolGeneratingOverlay } from "@/components/protocol/ProtocolGeneratingOverlay";
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

/** One target macro/calorie as a compact stat chip in the sheet header. */
function MacroChip({ v, label, tone }: { v: string; label: string; tone?: string }) {
  return (
    <div className="flex-1 rounded-xl bg-muted/25 border border-border/40 px-2 py-2 text-center">
      <p className="text-[15px] font-bold tabular-nums leading-none" style={tone ? { color: tone } : undefined}>
        {v}
      </p>
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground/70 mt-1">{label}</p>
    </div>
  );
}

export function MealPlanSheet(p: MealPlanSheetProps) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loggingDay, setLoggingDay] = useState(false);
  const [editing, setEditing] = useState(false);
  const showResult = !!p.dayPlan && !editing;

  return (
    <Sheet open={p.open} onOpenChange={(v) => !v && p.onClose()}>
      {/* Flex column + keyboard-aware height. Height shrinks by the keyboard
          inset (set on iOS by the JS listener in main.tsx) and the Sheet's
          base style already raises `bottom` above the keyboard — so the sheet
          stays fully on-screen and the sticky footer never hides. */}
      <SheetContent
        side="bottom"
        className="rounded-t-3xl p-0 flex flex-col overflow-hidden"
        style={{ height: "calc(88dvh - var(--keyboard-inset, 0px))" }}
      >
        <SheetTitle className="sr-only">Meal plan ideas</SheetTitle>

        {/* drag handle */}
        <div className="flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="h-[5px] w-9 rounded-full bg-white/25" />
        </div>

        {p.generatingPlan ? (
          <div className="flex-1 min-h-0 flex items-center justify-center px-5 pb-8">
            <ProtocolGeneratingOverlay
              className="w-full"
              label="Conjuring your meal plan"
              steps={["Reading your targets and training", "Balancing protein, carbs and fats", "Plating each meal", "Checking the day hits your numbers"]}
              footnote="This usually takes a few seconds."
            />
          </div>
        ) : showResult ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-3">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex w-full items-center justify-between rounded-xl bg-muted/20 px-3 py-2 text-[11px] text-foreground/80"
            >
              <span className="truncate">"{p.aiPrompt}" · {p.mealCount} meals</span>
              <span className="text-primary">Edit ✎</span>
            </button>
            {p.targetsChanged && (
              <p className="text-[11px] text-[#e6c45a]">Targets changed - regenerate to refresh.</p>
            )}
            <DayPlanView
              plan={p.dayPlan!}
              busyId={busyId}
              loggingDay={loggingDay}
              onLogMeal={async (m) => { setBusyId(m.id); try { await p.onLogMeal(m); } finally { setBusyId(null); } }}
              onSwapMeal={async (m) => { setBusyId(m.id); try { await p.swapMeal(m.id); } catch { toast({ title: "Couldn't swap that meal", variant: "destructive" }); } finally { setBusyId(null); } }}
              onLogDay={async () => { setLoggingDay(true); try { await p.onLogDay(p.dayPlan!.meals); } finally { setLoggingDay(false); } }}
            />
          </div>
        ) : (
          <>
            {/* fixed header — title + target macros */}
            <div className="shrink-0 px-5 pt-1 pb-3 border-b border-white/5">
              <h2 className="text-[20px] font-bold tracking-tight">Meal plan ideas</h2>
              <p className="text-[12px] text-muted-foreground mt-0.5">A full day tuned to your targets</p>
              <div className="mt-3 flex gap-2">
                <MacroChip v={`${p.targets.kcal}`} label="kcal" />
                <MacroChip v={`${p.targets.protein}g`} label="protein" tone="hsl(152 64% 47%)" />
                <MacroChip v={`${p.targets.carbs}g`} label="carbs" tone="hsl(35 92% 58%)" />
                <MacroChip v={`${p.targets.fats}g`} label="fats" tone="hsl(217 91% 58%)" />
              </div>
            </div>

            {/* scrollable body */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
              <div>
                <label className="text-[12px] font-semibold text-foreground/80">What are you after?</label>
                <Textarea
                  value={p.aiPrompt}
                  onChange={(e) => p.setAiPrompt(e.target.value)}
                  placeholder="high protein, no dairy, I train BJJ at 5pm…"
                  rows={3}
                  className="mt-1.5 resize-none rounded-xl border-border/40 bg-muted/20 text-[14px]"
                />
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {CHIPS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => p.setAiPrompt((prev) => (prev ? prev.trimEnd() + " " + c : c))}
                      className="rounded-full bg-muted/40 px-3 py-1.5 text-[12px] text-muted-foreground active:bg-muted/60"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-muted/15 px-3.5 py-3">
                <span className="text-[13px] font-medium text-foreground/90">Meals in the day</span>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => p.setMealCount((n) => Math.max(MEAL_PLAN_MIN, n - 1))}
                    className="h-9 w-9 rounded-xl bg-muted/40 text-lg font-bold active:scale-95"
                  >
                    −
                  </button>
                  <b className="w-5 text-center text-[18px] tabular-nums">{p.mealCount}</b>
                  <button
                    type="button"
                    onClick={() => p.setMealCount((n) => Math.min(MEAL_PLAN_MAX, n + 1))}
                    className="h-9 w-9 rounded-xl bg-muted/40 text-lg font-bold active:scale-95"
                  >
                    ＋
                  </button>
                </div>
              </div>
            </div>

            {/* sticky footer — Generate always reachable above the keyboard */}
            <div className="shrink-0 px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] border-t border-white/5 bg-card">
              <ProGate feature="AI_MEAL_PLANNER" className="w-full">
                <button
                  type="button"
                  disabled={p.generatingPlan}
                  onClick={async () => { await p.generateDayPlan(); setEditing(false); }}
                  className="w-full rounded-2xl bg-primary py-3.5 text-[14px] font-bold text-primary-foreground active:scale-[0.99] disabled:opacity-50"
                >
                  {p.generatingPlan ? "Generating…" : "Generate my day"}
                </button>
              </ProGate>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
