/**
 * Pure, dependency-free food search ranking.
 *
 * Re-orders raw food search results so the most useful items surface first.
 * Operates exclusively on plain objects — it imports NOTHING from Convex
 * generated code — so it is trivially unit-testable.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SCORING TIERS (priority order, most important first):
 *
 *   HISTORY  ≫  CLEAN_INGREDIENT  >  BRANDED  >  NAME_MATCH
 *
 *   1. HISTORY (dominant): items the user logs often are pinned to the top.
 *      The boost dwarfs every other tier so a frequently-logged food always
 *      out-ranks a "better" generic ingredient.
 *   2. CLEAN_INGREDIENT: USDA "Foundation" / "SR Legacy" whole foods get a
 *      solid mid boost, reduced by a NAME-NOISE penalty (commas + length) so
 *      a concise "Chicken breast, raw" beats a verbose, qualifier-laden name.
 *   3. BRANDED: items with a non-empty brand get a small boost — they sit
 *      below clean ingredients but above unbranded noise.
 *   4. NAME_MATCH: a small tiebreaker within tiers based on how well the
 *      name matches the query (exact > startsWith > word-boundary > substring),
 *      with shorter names slightly preferred.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface RankableFood {
  id: string;
  name: string;
  brand: string;
  dataType?: string; // "Foundation" | "SR Legacy" | "Branded" (USDA)
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fats_per_100g: number;
  serving_size?: string;
  serving_grams?: number | null;
}

export interface HistoryEntry {
  key: string; // normalized "name|brand"
  name: string;
  brand: string;
  foodId?: string;
  logCount: number;
  lastUsedAt: number;
}

// ── Tier weights ───────────────────────────────────────────────────────────
// Spread so each tier dominates the one below it even at its weakest. A
// max-history item (~1000) outweighs any clean ingredient (~200 max), which
// outweighs any branded item (40), which outweighs any name-match (≤12).

/** Per-log-count history boost. logCount is capped at 10 → up to 1000. */
const HISTORY_PER_LOG = 100;
/** Cap applied to logCount so a single heavily-logged item can't run away. */
const HISTORY_LOG_CAP = 10;
/** Multiplier for a looser brand-insensitive history name match. */
const HISTORY_LOOSE_FACTOR = 0.6;

/** Base boost for a clean USDA whole-food ingredient (Foundation / SR Legacy). */
const CLEAN_INGREDIENT_BASE = 200;
/** Penalty per comma in the name (qualifier noise). */
const NOISE_PER_COMMA = 18;
/** Penalty per character of name length beyond a short baseline. */
const NOISE_PER_CHAR = 0.6;
/** Names at/under this length incur no length penalty. */
const NOISE_LENGTH_BASELINE = 16;
/** Floor so even a very noisy clean ingredient keeps a little ingredient credit. */
const CLEAN_INGREDIENT_FLOOR = 20;

/** Small boost for branded items — below clean ingredients, above noise. */
const BRANDED_BOOST = 40;

// Name-match tiebreaker weights (all small relative to the tiers above).
const NAME_EXACT = 12;
const NAME_STARTS_WITH = 8;
const NAME_WORD_BOUNDARY = 5;
const NAME_SUBSTRING = 2;
/** Shorter names nudged slightly higher within a tier. */
const NAME_SHORTNESS_MAX = 2;
const NAME_SHORTNESS_REF_LEN = 60;

const CLEAN_DATA_TYPES = new Set(["Foundation", "SR Legacy"]);

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function historyKey(name: string, brand: string): string {
  return `${normalize(name)}|${normalize(brand)}`;
}

/** Count occurrences of `ch` in `s` without a regex. */
function countChar(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++;
  return n;
}

/**
 * Name-noise penalty: scales with commas (qualifier chains) and overall
 * length. A concise name like "Chicken breast, raw" is penalized far less
 * than a verbose "Chicken, broiler or fryers, breast, skinless, …, braised".
 */
function nameNoisePenalty(name: string): number {
  const commas = countChar(name, ",");
  const lengthOver = Math.max(0, name.length - NOISE_LENGTH_BASELINE);
  return commas * NOISE_PER_COMMA + lengthOver * NOISE_PER_CHAR;
}

/** Name-match quality vs query (exact > startsWith > word-boundary > substring). */
function nameMatchScore(name: string, query: string): number {
  const n = normalize(name);
  const q = normalize(query);

  let score = 0;
  if (q.length > 0) {
    if (n === q) {
      score += NAME_EXACT;
    } else if (n.startsWith(q)) {
      score += NAME_STARTS_WITH;
    } else {
      const idx = n.indexOf(q);
      if (idx >= 0) {
        const before = idx === 0 ? " " : n[idx - 1];
        const isWordBoundary = before === " " || before === "," || before === "(";
        score += isWordBoundary ? NAME_WORD_BOUNDARY : NAME_SUBSTRING;
      }
    }
  }

  // Shorter names slightly preferred (continuous, never negative).
  const shortness =
    NAME_SHORTNESS_MAX *
    Math.max(0, (NAME_SHORTNESS_REF_LEN - n.length) / NAME_SHORTNESS_REF_LEN);
  return score + shortness;
}

/**
 * History boost for a result. Returns the largest matching boost:
 *  - exact "name|brand" key match (full weight), or
 *  - looser brand-insensitive name match (reduced weight).
 * `byKey` and `byName` are prebuilt O(1) lookups (no per-result history scan).
 */
function historyBoost(
  food: RankableFood,
  byKey: Map<string, HistoryEntry>,
  byName: Map<string, HistoryEntry>,
): number {
  const cappedBoost = (e: HistoryEntry) =>
    Math.min(e.logCount, HISTORY_LOG_CAP) * HISTORY_PER_LOG;

  const exact = byKey.get(historyKey(food.name, food.brand));
  if (exact) return cappedBoost(exact);

  const loose = byName.get(normalize(food.name));
  if (loose) return cappedBoost(loose) * HISTORY_LOOSE_FACTOR;

  return 0;
}

/** Full composite score for one result. Deterministic; no Date.now/random. */
function scoreFood(
  food: RankableFood,
  query: string,
  byKey: Map<string, HistoryEntry>,
  byName: Map<string, HistoryEntry>,
): number {
  let score = historyBoost(food, byKey, byName);

  if (food.dataType && CLEAN_DATA_TYPES.has(food.dataType)) {
    const clean = CLEAN_INGREDIENT_BASE - nameNoisePenalty(food.name);
    score += Math.max(CLEAN_INGREDIENT_FLOOR, clean);
  }

  if (food.brand.trim().length > 0) {
    score += BRANDED_BOOST;
  }

  score += nameMatchScore(food.name, query);
  return score;
}

/**
 * Stable-sort a copy of `results` by descending composite score.
 *
 * History dominates; clean whole-food ingredients beat branded items, which
 * beat unbranded noise; name-match quality breaks ties within a tier. Equal
 * scores preserve original USDA order (the array's incoming order).
 */
export function rankFoods<T extends RankableFood>(
  results: T[],
  query: string,
  history: HistoryEntry[],
): T[] {
  // Build O(1) history lookups once.
  const byKey = new Map<string, HistoryEntry>();
  const byName = new Map<string, HistoryEntry>();
  for (const entry of history) {
    const key = entry.key || historyKey(entry.name, entry.brand);
    const existingKey = byKey.get(key);
    if (!existingKey || entry.logCount > existingKey.logCount) {
      byKey.set(key, entry);
    }
    const nameNorm = normalize(entry.name);
    const existingName = byName.get(nameNorm);
    if (!existingName || entry.logCount > existingName.logCount) {
      byName.set(nameNorm, entry);
    }
  }

  // Decorate with score + original index for a stable, deterministic sort.
  const decorated = results.map((food, index) => ({
    food,
    index,
    score: scoreFood(food, query, byKey, byName),
  }));

  decorated.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index; // stable: preserve original order on ties
  });

  return decorated.map((d) => d.food);
}
