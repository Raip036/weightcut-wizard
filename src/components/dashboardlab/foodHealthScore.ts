// MOCKUP - meal health grade lab. Delete after sign-off (move to src/lib on port).
//
// WHOLE-FOOD score: this grade answers one question, "is this real whole food
// or processed slop?" It is driven by PROCESSING, not macros. A steak scores
// high; a processed protein bar or packet of crisps scores low.
//
// Axis = NOVA classification (the food-science standard for processing),
// refined by ingredient count and additive count. All math runs here in code
// so the same food always scores identically.

export type NovaClass = 1 | 2 | 3 | 4;
export type HealthGrade = "A" | "B" | "C" | "D" | "E";

/** Fields the AI returns per food. Simple, processing-focused, no macros. */
export interface FoodHealthInputs {
  /** NOVA group: 1 unprocessed, 2 culinary ingredient, 3 processed, 4 ultra-processed. */
  novaClass: NovaClass;
  /** Distinct ingredients on the label. A whole food is 1. */
  ingredientCount: number;
  /** Artificial additives: preservatives, sweeteners, colors, flavors, emulsifiers. */
  additivesCount: number;
  /** True for a single recognizable whole ingredient (steak, egg, apple, oats). */
  isWholeFood: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// NOVA sets the starting point: real food high, ultra-processed low.
const NOVA_BASE: Record<NovaClass, number> = { 1: 96, 2: 80, 3: 58, 4: 38 };

/** Final 0-100 whole-food score for one food. */
export function scoreFood(i: FoodHealthInputs): number {
  let score = NOVA_BASE[i.novaClass];

  // Each artificial additive signals an industrial formulation, not real food.
  score -= Math.min(i.additivesCount * 4, 24);

  // Long ingredient lists = a manufactured product. Whole foods have 1 to 2.
  score -= clamp((i.ingredientCount - 6) * 1.2, 0, 14);

  // A single whole ingredient is real food and can't be dragged below an A/B.
  if (i.isWholeFood) score = Math.max(score, 85);

  // Ultra-processed can never read green, no matter what.
  if (i.novaClass === 4) score = Math.min(score, 45);

  return Math.round(clamp(score, 0, 100));
}

export interface GradeMeta {
  grade: HealthGrade;
  color: string; // band color (hex)
  softBg: string; // same color, low alpha
  /** Descriptive, non-judgmental per-food tag. */
  tag: string;
  /** Persuasive, non-judgmental meal-level caption. No em dashes. */
  caption: string;
}

const BANDS: Array<{ min: number } & GradeMeta> = [
  {
    min: 80, grade: "A", color: "#23C599", softBg: "rgba(35,197,153,0.14)",
    tag: "Whole food",
    caption: "Whole, real food. Exactly what your body wants.",
  },
  {
    min: 65, grade: "B", color: "#8FD14F", softBg: "rgba(143,209,79,0.14)",
    tag: "Minimally processed",
    caption: "Barely processed. Still close to its natural form.",
  },
  {
    min: 50, grade: "C", color: "#FAC146", softBg: "rgba(250,193,70,0.14)",
    tag: "Processed",
    caption: "Some processing here. A whole-food swap would lift it.",
  },
  {
    min: 35, grade: "D", color: "#F08439", softBg: "rgba(240,132,57,0.14)",
    tag: "Highly processed",
    caption: "Heavily processed. Best kept as the occasional choice.",
  },
  {
    min: 0, grade: "E", color: "#F7403F", softBg: "rgba(247,64,63,0.14)",
    tag: "Ultra-processed",
    caption: "Ultra-processed. Lots of industrial ingredients, little real food.",
  },
];

export function gradeMeta(score: number): GradeMeta {
  const b = BANDS.find((x) => score >= x.min) ?? BANDS[BANDS.length - 1];
  return { grade: b.grade, color: b.color, softBg: b.softBg, tag: b.tag, caption: b.caption };
}

export interface ScoredFood {
  name: string;
  quantity: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  health: FoodHealthInputs;
  healthScore: number;
}

/** Calorie-weighted meal score so a large processed item dominates the plate. */
export function scoreMeal(foods: ScoredFood[]): { score: number; worst: ScoredFood | null } {
  const totalCal = foods.reduce((s, f) => s + f.calories, 0);
  const score =
    totalCal > 0
      ? Math.round(foods.reduce((s, f) => s + f.healthScore * f.calories, 0) / totalCal)
      : Math.round(foods.reduce((s, f) => s + f.healthScore, 0) / Math.max(foods.length, 1));
  const worst = foods.length
    ? foods.reduce((w, f) => (f.healthScore < w.healthScore ? f : w), foods[0])
    : null;
  return { score, worst };
}

// ── Sample data (stands in for the AI output until the feature is wired) ──
function food(
  name: string, quantity: string, calories: number, p: number, c: number, f: number,
  health: FoodHealthInputs,
): ScoredFood {
  return { name, quantity, calories, protein_g: p, carbs_g: c, fats_g: f, health, healthScore: scoreFood(health) };
}

const WHOLE = (nova: NovaClass = 1): FoodHealthInputs => ({
  novaClass: nova, ingredientCount: 1, additivesCount: 0, isWholeFood: true,
});

export interface SampleMeal {
  key: string;
  title: string;
  foods: ScoredFood[];
}

export const SAMPLE_MEALS: SampleMeal[] = [
  {
    key: "steak",
    title: "Steak Dinner",
    foods: [
      food("Ribeye steak", "250 g", 540, 46, 0, 40, WHOLE(1)),
      food("Roast sweet potato", "180 g", 160, 3, 37, 0, WHOLE(1)),
      food("Steamed broccoli", "100 g", 35, 2.8, 7, 0.4, WHOLE(1)),
      food("Olive oil", "1 tbsp", 119, 0, 0, 14, {
        novaClass: 2, ingredientCount: 1, additivesCount: 0, isWholeFood: false,
      }),
    ],
  },
  {
    key: "breakfast",
    title: "Breakfast Plate",
    foods: [
      food("Hard boiled egg", "3 whole eggs", 234, 19, 2, 16, WHOLE(1)),
      food("Raw carrots", "80 g", 33, 0.7, 8, 0, WHOLE(1)),
      food("Cheddar cheese", "40 g", 161, 10, 1, 13, {
        novaClass: 3, ingredientCount: 4, additivesCount: 0, isWholeFood: false,
      }),
      food("Packaged oat muffin", "2 muffins", 340, 8, 50, 12, {
        novaClass: 4, ingredientCount: 14, additivesCount: 3, isWholeFood: false,
      }),
    ],
  },
  {
    key: "slop",
    title: "Processed Snacks",
    foods: [
      food("Protein bar", "1 bar", 220, 20, 24, 7, {
        novaClass: 4, ingredientCount: 22, additivesCount: 5, isWholeFood: false,
      }),
      food("Potato crisps", "1 grab bag", 230, 3, 23, 14, {
        novaClass: 4, ingredientCount: 10, additivesCount: 3, isWholeFood: false,
      }),
      food("Coca-Cola", "330 ml", 139, 0, 35, 0, {
        novaClass: 4, ingredientCount: 7, additivesCount: 4, isWholeFood: false,
      }),
    ],
  },
];
