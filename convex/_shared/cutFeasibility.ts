/**
 * Cut-plan feasibility — the single source of truth for "can this weight cut
 * physically be done safely in the time available?".
 *
 * Pure module: no Convex / React imports beyond the shared weigh-in math, so it
 * is safe to import from BOTH the Convex server (generateCutPlan backstop) and
 * the React client (pre-flight guard). The client already imports other helpers
 * from `convex/_shared`, so this colocation is intentional.
 *
 * The ceiling is FAT loss measured BEFORE any carb reduction / dehydration —
 * i.e. current weight -> pre-dehydration walk-around target. The fight-week
 * water cut is a separate, short-term manipulation and is NOT counted here.
 */
import { resolveWeighInIso } from "./weighInTiming";

/** Hard "impossible to safely make weight" ceiling: 2.5% of current bodyweight
 *  of FAT loss per week, measured BEFORE any carb reduction / dehydration
 *  (i.e. current weight -> pre-dehydration walk-around target). The water cut
 *  in fight week is separate and not counted here. */
export const MAX_WEEKLY_BW_FRACTION = 0.025;

export interface CutFeasibilityInput {
  currentWeightKg: number;
  /** fightWeekTargetKg (pre-dehydration walk-around) ?? goalWeight. */
  preDehydrationTargetKg: number;
  /** Whole weeks available to weigh-in; same value generateCutPlan uses. */
  weeksAvailable: number;
}

export interface CutFeasibilityResult {
  feasible: boolean;
  fatLossKg: number; // max(0, current - target)
  perWeekKg: number; // required fat loss per week
  maxPerWeekKg: number; // 0.025 * currentWeightKg
  minWeeksNeeded: number; // ceil(fatLossKg / maxPerWeekKg), >=1; 0 when no fat to lose
}

/**
 * Assess whether the pre-dehydration fat loss required to reach the target can
 * be done within the available weeks at or under 2.5% bodyweight/week.
 *
 * Maintenance / rehydration (target at or above current weight, or a degenerate
 * non-positive current weight) is NEVER blocked.
 */
export function assessCutFeasibility(
  input: CutFeasibilityInput,
): CutFeasibilityResult {
  const { currentWeightKg, preDehydrationTargetKg, weeksAvailable } = input;
  const fatLossKg = Math.max(0, currentWeightKg - preDehydrationTargetKg);
  const maxPerWeekKg = MAX_WEEKLY_BW_FRACTION * currentWeightKg;

  // Nothing to lose (at/under goal) or degenerate weight → always feasible.
  if (fatLossKg <= 0 || currentWeightKg <= 0) {
    return {
      feasible: true,
      fatLossKg,
      perWeekKg: 0,
      maxPerWeekKg,
      minWeeksNeeded: 0,
    };
  }

  const perWeekKg = fatLossKg / Math.max(1, weeksAvailable);
  // Epsilon so a borderline exactly-at-limit cut (e.g. 2.0 kg/wk at 80 kg)
  // passes rather than failing on a float rounding hair.
  const feasible = perWeekKg <= maxPerWeekKg + 1e-9;
  const minWeeksNeeded = Math.max(1, Math.ceil(fatLossKg / maxPerWeekKg));

  return { feasible, fatLossKg, perWeekKg, maxPerWeekKg, minWeeksNeeded };
}

/**
 * Whole weeks from now to the weigh-in date, matching generateCutPlan exactly:
 *   days  = ceil((weighInIso - now) / 86400000), floored at 1
 *   weeks = clamp(ceil(days / 7), 1, 20)
 *
 * `weighInIso` is derived from the fight date + weigh-in timing via the shared
 * resolveWeighInIso (day_before = fight − 1, same_day = fight). Pass `nowMs`
 * for deterministic tests; defaults to Date.now().
 */
export function weeksToWeighIn(
  fightDateIso: string,
  weighInTiming: string | undefined,
  nowMs?: number,
): number {
  const now = nowMs ?? Date.now();
  const weighInIso = resolveWeighInIso(fightDateIso, weighInTiming);
  const days = Math.max(
    1,
    Math.ceil((new Date(weighInIso).getTime() - now) / 86400000),
  );
  return Math.max(1, Math.min(20, Math.ceil(days / 7)));
}
