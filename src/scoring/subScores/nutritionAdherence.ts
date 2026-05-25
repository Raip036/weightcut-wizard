import type { ScoringConfig, SubScore } from "../types";

/**
 * Nutrition adherence — calorie-only soft-falloff scoring.
 *
 * Why the rewrite (v2 — 2026-05-25):
 *  - v1 punished tracking precision. A fighter logging meals 7 days a
 *    week could still bottom out at 5/100 because the ±10% calorie
 *    window is sniper precision and the per-day protein penalty
 *    (5 pts × N days) stacked without a cap.
 *  - Real-world food logs carry ~10% measurement noise on their own
 *    (USDA database variance). Demanding ±10% is asking the user to
 *    out-precision their own data.
 *  - Protein logging is the noisiest macro of all (portion sizes,
 *    cooking shrinkage, multi-ingredient meals). Folding it into a
 *    hard penalty produced large day-to-day swings in the sub-score
 *    that didn't reflect any real-world change in adherence.
 *
 * v2 contract:
 *  - Only calorie hit-rate drives the score. Protein is no longer
 *    counted — the noise/signal ratio was too poor.
 *  - Soft falloff: drift ≤10% → 100, 20% → 75, 30% → 40, 40% → 0.
 *    Smooth gradient, no cliff edge.
 *  - Days with < 30% of target kcal logged are treated as "incomplete
 *    logging" and SKIPPED — the user clearly forgot meals, not
 *    starved. Stops the algorithm from punishing forgetful logging.
 *  - Unlogged days are skipped silently (unchanged from v1).
 *  - Still requires 3+ valid logged days to count toward the composite
 *    (weight:0 fall-through, same redistribution pattern as the other
 *    sub-scores).
 *
 * Config fields read from `cfg.nutrition`:
 *  - `calorieFullCreditFraction` — drift below this earns 100 pts.
 *  - `calorieZeroCreditFraction` — drift at/above this earns 0 pts.
 *    The score interpolates linearly through 0.5× and 0.25× of the
 *    distance for a soft falloff.
 *  - `minLoggedKcalFraction` — minimum logged kcal / target kcal to
 *    consider a day "valid logging" rather than "incomplete log".
 *
 * Legacy config fields (`calorieToleranceFraction`,
 * `proteinShortfallThresholdPct`, `proteinPenaltyPerDay`) are left in
 * the type for backward compatibility but no longer read here.
 */
export function computeNutritionAdherence(
  meals: Array<{ date: string; calories: number; proteinG: number }>,
  targets: { calories: number | null; proteinG: number | null },
  asOfDate: string,
  cfg: ScoringConfig,
): SubScore {
  if (!targets.calories) {
    return { value: 50, weight: 0, reason: "No calorie target configured" };
  }
  const end = new Date(asOfDate + "T00:00:00Z");
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);

  const byDay = new Map<string, number>();
  for (const m of meals) {
    const t = new Date(m.date + "T00:00:00Z").getTime();
    if (t < start.getTime() || t > end.getTime()) continue;
    byDay.set(m.date, (byDay.get(m.date) ?? 0) + m.calories);
  }

  const target = targets.calories;
  const minLoggedFraction = cfg.nutrition.minLoggedKcalFraction ?? 0.30;
  const fullCredit = cfg.nutrition.calorieFullCreditFraction ?? 0.10;
  const zeroCredit = cfg.nutrition.calorieZeroCreditFraction ?? 0.40;

  let validDays = 0;
  let dayScoreTotal = 0;
  let incompleteDays = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const kcal = byDay.get(key);
    // Day with no log at all — skip silently. The user forgot to open
    // the app; we don't model that as starvation.
    if (kcal === undefined) continue;
    // Day with a clearly partial log (e.g. one coffee logged, 90 kcal
    // on a 2500 target). Surface in `reason` so the user can see why
    // the day didn't count, but don't penalise — they ate, they just
    // didn't finish logging.
    if (kcal < target * minLoggedFraction) {
      incompleteDays++;
      continue;
    }
    validDays++;
    dayScoreTotal += calorieDayScore(kcal, target, fullCredit, zeroCredit);
  }

  if (validDays < 3) {
    return {
      value: 50,
      weight: 0,
      reason: incompleteDays > 0
        ? `Only ${validDays} fully-logged day(s) in last 7 (${incompleteDays} partial) — need 3+`
        : `Only ${validDays} day(s) of meals logged in last 7 — need 3+`,
    };
  }

  const value = Math.round(dayScoreTotal / validDays);
  return {
    value,
    weight: 0,
    reason: incompleteDays > 0
      ? `${validDays} day(s) on calorie target; ${incompleteDays} partial log(s) skipped`
      : `${validDays}/${validDays} days fully logged — calorie adherence ${value}%`,
  };
}

/**
 * Per-day calorie score with soft falloff.
 *
 *   drift ≤ fullCredit              → 100
 *   fullCredit < drift ≤ 2×full     → linear 100 → 75
 *   2×full     < drift ≤ 3×full     → linear  75 → 40
 *   3×full     < drift ≤ zeroCredit → linear  40 →  0
 *   drift > zeroCredit              → 0
 *
 * With defaults (full=0.10, zero=0.40) this maps to the user-chosen
 * curve: ±10% = 100, ±20% = 75, ±30% = 40, ±40%+ = 0.
 */
function calorieDayScore(
  kcal: number,
  target: number,
  fullCredit: number,
  zeroCredit: number,
): number {
  const drift = Math.abs(kcal - target) / target;
  if (drift <= fullCredit) return 100;
  const t1 = fullCredit;
  const t2 = fullCredit * 2;
  const t3 = fullCredit * 3;
  const t4 = zeroCredit;
  if (drift <= t2) return lerp(drift, t1, t2, 100, 75);
  if (drift <= t3) return lerp(drift, t2, t3, 75, 40);
  if (drift <= t4) return lerp(drift, t3, t4, 40, 0);
  return 0;
}

function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0;
  const t = (x - x0) / (x1 - x0);
  return y0 + (y1 - y0) * t;
}
