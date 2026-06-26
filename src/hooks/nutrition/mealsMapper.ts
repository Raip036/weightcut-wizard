import type { Meal, MealItem, MealWithTotals } from "@/pages/nutrition/types";

/**
 * Map a row from the v2 `meals_with_totals` shape (now produced by Convex
 * `meals.listWithTotals`) onto the flat `Meal` shape consumed by
 * `NutritionHero` / `MealSections`. Totals become the top-level macro fields
 * so no downstream component needs to change.
 */
export function mapMealsWithTotalsToMeal(row: MealWithTotals): Meal {
  return {
    id: (row.id ?? "") as string,
    meal_name: (row.meal_name ?? "") as string,
    meal_type: (row.meal_type ?? "snack") as string,
    calories: Math.round(Number(row.total_calories ?? 0)),
    protein_g: Number(row.total_protein_g ?? 0),
    carbs_g: Number(row.total_carbs_g ?? 0),
    fats_g: Number(row.total_fats_g ?? 0),
    is_ai_generated: !!row.is_ai_generated,
    notes: row.notes ?? null,
    item_count: row.item_count ?? null,
    date: (row.date ?? "") as string,
    created_at: row.created_at,
    photo_url: row.photo_url ?? null,
    health_score: row.health_score ?? null,
  };
}

/**
 * Convex `meals.listWithTotals` inlines `meal_items` on every row, so a
 * client-side per-meal items fetch is no longer required. Kept as a stub
 * returning [] so legacy callers (lazy expand-card flows) compile while we
 * thread items through the parent query.
 */
export async function fetchMealItems(_mealId: string): Promise<MealItem[]> {
  return [];
}

/** No-op — the in-memory cache that this used to back is gone. */
export function invalidateMealItemsCache(_mealId?: string): void {
  /* no-op */
}
