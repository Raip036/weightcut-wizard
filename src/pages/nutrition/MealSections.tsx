import { Suspense, lazy } from "react";
import { Camera, Search, RotateCcw, ScanLine } from "lucide-react";
import { motion } from "motion/react";
import { MealCard } from "@/components/nutrition/MealCard";
import { MealCardSkeleton } from "@/components/ui/skeleton-loader";
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
          className="flex-1 h-12 rounded-xs bg-primary text-primary-foreground font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
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
            <RotateCcw className="h-4 w-4 text-func-warning-yellow" strokeWidth={2.2} />
          </button>
        )}
      </div>

      {/* Meals heading + count — section label matches the home page
          "Your Stats" style; extra top padding separates it from the CTA row. */}
      <div className="flex items-end justify-between px-1 pt-4">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
          Your Meals
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
        <div className="card-surface rounded-xs py-10 flex items-center justify-center">
          <p className="text-[14px] font-medium text-muted-foreground">No meals logged yet</p>
        </div>
      ) : null}
    </div>
  );
}
