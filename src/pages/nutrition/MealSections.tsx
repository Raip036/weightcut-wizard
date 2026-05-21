import { Suspense, lazy } from "react";
import { Camera, Search, RotateCcw, ScanLine, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { MealCard } from "@/components/nutrition/MealCard";
import { MealCardSkeleton } from "@/components/ui/skeleton-loader";
import { WizardCharacter } from "@/tutorial/WizardCharacter";
import { triggerHapticSelection } from "@/lib/haptics";
import type { Meal } from "@/pages/nutrition/types";

const BarcodeScanner = lazy(() =>
  import("@/components/nutrition/BarcodeScanner").then((m) => ({ default: m.BarcodeScanner }))
);

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

interface QuickActionsShape {
  lastMeal: Meal | null;
  repeatLastMeal: (mealType?: string) => void;
  copyPreviousDay?: () => void;
  toggleFavorite: (meal: Meal) => void;
  isFavorited: (meal: Meal) => boolean;
}

interface AiMealHandlers {
  handleBarcodeScanned: (data: any) => void;
}

interface MealSectionsProps {
  mealsLoading: boolean;
  meals: Meal[];
  quickActions: QuickActionsShape;
  aiMealHandlers: AiMealHandlers;
  generatingPlan: boolean;
  savingAllMeals: boolean;
  onDeleteMeal: (meal: Meal) => void;
  onOpenFoodSearch: () => void;
  onOpenQuickAdd: () => void;
  onOpenManualAdd: () => void;
  onOpenFavorites?: () => void;
}

/**
 * Renders meals as a stack of standalone cards. New design:
 *   - One big primary "Snap a meal" button + small Search / Barcode / Repeat icons
 *   - Wizard-led empty state when no meals are logged
 *   - Meal cards spring in from below on first paint
 */
export function MealSections({
  mealsLoading,
  meals,
  quickActions,
  aiMealHandlers,
  generatingPlan,
  savingAllMeals,
  onDeleteMeal,
  onOpenFoodSearch,
  onOpenQuickAdd,
  onOpenFavorites,
}: MealSectionsProps) {
  const visibleMeals = meals.filter((meal) => meal && typeof meal.id === "string" && meal.id.length > 0);
  const totalKcal = visibleMeals.reduce((sum, m) => sum + (m.calories || 0), 0);
  const isEmpty = !mealsLoading && visibleMeals.length === 0;

  return (
    <div className="space-y-3">
      {/* Primary CTA row — Snap dominates, Search/Barcode/Repeat sit alongside */}
      <div className="flex items-stretch gap-2">
        <button
          onClick={() => { triggerHapticSelection(); onOpenQuickAdd(); }}
          className="flex-1 h-12 rounded-xs bg-primary text-primary-foreground font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg shadow-primary/30"
        >
          <Camera className="h-4 w-4" strokeWidth={2.4} />
          Snap a meal
        </button>
        <button
          onClick={() => { triggerHapticSelection(); onOpenFoodSearch(); }}
          className="h-12 w-12 rounded-xs bg-muted/40 border border-border/40 flex items-center justify-center active:scale-[0.96] transition-transform"
          aria-label="Search foods"
          title="Search"
        >
          <Search className="h-4 w-4 text-foreground/80" strokeWidth={2.2} />
        </button>
        <Suspense
          fallback={
            <div className="h-12 w-12 rounded-xs bg-muted/40 border border-border/40 flex items-center justify-center">
              <ScanLine className="h-4 w-4 text-muted-foreground" />
            </div>
          }
        >
          <BarcodeScanner
            onFoodScanned={aiMealHandlers.handleBarcodeScanned}
            disabled={generatingPlan || savingAllMeals}
            className="h-12 w-12 rounded-xs bg-muted/40 !border border-border/40 active:scale-[0.96] transition-transform flex items-center justify-center"
          />
        </Suspense>
        {quickActions.lastMeal && (
          <button
            onClick={() => { triggerHapticSelection(); quickActions.repeatLastMeal(); }}
            className="h-12 w-12 rounded-xs bg-muted/40 border border-border/40 flex items-center justify-center active:scale-[0.96] transition-transform"
            aria-label="Repeat last meal"
            title="Repeat last"
          >
            <RotateCcw className="h-4 w-4 text-amber-400" strokeWidth={2.2} />
          </button>
        )}
      </div>

      {/* Meals heading + count */}
      <div className="flex items-end justify-between px-1 pt-1">
        <h3 className="text-[18px] font-semibold tracking-tight text-foreground">
          Meals
        </h3>
        {visibleMeals.length > 0 && (
          <span className="text-[11px] tabular-nums text-muted-foreground/60 pb-0.5">
            {visibleMeals.length} logged · {Math.round(totalKcal)} kcal
          </span>
        )}
      </div>

      {/* Meal list / empty state */}
      {visibleMeals.length > 0 ? (
        <motion.div
          className="space-y-2.5"
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.04 } },
          }}
        >
          {visibleMeals.map((meal, idx) => (
            <motion.div
              key={`${meal.id}:${idx}`}
              variants={{
                hidden: { opacity: 0, y: 12, scale: 0.96 },
                show: { opacity: 1, y: 0, scale: 1 },
              }}
              transition={{ type: "spring", stiffness: 360, damping: 28 }}
            >
              <MealCard
                meal={meal}
                onDelete={() => onDeleteMeal(meal)}
                onFavorite={() => quickActions.toggleFavorite(meal)}
                isFavorited={quickActions.isFavorited(meal)}
              />
            </motion.div>
          ))}
        </motion.div>
      ) : mealsLoading ? (
        <MealCardSkeleton />
      ) : isEmpty ? (
        <WizardEmptyState
          hasLastMeal={!!quickActions.lastMeal}
          hasFavorites={!!onOpenFavorites}
          onRepeatYesterday={() => {
            triggerHapticSelection();
            quickActions.copyPreviousDay?.();
          }}
          onAddFavorite={() => { triggerHapticSelection(); onOpenFavorites?.(); }}
          onSnap={() => { triggerHapticSelection(); onOpenQuickAdd(); }}
        />
      ) : null}
    </div>
  );
}

// ── Wizard-led empty state ─────────────────────────────────────────────
// Shown when the day has no logged meals. Wizard mascot waves + a
// question prompt + 3 quick-tap action chips. Replaces the bland
// "No meals yet — tap below to log one." placeholder.
function WizardEmptyState({
  hasLastMeal,
  hasFavorites,
  onRepeatYesterday,
  onAddFavorite,
  onSnap,
}: {
  hasLastMeal: boolean;
  hasFavorites: boolean;
  onRepeatYesterday: () => void;
  onAddFavorite: () => void;
  onSnap: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="relative overflow-hidden rounded-3xl border border-border/50 bg-card/60 p-4"
    >
      {/* Wizard + headline */}
      <div className="flex items-start gap-3 mb-3">
        <div className="relative shrink-0" style={{ width: 64, height: 64 }}>
          <div style={{ width: 140, height: 140, transform: "scale(0.46)", transformOrigin: "top left" }}>
            <WizardCharacter pose="wave" />
          </div>
        </div>
        <div className="min-w-0 flex-1 pt-1.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
            Coach
          </p>
          <h4 className="mt-0.5 text-[17px] font-bold leading-tight">
            What did you eat?
          </h4>
          <p className="mt-1 text-[12px] text-muted-foreground leading-snug">
            Pick the fastest way to log it.
          </p>
        </div>
      </div>

      {/* Quick-tap chips */}
      <div className="flex flex-wrap gap-2">
        {hasLastMeal && (
          <button
            onClick={onRepeatYesterday}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 border border-border/40 px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted/60 active:scale-[0.97] transition"
          >
            <RotateCcw className="h-3.5 w-3.5 text-amber-400" strokeWidth={2.4} />
            Repeat yesterday
          </button>
        )}
        {hasFavorites && (
          <button
            onClick={onAddFavorite}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 border border-border/40 px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted/60 active:scale-[0.97] transition"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={2.4} />
            Add favorite
          </button>
        )}
        <button
          onClick={onSnap}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-bold text-primary-foreground active:scale-[0.97] transition shadow-md shadow-primary/30"
        >
          <Camera className="h-3.5 w-3.5" strokeWidth={2.4} />
          Snap a photo
        </button>
      </div>
    </motion.div>
  );
}
