import { useEffect, useRef } from "react";
import { format, subDays, isToday, isYesterday } from "date-fns";
import { Loader2, ChevronRight, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import wizardLogo from "@/assets/wizard-logo.webp";
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

      {/* Calorie ring + 3 macro tiles */}
      <div className="relative">
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

      {/* Slim wisdom chip — replaces the big banner */}
      <WisdomChip wisdom={wisdom} />
    </>
  );
}

// ── Date strip ─────────────────────────────────────────────────────────
// Apple Fitness-style horizontal picker. Renders 14 trailing days (today
// at the right, scrolls left for history). Selected day pops with primary
// background + bold weekday. Tap = navigate to that date. Auto-scrolls
// the selected day into view on mount and on jump-to-today.
function DateStrip({
  selectedDate,
  setSelectedDate,
}: {
  selectedDate: string;
  setSelectedDate: (date: string) => void;
}) {
  const today = new Date();
  // 14 days: 13 days ago through today. Render newest at the right end
  // so the "Today" cell sits at the end naturally.
  const days = Array.from({ length: 14 }, (_, i) =>
    subDays(today, 13 - i),
  );
  const todayStr = format(today, "yyyy-MM-dd");
  const isOnToday = selectedDate === todayStr;

  // Auto-scroll the active day into view. Animates whenever selectedDate
  // changes — including the "Today →" pill tap, which now visually
  // slides the strip rather than just changing the highlight.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>(
      `[data-date="${selectedDate}"]`,
    );
    if (!active) return;
    // Compute offset so the active cell lands roughly centered within
    // the scroll viewport (instead of jumping to either edge).
    const targetLeft =
      active.offsetLeft - container.clientWidth / 2 + active.clientWidth / 2;
    container.scrollTo({ left: targetLeft, behavior: "smooth" });
  }, [selectedDate]);

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className={
          "flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scroll-smooth " +
          "[-webkit-overflow-scrolling:touch] [touch-action:pan-x] " +
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        }
      >
        {days.map((d) => {
          const ds = format(d, "yyyy-MM-dd");
          const active = ds === selectedDate;
          const isTodayCell = isToday(d);
          const isYest = isYesterday(d);
          return (
            <motion.button
              key={ds}
              data-date={ds}
              onClick={() => { triggerHapticSelection(); setSelectedDate(ds); }}
              whileTap={{ scale: 0.94 }}
              className={`relative flex-shrink-0 flex flex-col items-center justify-center w-[52px] h-[64px] rounded-xs border transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card/40 text-foreground/85 border-border/40 hover:bg-muted/40"
              }`}
              aria-label={format(d, "EEEE, MMMM d")}
              aria-current={active ? "date" : undefined}
            >
              <span
                className={`text-[10px] font-bold uppercase tracking-wider leading-none ${
                  active ? "text-primary-foreground/85" : "text-muted-foreground/70"
                }`}
              >
                {isTodayCell ? "TODAY" : isYest ? "YEST" : format(d, "EEE")}
              </span>
              <span
                className={`mt-1.5 text-[18px] font-bold tabular-nums leading-none ${
                  active ? "text-primary-foreground" : "text-foreground"
                }`}
              >
                {format(d, "d")}
              </span>
              {/* Today indicator dot when not selected */}
              {isTodayCell && !active && (
                <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-primary" aria-hidden />
              )}
            </motion.button>
          );
        })}
      </div>
      {/* Jump-to-today affordance — tiny chip top-right when off-today */}
      {!isOnToday && (
        <button
          onClick={() => { triggerHapticSelection(); setSelectedDate(todayStr); }}
          className="absolute -top-1 right-1 inline-flex items-center gap-1 rounded-full bg-muted/60 border border-border/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground/80 hover:bg-muted/80 active:scale-[0.96] transition"
        >
          Today →
        </button>
      )}
    </div>
  );
}

// ── Wisdom chip ────────────────────────────────────────────────────────
// One-line chip: wizard avatar + truncated advice text + chevron. Subtle,
// scannable, never dominates the hero. Tap fires the same wisdom action
// the original card did (opens TrainingWisdomSheet via parent route).
function WisdomChip({ wisdom }: { wisdom: WisdomState }) {
  const text = wisdom.aiWisdomLoading
    ? "Updating advice…"
    : wisdom.aiWisdomAdvice || wisdom.getNutritionWisdom();

  return (
    <button
      onClick={() => wisdom.generateTrainingFoodIdeas()}
      className="group w-full flex items-center gap-2.5 rounded-xs card-surface px-3 py-2 active:scale-[0.99] transition hover:border-primary/30"
    >
      <div className="relative shrink-0 h-7 w-7 rounded-full bg-primary/15 ring-1 ring-primary/25 flex items-center justify-center overflow-hidden">
        <img src={wizardLogo} alt="Wizard" className="h-full w-full object-contain p-0.5" />
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80 leading-none">
          Today's tip
        </p>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground line-clamp-1 leading-snug">
          {text}
        </p>
      </div>
      {wisdom.trainingWisdomLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary/70 shrink-0" />
      ) : (
        <span className="flex items-center gap-0.5 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors">
          <Sparkles className="h-3 w-3" />
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  );
}
