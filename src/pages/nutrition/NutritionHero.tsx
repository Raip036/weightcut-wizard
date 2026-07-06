import { format, startOfWeek, subWeeks, addDays, isSameDay, isAfter } from "date-fns";
import { useLayoutEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Flame, Sun, Moon } from "lucide-react";
import { ImpactStyle } from "@capacitor/haptics";
import { MacroPieChart } from "@/components/nutrition/MacroPieChart";
import { SyncingIndicator } from "@/components/SyncingIndicator";
import { triggerHapticSelection, triggerHaptic } from "@/lib/haptics";
import { track, EVENTS } from "@/lib/analytics";
import type { CarbCycleTarget } from "@/hooks/nutrition/useNutritionData";
import type { TrainingDay } from "@/lib/dayType";
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
  /**
   * Resolved carb-cycle target, owned by NutritionPage so the ring and the
   * meal-plan generator stay in sync. `active: false` for non-cut users.
   */
  carbCycle: CarbCycleTarget;
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
  carbCycle,
}: NutritionHeroProps) {
  // Cut-plan users follow a Hard/Medium/Rest carb cycle: calories stay
  // constant while carbs/protein swing with the day's training. When active,
  // the macro tiles + ring read the resolved cycle target for the viewed day
  // (auto from that day's session, or a manual override). Maintenance / no-plan
  // users get `active: false` and the flat target is kept unchanged. The cycle
  // is resolved once at NutritionPage level and passed in as a prop.
  const goals = carbCycle.active && carbCycle.macroGoals ? carbCycle.macroGoals : effectiveMacroGoals;
  const calorieTarget = carbCycle.active && carbCycle.macroGoals
    ? carbCycle.macroGoals.recommendedCalories
    : dailyCalorieTarget;

  return (
    <>
      {/* Horizontal date strip — 7-day scrollable picker */}
      <DateStrip selectedDate={selectedDate} setSelectedDate={setSelectedDate} />

      {/* Calorie ring + 3 macro tiles. `pt-2` adds a little breathing room
          between the weekly date strip and the Calories title. */}
      <div className="relative pt-2">
        <MacroPieChart
          calories={totalCalories}
          calorieTarget={calorieTarget}
          protein={totalProtein}
          carbs={totalCarbs}
          fats={totalFats}
          proteinGoal={goals.proteinGrams}
          carbsGoal={goals.carbsGrams}
          fatsGoal={goals.fatsGrams}
          onEditTargets={onEditTargets}
        />
        <SyncingIndicator active={mealsLoading && mealsVisibleCount > 0} />
      </div>

      {/* Carb-cycle reason line + Hard/Med/Rest override — cut plans only. */}
      {carbCycle.active && <CarbCycleControl carbCycle={carbCycle} />}
    </>
  );
}

// ── Carb-cycle reason + override ───────────────────────────────────────
// A slim reason line ("Hard day, plus Xg carbs" · "Rest day, protein led" ·
// "Medium day") plus a Hard / Medium / Rest segmented control that reuses the
// DailyFuelCard toggle idiom. The override applies only to the viewed day.
const DAY_TABS: { key: TrainingDay; label: string; Icon: typeof Flame }[] = [
  { key: "hard", label: "Hard", Icon: Flame },
  { key: "medium", label: "Medium", Icon: Sun },
  { key: "rest", label: "Rest", Icon: Moon },
];

function CarbCycleControl({
  carbCycle,
}: {
  carbCycle: CarbCycleTarget;
}) {
  const { dayType, reason, setOverride } = carbCycle;

  return (
    <div className="mt-1 px-1">
      {reason && (
        <p className="text-center text-[12px] font-medium text-muted-foreground">
          {reason}
        </p>
      )}

      <div className="relative mt-2.5 flex rounded-full bg-muted/25 p-0.5">
        {DAY_TABS.map((t) => {
          const activeTab = t.key === dayType;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                if (t.key !== dayType) {
                  setOverride(t.key);
                  triggerHaptic(ImpactStyle.Light);
                  track(EVENTS.FEATURE_OPENED, {
                    feature: "carb_cycle_override",
                    day_type: t.key,
                  });
                }
              }}
              className={`relative z-10 flex-1 flex items-center justify-center gap-1 rounded-full py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                activeTab ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {activeTab && (
                <motion.span
                  layoutId="carbcycle-active-tab"
                  className="absolute inset-0 -z-10 rounded-full bg-foreground/10 border border-border/50"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <t.Icon
                className={`h-3.5 w-3.5 ${activeTab ? "text-primary" : ""}`}
                strokeWidth={2.4}
              />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
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

  // Jump the strip to the current (last) week on mount. This MUST be an
  // instant jump, never a smooth scroll: the container is not `scroll-smooth`
  // (see className) precisely so this CSSOM write doesn't animate horizontally
  // while the page-entry fade is still running — a competing scroll there reads
  // as jank. User swipes still get native momentum + snap.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex overflow-x-auto snap-x snap-mandatory [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {weeks.map((week, wi) => (
        <div key={wi} className="w-full shrink-0 snap-center grid grid-cols-7">
          {week.map((d) => {
            const ds = format(d, "yyyy-MM-dd");
            const active = ds === selectedDate;
            const isFuture = isAfter(d, todayStart) && !isSameDay(d, todayStart);
            return (
              <button
                key={ds}
                type="button"
                data-date={ds}
                disabled={isFuture}
                onClick={() => { triggerHapticSelection(); setSelectedDate(ds); }}
                className={`relative flex flex-col items-center justify-center min-h-[44px] py-1.5 transition-transform duration-100 active:scale-[0.94] [-webkit-tap-highlight-color:transparent] ${
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
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

