import type { SubScore, SubScoreKey, ScoringPhase } from "./types";

/**
 * The six canonical FightForm sub-scores. Used to decide which pillars are
 * "inactive" — a key is inactive when it's present with weight 0 OR missing
 * from `subScores` entirely (not logged / excluded this phase).
 */
const CANONICAL_KEYS: readonly SubScoreKey[] = [
  "trainingLoad",
  "sleep",
  "weightCut",
  "wellness",
  "nutritionAdherence",
  "recovery",
];

export interface PillarContribution {
  key: SubScoreKey;
  value: number; // 0-100 pillar score
  weight: number; // raw phase weight on this sub-score
  effectiveWeightPct: number; // weight / Σ(active weights) × 100, rounded to integer
  contributionPts: number; // value × weight / Σ(active weights), rounded to 1 decimal
}

export interface ContributionBreakdown {
  pillars: PillarContribution[]; // ONLY active (weight > 0), sorted by contributionPts DESC
  inactive: SubScoreKey[]; // keys with weight 0 / missing (not logged or excluded this phase)
  rawScore: number; // round(Σ contributionPts) — equals the engine's raw composite
  totalActiveWeight: number; // Σ weight of active pillars
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Decompose a FightForm composite into per-pillar contributions.
 *
 * The engine computes its raw composite as
 *   rawScore = Σ(value × weight) / Σ(active weight)   (see compose.ts)
 * This module surfaces each pillar's share of that figure. By construction the
 * returned `contributionPts` sum to the same `rawScore`, so the breakdown is an
 * exact decomposition of the engine's number.
 *
 * Pure + deterministic: no `Date`, no randomness. `phase` is accepted for
 * caller convenience — the weights on `subScores` already encode the phase, so
 * it is not used in the math, but the param is kept so callers can pass it.
 *
 * @param subScores  the engine's per-pillar sub-scores (value + weight)
 * @param phase      accepted but unused — weights already encode the phase
 */
export function computeContributions(
  subScores: Record<string, SubScore> | null | undefined,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  phase?: ScoringPhase | string | null,
): ContributionBreakdown {
  const entries = subScores ?? {};

  // Active pillars = present with weight > 0.
  const active: Array<{ key: SubScoreKey; value: number; weight: number }> = [];
  for (const key of CANONICAL_KEYS) {
    const sub = entries[key];
    if (sub && sub.weight > 0) {
      active.push({ key, value: sub.value, weight: sub.weight });
    }
  }
  // Include any non-canonical keys present with weight > 0 (defensive — keeps
  // the decomposition exact even if the engine adds a pillar we don't know).
  for (const key of Object.keys(entries)) {
    if ((CANONICAL_KEYS as readonly string[]).includes(key)) continue;
    const sub = entries[key];
    if (sub && sub.weight > 0) {
      active.push({ key: key as SubScoreKey, value: sub.value, weight: sub.weight });
    }
  }

  // Inactive = canonical keys that are missing OR present with weight <= 0.
  const inactive: SubScoreKey[] = CANONICAL_KEYS.filter((key) => {
    const sub = entries[key];
    return !sub || !(sub.weight > 0);
  });

  const totalActiveWeight = active.reduce((sum, p) => sum + p.weight, 0);

  // No active pillars → zero shape (never divide by zero).
  if (active.length === 0 || totalActiveWeight <= 0) {
    return { pillars: [], inactive, rawScore: 0, totalActiveWeight: 0 };
  }

  const pillars: PillarContribution[] = active.map((p) => ({
    key: p.key,
    value: p.value,
    weight: p.weight,
    effectiveWeightPct: Math.round((p.weight / totalActiveWeight) * 100),
    contributionPts: round1((p.value * p.weight) / totalActiveWeight),
  }));

  // Sort by contributionPts DESC; stable tie-break on key alphabetical so the
  // ordering is fully deterministic regardless of input order.
  pillars.sort((a, b) => {
    if (b.contributionPts !== a.contributionPts) {
      return b.contributionPts - a.contributionPts;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const rawScore = Math.round(
    pillars.reduce((sum, p) => sum + p.contributionPts, 0),
  );

  return { pillars, inactive, rawScore, totalActiveWeight };
}
