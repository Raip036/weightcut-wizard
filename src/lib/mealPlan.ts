import type { DayPlanMeal, MealTargets } from "@/pages/nutrition/types";

export const MEAL_PLAN_MIN = 3;
export const MEAL_PLAN_MAX = 6;
export const MEAL_PLAN_DEFAULT = 4;

/** Tolerance for "on target": ±5% calories, ±a few grams per macro. */
export const MEAL_PLAN_TOLERANCE = { kcalPct: 0.05, gram: 8 };

export function clampMealCount(n: number): number {
  if (!Number.isFinite(n)) return MEAL_PLAN_DEFAULT;
  return Math.max(MEAL_PLAN_MIN, Math.min(MEAL_PLAN_MAX, Math.round(n)));
}

export function computePlanTotals(meals: DayPlanMeal[]): MealTargets {
  const protein = meals.reduce((s, m) => s + (m.protein || 0), 0);
  const carbs = meals.reduce((s, m) => s + (m.carbs || 0), 0);
  const fats = meals.reduce((s, m) => s + (m.fats || 0), 0);
  return { protein, carbs, fats, kcal: protein * 4 + carbs * 4 + fats * 9 };
}

export function isOnTarget(totals: MealTargets, target: MealTargets): boolean {
  const kcalOk =
    Math.abs(totals.kcal - target.kcal) <= target.kcal * MEAL_PLAN_TOLERANCE.kcalPct;
  const g = MEAL_PLAN_TOLERANCE.gram;
  return (
    kcalOk &&
    Math.abs(totals.protein - target.protein) <= g &&
    Math.abs(totals.carbs - target.carbs) <= g &&
    Math.abs(totals.fats - target.fats) <= g
  );
}
