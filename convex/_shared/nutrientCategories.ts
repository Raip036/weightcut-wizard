/**
 * Deterministic nutrient -> category mapping. Run server-side after the LLM
 * returns so grouping in the UI never depends on the model tagging categories
 * correctly. Unknown names fall back to "other".
 */
export type NutrientCategory = "vitamin" | "mineral" | "fatty_acid" | "other";

const MINERALS = new Set([
  "iron", "zinc", "magnesium", "calcium", "selenium", "potassium",
  "sodium", "phosphorus", "copper", "manganese", "iodine", "chromium",
  "molybdenum",
]);

const FATTY_ACIDS = new Set([
  "omega-3", "omega 3", "omega3", "omega-6", "omega 6", "omega6",
  "epa", "dha", "ala", "fatty acid", "fatty acids",
]);

const VITAMIN_TOKENS = [
  "vitamin", "thiamin", "thiamine", "riboflavin", "niacin", "folate",
  "folic", "biotin", "pantothen", "cobalamin", "retinol", "ascorb",
];

// Stand-alone B-vitamin shorthands like "B12", "B6".
const B_VITAMIN_RE = /^b\s?\d{1,2}$/;

export function deriveNutrientCategory(name: string): NutrientCategory {
  const n = (name || "").trim().toLowerCase();
  if (!n) return "other";
  if (FATTY_ACIDS.has(n)) return "fatty_acid";
  if (MINERALS.has(n)) return "mineral";
  if (B_VITAMIN_RE.test(n)) return "vitamin";
  if (VITAMIN_TOKENS.some((t) => n.includes(t))) return "vitamin";
  return "other";
}
