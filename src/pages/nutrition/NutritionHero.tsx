import { format, startOfWeek, subWeeks, addDays, isSameDay, isAfter } from "date-fns";
import { Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import wizardEating from "@/assets/wizard_food.png";
import { MacroPieChart } from "@/components/nutrition/MacroPieChart";
import { SyncingIndicator } from "@/components/SyncingIndicator";
import { triggerHapticSelection } from "@/lib/haptics";
import type { MacroGoals } from "@/pages/nutrition/types";

interface WisdomState {
  aiWisdomAdvice: string | null;
  aiWisdomLoading: boolean;
  trainingWisdomLoading: boolean;
  getNutritionWisdom: () => string;
  generateTrainingFoodIdeas: (force?: boolean) => void;
}

interface NutritionHeroProps {
  wisdom: WisdomState;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFats: number;
  dailyCalorieTarget: number;
  effectiveMacroGoals: MacroGoals;
  onEditTargets: () => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  mealsLoading: boolean;
  mealsVisibleCount: number;
}

/**
 * Hero layout (top → bottom):
 *   1. Horizontal scrollable date strip (7 days, Apple Fitness style)
 *   2. MacroPieChart (calorie ring + 3 macro tiles)
 *   3. Slim wizard wisdom chip (tap → full advice sheet)
 *
 * Route component owns all state; this file is pure presentation.
 */
export function NutritionHero({
  wisdom,
  totalCalories,
  totalProtein,
  totalCarbs,
  totalFats,
  dailyCalorieTarget,
  effectiveMacroGoals,
  onEditTargets,
  selectedDate,
  setSelectedDate,
  mealsLoading,
  mealsVisibleCount,
}: NutritionHeroProps) {
  return (
    <>
      {/* Horizontal date strip — 7-day scrollable picker */}
      <DateStrip selectedDate={selectedDate} setSelectedDate={setSelectedDate} />

      {/* Calorie ring + 3 macro tiles. `pt-2` adds a little breathing room
          between the weekly date strip and the Calories title. */}
      <div className="relative pt-2">
        <MacroPieChart
          calories={totalCalories}
          calorieTarget={dailyCalorieTarget}
          protein={totalProtein}
          carbs={totalCarbs}
          fats={totalFats}
          proteinGoal={effectiveMacroGoals.proteinGrams}
          carbsGoal={effectiveMacroGoals.carbsGrams}
          fatsGoal={effectiveMacroGoals.fatsGrams}
          onEditTargets={onEditTargets}
        />
        <SyncingIndicator active={mealsLoading && mealsVisibleCount > 0} />
      </div>

      {/* Slim wisdom chip — replaces the big banner. `pt-2` adds a little
          breathing room between the macro rings and the Today's tip card. */}
      <div className="pt-2">
        <WisdomChip wisdom={wisdom} />
      </div>
    </>
  );
}

// ── Date strip ─────────────────────────────────────────────────────────
// Minimal Apple Calendar–style week pager. A horizontally scroll-snapping
// container of full-width week "pages" (Mon-start). The current week is the
// last page and is shown on mount; swiping moves one week at a time. No
// borders, boxes, or chevrons — just clean text with a primary dot under the
// selected day. Future days are dimmed and non-interactive.
function DateStrip({
  selectedDate,
  setSelectedDate,
}: {
  selectedDate: string;
  setSelectedDate: (date: string) => void;
}) {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const containerRef = useRef<HTMLDivElement>(null);

  // 12 trailing weeks including the current one, oldest → newest.
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const weekStart = startOfWeek(subWeeks(today, 11 - i), { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, k) => addDays(weekStart, k));
  });

  // Show the current (last) week on mount, no smooth scroll for the initial position.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {weeks.map((week, wi) => (
        <div key={wi} className="w-full shrink-0 snap-center grid grid-cols-7">
          {week.map((d) => {
            const ds = format(d, "yyyy-MM-dd");
            const active = ds === selectedDate;
            const isFuture = isAfter(d, todayStart) && !isSameDay(d, todayStart);
            return (
              <motion.button
                key={ds}
                type="button"
                data-date={ds}
                disabled={isFuture}
                onClick={() => { triggerHapticSelection(); setSelectedDate(ds); }}
                whileTap={{ scale: 0.94 }}
                className={`relative flex flex-col items-center justify-center min-h-[44px] py-1.5 [-webkit-tap-highlight-color:transparent] ${
                  isFuture ? "opacity-30 pointer-events-none" : ""
                }`}
                aria-label={format(d, "EEEE, MMMM d")}
                aria-current={active ? "date" : undefined}
              >
                <span
                  className={`text-[11px] font-semibold leading-none ${
                    active ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {format(d, "EEE")}
                </span>
                <span
                  className={`mt-1.5 text-[17px] font-bold tabular-nums leading-none ${
                    active ? "text-primary" : "text-foreground"
                  }`}
                >
                  {format(d, "d")}
                </span>
              </motion.button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Wisdom card ────────────────────────────────────────────────────────
// Plain nutrition card carrying the full tip (no truncation) on the left,
// with the gently bobbing eating-wizard inside on the right. Tap fires the
// same wisdom action as before (opens TrainingWisdomSheet via parent route).
function WisdomChip({ wisdom }: { wisdom: WisdomState }) {
  const text = wisdom.aiWisdomLoading
    ? "Updating advice…"
    : wisdom.aiWisdomAdvice || wisdom.getNutritionWisdom();

  return (
    <button
      onClick={() => wisdom.generateTrainingFoodIdeas()}
      data-tutorial="nutrition-wisdom-chip"
      className="card-surface rounded-xs w-full px-4 py-3 text-left active:scale-[0.99] transition"
    >
      <div className="flex items-center gap-3">
        {/* Bobbing eating-wizard inside the card, left side. */}
        <motion.img
          src={wizardEating}
          alt="Wizard"
          className="pointer-events-none h-16 w-16 object-contain shrink-0 select-none"
          draggable={false}
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Tip text on the right */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80 leading-none">
              Today's tip
            </p>
            {wisdom.trainingWisdomLoading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary/70 shrink-0" />
            )}
          </div>
          {/* Full tip — wraps to as many lines as needed, no truncation. */}
          <p className="mt-1.5 text-[12.5px] text-muted-foreground leading-snug">
            {text}
          </p>
        </div>
      </div>
    </button>
  );
}
