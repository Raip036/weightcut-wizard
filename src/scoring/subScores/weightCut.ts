import type { ScoringConfig, SubScore } from "../types";

/**
 * Shape of one row inside `profiles.cutPlanJson.weeklyPlan`. Mirrors the
 * `WeekRow` interface in `src/components/dashboard/CutPaceForecast.tsx` and
 * `src/components/onboarding/InlinePlanDisplay.tsx`. Re-declared locally
 * (rather than imported) so this scoring module stays free of UI imports
 * and runs under both `src/` and `convex/` build targets.
 */
type WeeklyPlanRow = {
  week: number;
  targetWeight: number;
  // Other fields exist (phase, dailyFocus, ...) but the score only needs
  // week + targetWeight; widen with `unknown` to tolerate plan-shape drift.
  [k: string]: unknown;
};

type CutPlanJson = {
  weeklyPlan?: WeeklyPlanRow[];
  totalWeeks?: number;
  [k: string]: unknown;
} | null | undefined;

type Input = {
  weights: Array<{ date: string; weightKg: number }>;
  startingWeightKg: number | null;
  goalWeightKg: number | null;
  campStartDate: string | null;
  fightDate: string | null;
  /**
   * Parsed `profiles.cutPlanJson` (kg, no lbs handling). When present, this
   * week's `targetWeight` is sourced from `weeklyPlan[currentWeek - 1]`.
   * When absent we fall back to a linear interp from camp start → goal.
   */
  cutPlanJson?: CutPlanJson;
};

function daysBetween(a: string, b: string): number {
  return (
    (new Date(b + "T00:00:00Z").getTime() -
      new Date(a + "T00:00:00Z").getTime()) /
    (1000 * 60 * 60 * 24)
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Weekly-plan adherence sub-score.
 *
 * Replaces the legacy rate-of-loss (%/wk) formula. Compares the user's
 * current (latest) weight to THIS WEEK'S `targetWeight` from the
 * AI-generated cut plan and grades the delta:
 *
 *   delta ∈ [-0.5, +0.3] kg → 100 (on plan)
 *   delta ∈ (+0.3, +1.5) kg → linear 100 → 0 (behind plan)
 *   delta ≥ +1.5 kg         → 0 (significant deviation)
 *   delta ∈ (-1.5, -0.5) kg → linear 100 → 0 (too aggressive)
 *   delta ≤ -1.5 kg         → 0 (cutting dangerously fast)
 *
 * The signed convention: positive delta = heavy/behind, negative = light/ahead.
 *
 * `cfg` is accepted for signature compatibility with the other sub-scores
 * but the formula is config-free — tolerances are hard-coded per spec.
 */
export function computeWeightCut(
  input: Input,
  asOfDate: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _cfg: ScoringConfig,
): SubScore {
  const {
    weights,
    startingWeightKg,
    goalWeightKg,
    campStartDate,
    fightDate,
    cutPlanJson,
  } = input;

  // 1. Resolve current weight (latest log).
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1] ?? null;
  const currentWeightKg = latest?.weightKg ?? null;

  // 2. Determine this week's target.
  //    `currentWeek` is 1-indexed weeks since camp start, clamped to the
  //    plan's total length so a delayed fight date doesn't blow the index
  //    past the last weeklyPlan row.
  let thisWeekTargetKg: number | null = null;
  let currentWeek: number | null = null;
  if (campStartDate) {
    // Total camp weeks: prefer the plan's own length, then camp→fight span,
    // then plan.totalWeeks. Falls back to 1 to avoid div-by-zero in the
    // linear-interp branch.
    const planLength = Array.isArray(cutPlanJson?.weeklyPlan)
      ? cutPlanJson!.weeklyPlan!.length
      : 0;
    const campToFightWeeks =
      fightDate != null
        ? Math.max(1, Math.ceil(daysBetween(campStartDate, fightDate) / 7))
        : 0;
    const totalCampWeeks =
      planLength > 0
        ? planLength
        : campToFightWeeks > 0
          ? campToFightWeeks
          : typeof cutPlanJson?.totalWeeks === "number"
            ? cutPlanJson!.totalWeeks!
            : 1;

    const weeksSinceCampStart = Math.floor(
      daysBetween(campStartDate, asOfDate) / 7,
    ) + 1;
    currentWeek = clamp(weeksSinceCampStart, 1, totalCampWeeks);

    // 2a. Try the explicit plan row first.
    if (Array.isArray(cutPlanJson?.weeklyPlan) && cutPlanJson!.weeklyPlan!.length > 0) {
      const row = cutPlanJson!.weeklyPlan!.find((w) => w.week === currentWeek);
      if (row && typeof row.targetWeight === "number" && Number.isFinite(row.targetWeight)) {
        thisWeekTargetKg = row.targetWeight;
      }
    }

    // 2b. Linear interp fallback: starting → goal, weighted by progress.
    if (
      thisWeekTargetKg == null &&
      startingWeightKg != null &&
      goalWeightKg != null &&
      totalCampWeeks > 0
    ) {
      const progress = currentWeek / totalCampWeeks;
      thisWeekTargetKg =
        startingWeightKg + (goalWeightKg - startingWeightKg) * progress;
    }
  }

  // 3. If still no target or no current weight, sit the sub-score out.
  if (thisWeekTargetKg == null || currentWeightKg == null) {
    return {
      value: 50,
      weight: 0,
      reason: "No cut plan or weight data yet — sub-score paused.",
      meta: { weekNumber: currentWeek ?? 1 },
    };
  }

  // 4. Score the delta.
  const delta = currentWeightKg - thisWeekTargetKg; // + = heavy/behind, - = light/ahead
  let score: number;
  let reason: string;

  if (delta >= -0.5 && delta <= 0.3) {
    score = 100;
    reason =
      delta >= 0
        ? `On target (${currentWeightKg.toFixed(1)} / ${thisWeekTargetKg.toFixed(1)} kg)`
        : `Slightly ahead of plan (${Math.abs(delta).toFixed(1)} kg under target)`;
  } else if (delta > 0.3 && delta < 1.5) {
    // Behind plan: linear from 100 (at +0.3) to 0 (at +1.5).
    score = 100 * (1 - (delta - 0.3) / 1.2);
    reason = `${delta.toFixed(1)} kg behind this week's ${thisWeekTargetKg.toFixed(1)} kg target`;
  } else if (delta >= 1.5) {
    score = 0;
    reason = `${delta.toFixed(1)} kg over this week's target — significant deviation`;
  } else if (delta < -0.5 && delta > -1.5) {
    // Ahead of plan (too aggressive): linear from 100 (at -0.5) to 0 (at -1.5).
    score = 100 * (1 - (Math.abs(delta) - 0.5) / 1.0);
    reason = `Cutting faster than plan (${Math.abs(delta).toFixed(1)} kg under) — risk of muscle loss`;
  } else {
    // delta <= -1.5
    score = 0;
    reason = `${Math.abs(delta).toFixed(1)} kg under target — cutting dangerously fast`;
  }

  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    value: Math.round(clamp(score, 0, 100)),
    weight: 1.0,
    reason,
    meta: {
      targetKg: round1(thisWeekTargetKg),
      currentKg: round1(currentWeightKg),
      deltaKg: round1(delta),
      weekNumber: currentWeek ?? 1,
    },
  };
}
