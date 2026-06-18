export interface Ingredient {
  name: string;
  grams: number;
  calories_per_100g?: number;
  protein_per_100g?: number;
  carbs_per_100g?: number;
  fats_per_100g?: number;
  source?: string;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fats_g?: number;
  quantity?: string;
}

export interface AiLineItem {
  name: string;
  quantity: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  // Normalized [0,1] bounding box from the vision model, used to anchor
  // floating macro bubbles over the actual food in the photo. Optional —
  // text-only analyses don't have one, and the UI falls back to scattered
  // positions when missing or invalid.
  bbox?: { x: number; y: number; w: number; h: number };
  // Vision-stage confidence for this item, carried through the macro stage.
  // Drives the portion-review "double-check" flag. Absent on text-only meals.
  confidence?: "high" | "medium" | "low";
  // The AI's original estimate, captured at analysis time. Lets the portion
  // multiplier (½×/1×/1½×/2×) scale relative to the original instead of
  // compounding off prior edits. UI-only — never persisted.
  base?: { calories: number; protein_g: number; carbs_g: number; fats_g: number };
}

// ── DB-backed type aliases. Hand-written snake_case shape that the
// nutrition UI consumes. `meals_with_totals` is produced by Convex
// `meals.listWithTotals` (a per-meal aggregation) and the client mapper.
export interface FoodRow {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  source: string;
  source_ref: string | null;
  verified: boolean;
  default_serving_g: number | null;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fats_per_100g: number;
}
export interface MealRow {
  id: string;
  user_id: string;
  date: string;
  meal_type: string;
  meal_name: string;
  is_ai_generated: boolean;
  notes: string | null;
}
export interface MealItemRow {
  id: string;
  meal_id: string;
  food_id: string | null;
  name: string;
  position: number;
  grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
}
export interface MealWithTotalsRow {
  id: string;
  user_id: string;
  date: string;
  meal_type: string;
  meal_name: string;
  is_ai_generated: boolean;
  notes: string | null;
  total_calories: number;
  total_protein_g: number;
  total_carbs_g: number;
  total_fats_g: number;
  item_count: number;
  created_at?: string;
  photo_url?: string | null;
}

/** Foods catalog row (USDA / OFF / user / AI sourced). */
export type Food = FoodRow;

/** Single line-item within a meal — references a catalog food or is ad-hoc. */
export type MealItem = MealItemRow;

/** Aggregated meal header as returned by the `meals_with_totals` view. */
export type MealWithTotals = MealWithTotalsRow;

/**
 * Client-side Meal shape. Aligned with `meals_with_totals` view so the
 * existing `NutritionHero` + `MealSections` components keep rendering
 * without changes. Totals from the view are mapped to the flat
 * {calories, protein_g, ...} fields via `mapMealsWithTotalsToMeal`
 * (see `useNutritionData.ts`).
 *
 * Legacy fields (`portion_size`, `recipe_notes`, `ingredients`) are
 * retained as optional for backwards compatibility with optimistic
 * rows, cached rows, and the share card. Once all writers have been
 * migrated these become derivable from `meal_items` on demand.
 */
export interface Meal {
  id: string;
  meal_name: string;
  calories: number;
  protein_g?: number;
  carbs_g?: number;
  fats_g?: number;
  meal_type?: string;
  portion_size?: string;
  recipe_notes?: string;
  is_ai_generated?: boolean;
  ingredients?: Ingredient[];
  date: string;
  // New fields exposed by the aggregated view — present on DB-sourced rows,
  // absent on older optimistic payloads. Treat as optional.
  notes?: string | null;
  item_count?: number | null;
  created_at?: string;
  photo_url?: string | null;
}

export interface TrainingFoodTip {
  preMeals: { name: string; description: string; timing: string; macros: string }[];
  postMeals: { name: string; description: string; timing: string; macros: string }[];
  tip: string;
}

export interface MacroGoals {
  proteinGrams: number;
  carbsGrams: number;
  fatsGrams: number;
  recommendedCalories: number;
}

export interface ManualMealForm {
  meal_name: string;
  calories: string;
  protein_g: string;
  carbs_g: string;
  fats_g: string;
  meal_type: string;
  portion_size: string;
  recipe_notes: string;
  ingredients: Ingredient[];
}

export interface ManualNutritionDialogState {
  open: boolean;
  ingredientName: string;
  grams: number;
  calories_per_100g: string;
  protein_per_100g: string;
  carbs_per_100g: string;
  fats_per_100g: string;
}

export interface EditingTargets {
  calories: string;
  protein: string;
  carbs: string;
  fats: string;
}

export interface MealTemplate {
  meal_name: string;
  calories: number;
  protein_g?: number;
  carbs_g?: number;
  fats_g?: number;
  meal_type?: string;
  portion_size?: string;
  recipe_notes?: string;
  ingredients?: Ingredient[];
  savedAt: number;
}

export interface BarcodeBaseMacros {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  serving_size: string;
  serving_weight_g: number;
}

export const INITIAL_MANUAL_MEAL: ManualMealForm = {
  meal_name: "",
  calories: "",
  protein_g: "",
  carbs_g: "",
  fats_g: "",
  meal_type: "breakfast",
  portion_size: "",
  recipe_notes: "",
  ingredients: [],
};

export const INITIAL_MANUAL_NUTRITION_DIALOG: ManualNutritionDialogState = {
  open: false,
  ingredientName: "",
  grams: 0,
  calories_per_100g: "",
  protein_per_100g: "",
  carbs_per_100g: "",
  fats_per_100g: "",
};

// ─── AI day-plan (Meal Plan Ideas) ────────────────────────────────
export interface MealTargets {
  kcal: number;
  protein: number;
  carbs: number;
  fats: number;
}

export interface DayPlanIngredient {
  name: string;
  grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
}

export interface DayPlanMeal {
  id: string;
  name: string;               // meal name from the model
  type: "breakfast" | "lunch" | "dinner" | "snack";
  timingLabel: string;        // e.g. "Pre-training · 16:00"
  timeHint?: string | null;   // e.g. "16:00"
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  why: string;
  prep: string;
  ingredients: DayPlanIngredient[];
}

export interface DayPlan {
  targets: MealTargets & { basis: "full_day" };
  totals: MealTargets;
  onTarget: boolean;
  safetyStatus: "green" | "yellow" | "red";
  safetyMessage: string;
  meals: DayPlanMeal[];
}
