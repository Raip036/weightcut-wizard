// Whole-food health score: this grade answers one question, "is this real
// whole food or processed slop?" It is driven by PROCESSING, not macros. A
// steak scores high; a processed protein bar or packet of crisps scores low.
//
// Axis = NOVA classification (the food-science standard for processing),
// refined by ingredient count and additive count. The AI only reports these
// raw signals per food; ALL scoring math runs here in code so the same food
// always scores identically and the grade is always explainable.

export type NovaClass = 1 | 2 | 3 | 4;
export type HealthGrade = "A" | "B" | "C" | "D" | "E";

/** Raw, processing-focused signals the AI returns per food. No macros. */
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

/** Calorie-weighted meal score so a large processed item dominates the plate. */
export function scoreMeal(
  items: Array<{ calories: number; healthScore: number }>,
): { score: number; worstIndex: number | null } {
  if (items.length === 0) return { score: 0, worstIndex: null };
  const totalCal = items.reduce((s, f) => s + Math.max(0, f.calories), 0);
  const score =
    totalCal > 0
      ? Math.round(items.reduce((s, f) => s + f.healthScore * Math.max(0, f.calories), 0) / totalCal)
      : Math.round(items.reduce((s, f) => s + f.healthScore, 0) / items.length);
  let worstIndex = 0;
  items.forEach((f, i) => {
    if (f.healthScore < items[worstIndex].healthScore) worstIndex = i;
  });
  return { score, worstIndex };
}

/** Validate + normalize the AI's raw per-food fields. Returns undefined when
 *  the food was not classified (older cached results), so the UI hides the
 *  health rating rather than showing a wrong grade. */
export function coerceHealthInputs(raw: unknown): FoodHealthInputs | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const nova = Number(r.novaClass);
  if (![1, 2, 3, 4].includes(nova)) return undefined;
  const ingredientCount = Number.isFinite(Number(r.ingredientCount))
    ? Math.max(1, Math.round(Number(r.ingredientCount)))
    : 1;
  const additivesCount = Number.isFinite(Number(r.additivesCount))
    ? Math.max(0, Math.round(Number(r.additivesCount)))
    : 0;
  return {
    novaClass: nova as NovaClass,
    ingredientCount,
    additivesCount,
    isWholeFood: r.isWholeFood === true,
  };
}
