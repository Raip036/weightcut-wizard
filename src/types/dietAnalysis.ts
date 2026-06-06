export type NutrientCategory = "vitamin" | "mineral" | "fatty_acid" | "other";

export interface MicronutrientData {
  name: string;
  percentRDA: number;
  amount: string;
  rdaTarget: string;
  /** Derived server-side from a static name map; defaults to "other". */
  category: NutrientCategory;
}

export interface NutrientGap {
  nutrient: string;
  percentRDA: number;
  severity: "low" | "moderate" | "critical";
  reason: string;
}

export interface FoodSuggestion {
  food: string;
  reason: string;
  nutrients: string[];
}

export interface MealNutrientBreakdown {
  mealType: string;
  mealName: string;
  keyNutrients: { name: string; amount: string }[];
}

export interface MealAdditionItem {
  /** Imperative phrase: "Add a handful of spinach" or "Swap the milk for kefir". */
  item: string;
  /** Plain-language explanation of what the addition unlocks for THIS meal. */
  benefit: string;
  /** Nutrients the addition specifically boosts. */
  nutrients: string[];
}

export interface MealAddition {
  mealType: string;
  mealName: string;
  additions: MealAdditionItem[];
}

export interface VitaminRounder {
  /** Single food / pairing that covers a wide spread of vitamins or minerals. */
  food: string;
  /** Vitamins / minerals this food rounds out at once. */
  vitamins: string[];
  /** Why this works as an all-rounder for the user's current pattern. */
  reason: string;
}

/** Which logged food supplied which nutrients (foods to nutrients mapping). */
export interface FoodContribution {
  food: string;
  mealType?: string;
  nutrients: { name: string; amount: string }[];
}

/** A short, tagged takeaway framed for either everyday health or performance. */
export interface KeyInsight {
  focus: "health" | "performance";
  text: string;
}

/**
 * Today's protein adequacy by bodyweight (g/kg) - computed deterministically
 * server-side (not by the LLM) so the numbers are always correct.
 */
export interface ProteinVerdict {
  actualG: number;
  targetG: number;
  /** Actual grams per kg bodyweight today. */
  gPerKg: number;
  /** The g/kg target used (about 2.0 for a combat athlete in a cut). */
  targetGPerKg: number;
  /** max(0, targetG - actualG). */
  shortfallG: number;
  verdict: "low" | "on_track" | "high";
}

/**
 * 7-day macro trend pulled from the athlete snapshot - moves the analysis
 * beyond a single day so adequacy reads as a pattern, not a one-off.
 */
export interface WeeklyTrend {
  proteinAvgG: number | null;
  proteinAvgGPerKg: number | null;
  calorieAvgKcal: number | null;
  /** Short coach line summarising the week. */
  note: string;
}

export interface DietAnalysisResult {
  summary: string;
  mealBreakdown?: MealNutrientBreakdown[];
  micronutrients: MicronutrientData[];
  gaps: NutrientGap[];
  suggestions: FoodSuggestion[];
  /** Per-meal, "what to add" suggestions tied back to the meals the user logged. */
  mealAdditions?: MealAddition[];
  /** Foods that broadly cover multiple vitamin/mineral gaps in one shot. */
  vitaminRounders?: VitaminRounder[];
  /** Which logged foods supplied which nutrients. */
  foodContributions?: FoodContribution[];
  /** 2-4 tagged takeaways (health / performance). */
  keyInsights?: KeyInsight[];
  /** Today's protein g/kg verdict (computed server-side). */
  proteinVerdict?: ProteinVerdict;
  /** 7-day macro trend from the athlete snapshot. */
  weeklyTrend?: WeeklyTrend;
}
