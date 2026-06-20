import { format, startOfWeek, subWeeks, addDays, isSameDay, isAfter } from "date-fns";
import { motion } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import { MacroPieChart } from "@/components/nutrition/MacroPieChart";
import { SyncingIndicator } from "@/components/SyncingIndicator";
import { triggerHapticSelection } from "@/lib/haptics";
import type { MacroGoals } from "@/pages/nutrition/types";

interface NutritionHeroProps {
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
 *
 * Route component owns all state; this file is pure presentation.
 */
export function NutritionHero({
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

