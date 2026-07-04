/**
 * Deterministic food-health signal derivation for the barcode and search
 * backends.
 *
 * The whole-food grade (A-E) is PROCESSING-based, not macro-based: the AI meal
 * scanner reports four raw signals per food (NOVA class, ingredient count,
 * additive count, whole-food flag) and the actual score is computed in code
 * from those signals (see src/lib/foodHealthScore.ts). Barcode and search hits
 * come from external databases (OpenFoodFacts, USDA FoodData Central) and never
 * touch an LLM, so we reconstruct the same four signals here from the structured
 * fields those sources expose. Same input always yields the same output.
 *
 * This module intentionally mirrors — but cannot import — the FoodHealthInputs
 * shape in src/lib/foodHealthScore.ts (Convex functions can't reach into src/).
 */

export type NovaClass = 1 | 2 | 3 | 4;

/** Raw, processing-focused signals. Mirrors src/lib/foodHealthScore.ts. */
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

// ---------------------------------------------------------------------------
// Keyword lexicons (lower-case, substring-matched). These describe PROCESSING,
// never macros — we look at what a food IS, not how many calories it has.
// ---------------------------------------------------------------------------

// Hallmark ultra-processed items: things that are essentially industrial
// formulations by definition (NOVA 4) even before we see an ingredient list.
const UPF_KEYWORDS = [
  "soda", "cola", "soft drink", "energy drink", "sports drink",
  "candy", "candies", "gummy", "gummies", "lollipop", "chewing gum",
  "hot dog", "hotdog", "frankfurter", "corn dog",
  "instant noodle", "ramen noodle",
];

// Clearly processed items (NOVA 3): recognizable foods that have been through
// meaningful processing but aren't purely industrial formulations.
const PROCESSED_KEYWORDS = [
  "bread", "roll", "bun", "bagel", "sausage", "bacon", "ham", "salami",
  "pepperoni", "luncheon", "deli meat", "cured", "jerky",
  "chips", "crisps", "cookie", "biscuit", "cracker", "pretzel",
  "cereal bar", "granola bar", "protein bar",
  "ice cream", "margarine", "syrup", "nugget", "pastry", "doughnut",
  "donut", "cake", "muffin", "canned", "pickled", "smoked",
];

// Processed culinary ingredients (NOVA 2): things you cook WITH rather than eat
// as a food. A single one of these is not a "whole food" but isn't processed
// slop either.
const CULINARY_KEYWORDS = [
  "oil", "butter", "ghee", "lard", "sugar", "salt", "honey",
  "flour", "vinegar", "molasses", "cornstarch", "starch",
];

// Additive markers found in free-text ingredient strings (USDA Branded /
// OpenFoodFacts). Substring, case-insensitive. Each hit counts as one additive.
const ADDITIVE_MARKERS = [
  "artificial flavor", "artificial flavour", "natural flavor", "natural flavour",
  "artificial color", "artificial colour", "color added", "colour added",
  "aspartame", "sucralose", "acesulfame", "saccharin",
  "high fructose", "corn syrup", "maltodextrin", "dextrose",
  "emulsifier", "mono- and diglycerides", "monoglycerides", "diglycerides",
  "carrageenan", "xanthan", "guar gum", "soy lecithin", "lecithin",
  "preservative", "sodium benzoate", "potassium sorbate", "sodium nitrite",
  "bht", "bha", "hydrogenated", "modified starch",
];

// Ingredient-text hallmarks of ultra-processing (independent of the count).
const UPF_INGREDIENT_MARKERS = [
  "high fructose", "corn syrup", "hydrogenated", "maltodextrin",
  "aspartame", "sucralose", "acesulfame", "artificial flavor",
  "artificial flavour", "artificial color", "artificial colour",
  "modified starch", "mono- and diglycerides",
];

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/**
 * Count top-level, comma-separated ingredient segments, ignoring commas nested
 * inside parentheses/brackets (sub-ingredients). "sugar, salt (sea salt,
 * iodine), water" => 3, not 4.
 */
function countTopLevelSegments(text: string): number {
  const t = (text || "").trim();
  if (!t) return 0;
  let depth = 0;
  let count = 1;
  for (const ch of t) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) count++;
  }
  return count;
}

/** Count E-number additives (E621, E150d, ...) in a free-text string. */
function countENumbers(text: string): number {
  const matches = (text || "").match(/\bE\d{3}[a-z]?\b/gi);
  return matches ? matches.length : 0;
}

/** Count named additive markers present in an ingredient string. */
function countAdditiveMarkers(text: string): number {
  const lower = (text || "").toLowerCase();
  let n = 0;
  for (const marker of ADDITIVE_MARKERS) {
    if (lower.includes(marker)) n++;
  }
  return n;
}

const includesAny = (haystack: string, needles: string[]) => {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n));
};

/**
 * Keyword-based NOVA hint from a food's name/description alone. Returns the
 * strongest processing signal the name implies, or undefined when the name is
 * neutral (so callers fall back to their default, usually whole-food).
 */
function novaHintFromName(name: string): NovaClass | undefined {
  if (!name) return undefined;
  if (includesAny(name, UPF_KEYWORDS)) return 4;
  if (includesAny(name, PROCESSED_KEYWORDS)) return 3;
  if (includesAny(name, CULINARY_KEYWORDS)) return 2;
  return undefined;
}

// ---------------------------------------------------------------------------
// OpenFoodFacts (barcode)
// ---------------------------------------------------------------------------

/**
 * Parse an OpenFoodFacts NOVA value. OFF exposes `nova_group` as a number and
 * `nova_groups` as a string ("4"); accept either when it lands in 1-4.
 */
function parseOffNova(product: any): NovaClass | undefined {
  const fromNumeric = Number(product?.nova_group);
  if ([1, 2, 3, 4].includes(fromNumeric)) return fromNumeric as NovaClass;
  const fromString = Number(String(product?.nova_groups ?? "").trim());
  if ([1, 2, 3, 4].includes(fromString)) return fromString as NovaClass;
  return undefined;
}

/**
 * Derive health inputs from an OpenFoodFacts product. Returns undefined when
 * the product carries no NOVA classification AND no ingredient/additive data at
 * all — we'd rather hide the grade than invent one from the name alone.
 */
export function healthFromOpenFoodFacts(product: any): FoodHealthInputs | undefined {
  if (!product || typeof product !== "object") return undefined;

  const nova = parseOffNova(product);
  const ingredientsText: string = String(product.ingredients_text ?? "");
  const hasIngredientsN = Number.isFinite(Number(product.ingredients_n));
  const hasIngredientsArr = Array.isArray(product.ingredients) && product.ingredients.length > 0;
  const hasAdditivesN = Number.isFinite(Number(product.additives_n));
  const hasAdditivesTags = Array.isArray(product.additives_tags);

  // Not enough structured data to classify -> unclassifiable.
  if (
    nova === undefined &&
    !ingredientsText.trim() &&
    !hasIngredientsN &&
    !hasIngredientsArr &&
    !hasAdditivesN &&
    !hasAdditivesTags
  ) {
    return undefined;
  }

  // Ingredient count: prefer the explicit numeric field, then the parsed
  // ingredient array, then a parentheses-aware token count of the free text.
  let ingredientCount: number;
  if (hasIngredientsN) {
    ingredientCount = Math.max(1, Math.round(Number(product.ingredients_n)));
  } else if (hasIngredientsArr) {
    ingredientCount = Math.max(1, product.ingredients.length);
  } else if (ingredientsText.trim()) {
    ingredientCount = Math.max(1, countTopLevelSegments(ingredientsText));
  } else {
    ingredientCount = 1;
  }

  // Additive count: explicit numeric field, then the additives_tags array, then
  // E-numbers parsed out of the ingredient text.
  let additivesCount: number;
  if (hasAdditivesN) {
    additivesCount = Math.max(0, Math.round(Number(product.additives_n)));
  } else if (hasAdditivesTags) {
    additivesCount = product.additives_tags.length;
  } else {
    additivesCount = countENumbers(ingredientsText);
  }

  // NOVA: trust OFF's own classification when present; otherwise estimate from
  // additives, ingredient count, and hallmark ingredient markers.
  let novaClass: NovaClass;
  if (nova !== undefined) {
    novaClass = nova;
  } else if (additivesCount >= 1 || includesAny(ingredientsText, UPF_INGREDIENT_MARKERS)) {
    novaClass = 4;
  } else if (ingredientCount >= 3) {
    novaClass = 3;
  } else if (novaHintFromName(String(product.product_name ?? "")) === 2) {
    // Single culinary ingredient (oil/sugar/salt/butter).
    novaClass = 2;
  } else {
    novaClass = 1;
  }

  const isWholeFood = novaClass === 1 && ingredientCount <= 2 && additivesCount === 0;

  return { novaClass, ingredientCount, additivesCount, isWholeFood };
}

// ---------------------------------------------------------------------------
// USDA FoodData Central (search)
// ---------------------------------------------------------------------------

export interface UsdaHealthArgs {
  /** "Foundation" | "SR Legacy" | "Branded". */
  dataType: string;
  description: string;
  brand?: string;
  /** Branded rows only: the label ingredient string. */
  ingredientsText?: string;
}

/**
 * Generic (Foundation / SR Legacy) foods are unbranded whole-ish foods. Default
 * them to whole food, then downgrade by name: hallmark UPF names to NOVA 4,
 * other processed names to NOVA 3, culinary ingredients to NOVA 2.
 */
function healthForGenericUsda(description: string): FoodHealthInputs {
  const hint = novaHintFromName(description);
  if (hint === 4) {
    return { novaClass: 4, ingredientCount: 5, additivesCount: 1, isWholeFood: false };
  }
  if (hint === 3) {
    return { novaClass: 3, ingredientCount: 3, additivesCount: 0, isWholeFood: false };
  }
  if (hint === 2) {
    return { novaClass: 2, ingredientCount: 1, additivesCount: 0, isWholeFood: false };
  }
  return { novaClass: 1, ingredientCount: 1, additivesCount: 0, isWholeFood: true };
}

/**
 * Branded foods carry a real ingredient string — classify from it. Without one
 * we return undefined (never guess processing from a brand name alone).
 */
function healthForBrandedUsda(
  description: string,
  ingredientsText: string,
): FoodHealthInputs | undefined {
  const text = ingredientsText.trim();
  if (!text) return undefined;

  const ingredientCount = Math.max(1, countTopLevelSegments(text));
  const additivesCount = countENumbers(text) + countAdditiveMarkers(text);
  const hallmarkUpf =
    includesAny(text, UPF_INGREDIENT_MARKERS) || includesAny(description, UPF_KEYWORDS);

  let novaClass: NovaClass;
  if (additivesCount >= 2 || ingredientCount >= 8 || hallmarkUpf) {
    novaClass = 4;
  } else if (ingredientCount >= 3 || additivesCount === 1) {
    novaClass = 3;
  } else if (novaHintFromName(description) === 2) {
    novaClass = 2;
  } else {
    novaClass = 1;
  }

  const isWholeFood = novaClass === 1 && ingredientCount <= 1 && additivesCount === 0;

  return { novaClass, ingredientCount, additivesCount, isWholeFood };
}

/**
 * Derive health inputs from a USDA search hit. Foundation / SR Legacy classify
 * from the description; Branded classify from the ingredient string (undefined
 * when it's missing).
 */
export function healthFromUsda(args: UsdaHealthArgs): FoodHealthInputs | undefined {
  const dataType = (args.dataType || "").toLowerCase();
  if (dataType === "branded") {
    return healthForBrandedUsda(args.description || "", args.ingredientsText || "");
  }
  // Foundation, SR Legacy, and any other generic/unbranded type.
  return healthForGenericUsda(args.description || "");
}
