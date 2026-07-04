/**
 * Whole-food health scoring (backend mirror).
 *
 * This is a server-side mirror of the scoring math in
 * `src/lib/foodHealthScore.ts` — Convex code cannot import from `src/`, so the
 * two files must be kept in sync by hand (same precedent as
 * `convex/_shared/weighInTiming.ts` mirroring its `src/lib` twin). Only the
 * pieces the backend needs are mirrored here: the `FoodHealthInputs` type,
 * `scoreFood`, `scoreMeal`, and `coerceHealthInputs`. The band metadata and
 * UI-only helpers live only on the client.
 *
 * The grade answers one question, "is this real whole food or processed
 * slop?" It is driven by PROCESSING (NOVA classification), not macros. The AI
 * only reports the raw per-food signals; ALL scoring math runs here in code so
 * the same food always scores identically. If you change a constant here,
 * change it in `src/lib/foodHealthScore.ts` too.
 */

export type NovaClass = 1 | 2 | 3 | 4;

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
 *  the food was not classified, so callers can fall back to a conservative
 *  default rather than showing a wrong grade. */
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
