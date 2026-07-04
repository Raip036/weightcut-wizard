/**
 * Plan-aware cut pace — the SINGLE server-side source of truth for "is the
 * athlete on pace this week", shared by every AI-coach surface (chat facts,
 * cockpit header, briefing bubble, safety guardrail, athlete snapshot).
 *
 * Mirrors the dashboard Camp Status cards exactly:
 *  - this week's target = `resolvePlanWeek(...)` over `profiles.cutPlanJson`
 *    (`src/scoring/planWeek.ts`, the same helper `PhaseCoachCard` /
 *    `CutPaceForecast` use),
 *  - fight-date precedence = `plan.targetDate ?? profiles.targetDate ??
 *    camp.fightDate` (matches `PhaseCoachCard`'s `cutPlan.targetDate ??
 *    targetDateISO`),
 *  - on-plan band = ±0.5 kg (matches `DeltaPill.deltaVerdict`).
 *
 * Before this module the coach cluster judged pace off
 * `profiles.fightWeekTargetKg` + a glide path to the FIGHT date while the
 * dashboard judged it off the cut plan's weekly ladder — so the chat could
 * say "cut pace is high" while the card said "on plan". Callers with no
 * usable plan get `null` and fall back to their legacy math.
 */

import {
  resolvePlanWeek,
  type PlanWeekRow,
} from "../../src/scoring/planWeek";

/** On-plan band (kg) — MUST match `deltaVerdict` in
 *  `src/components/dashboard/DeltaPill.tsx` (|delta| ≤ 0.5 → "On plan"). */
export const ON_PLAN_BAND_KG = 0.5;

export type PaceVerdict = "on_plan" | "over_plan" | "under_plan";

export interface CutPaceInput {
  /** `profiles.cutPlanJson` (untyped JSON — validated here). */
  cutPlanJson: unknown;
  /** `profiles.targetDate` (the fight date the plan was generated for). */
  profileTargetDate?: string | null;
  /** Upcoming camp's fight date — last-resort anchor. */
  fightDate?: string | null;
  /** Latest known bodyweight (kg). */
  currentKg: number | null | undefined;
  /** "Today" as UTC YYYY-MM-DD. */
  asOfIso: string;
}

export interface CutPaceResult {
  planWeek: number;
  totalWeeks: number;
  /** THIS week's plan target (kg) — the number the dashboard grades against. */
  weeklyTargetKg: number;
  /** current − weeklyTarget, 1dp. Positive = over plan (behind on the cut). */
  driftKg: number;
  verdict: PaceVerdict;
  /** True when today falls on a fight-week (dehydration) plan row — weekly
   *  drift is less meaningful there; the fight-week protocol takes over. */
  isFightWeekRow: boolean;
  /** Loss the plan intends THIS week (kg), when derivable from adjacent rows. */
  intendedThisWeekLossKg: number | null;
  /** The fight-date anchor actually used (post-precedence). */
  fightDateIso: string;
}

/** Defensive row validation — cutPlanJson is schemaless (`v.any()`). */
function parseWeeklyPlan(raw: unknown): (PlanWeekRow & { phase?: string })[] | null {
  if (!raw || typeof raw !== "object") return null;
  const weekly = (raw as { weeklyPlan?: unknown }).weeklyPlan;
  if (!Array.isArray(weekly)) return null;
  const rows = weekly.filter(
    (r): r is PlanWeekRow & { phase?: string } =>
      !!r &&
      typeof r === "object" &&
      typeof (r as PlanWeekRow).week === "number" &&
      typeof (r as PlanWeekRow).targetWeight === "number" &&
      Number.isFinite((r as PlanWeekRow).targetWeight),
  );
  return rows.length > 0 ? rows : null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Resolve the plan-aware pace read, or `null` when there is no usable plan /
 * anchor / current weight (callers fall back to legacy glide-path math).
 */
export function resolveCutPace(input: CutPaceInput): CutPaceResult | null {
  const current = input.currentKg;
  if (typeof current !== "number" || !Number.isFinite(current) || current <= 0) {
    return null;
  }
  const plan = input.cutPlanJson as
    | { targetDate?: unknown; totalWeeks?: unknown; currentWeight?: unknown }
    | null
    | undefined;
  const weeklyPlan = parseWeeklyPlan(input.cutPlanJson);
  if (!weeklyPlan) return null;

  const planTargetDate =
    plan && typeof plan.targetDate === "string" ? plan.targetDate : null;
  const fightDateIso =
    planTargetDate ?? input.profileTargetDate ?? input.fightDate ?? null;
  if (!fightDateIso) return null;

  const resolved = resolvePlanWeek({
    asOfDate: input.asOfIso,
    fightDate: fightDateIso,
    weeklyPlan,
    totalWeeks:
      plan && typeof plan.totalWeeks === "number" ? plan.totalWeeks : null,
  });
  if (!resolved || resolved.targetWeight == null) return null;

  const row = weeklyPlan.find((w) => w.week === resolved.week);
  const driftKg = round1(current - resolved.targetWeight);
  const verdict: PaceVerdict =
    Math.abs(driftKg) <= ON_PLAN_BAND_KG
      ? "on_plan"
      : driftKg > 0
        ? "over_plan"
        : "under_plan";

  // Intended loss this week: previous row's target (or the plan's recorded
  // starting weight for week 1) minus this week's target.
  let intendedThisWeekLossKg: number | null = null;
  const prevTarget =
    resolved.week > 1
      ? weeklyPlan.find((w) => w.week === resolved.week - 1)?.targetWeight
      : plan && typeof plan.currentWeight === "number"
        ? plan.currentWeight
        : undefined;
  if (typeof prevTarget === "number" && Number.isFinite(prevTarget)) {
    intendedThisWeekLossKg = round1(prevTarget - resolved.targetWeight);
  }

  return {
    planWeek: resolved.week,
    totalWeeks: resolved.totalWeeks,
    weeklyTargetKg: round1(resolved.targetWeight),
    driftKg,
    verdict,
    isFightWeekRow: row?.phase === "fight_week",
    intendedThisWeekLossKg,
    fightDateIso,
  };
}

/** Human wording for a verdict — matches the dashboard DeltaPill copy. */
export function paceVerdictLabel(result: CutPaceResult): string {
  if (result.verdict === "on_plan") return "on plan";
  const abs = Math.abs(result.driftKg).toFixed(1);
  return result.verdict === "over_plan"
    ? `${abs} kg over plan`
    : `${abs} kg under plan`;
}

/** The plan's intended loss rate this week as % bodyweight per week (the unit
 *  the safety guardrail thinks in), or null when not derivable. */
export function plannedRatePctPerWeek(
  result: CutPaceResult | null,
  currentKg: number | null | undefined,
): number | null {
  if (
    !result ||
    result.intendedThisWeekLossKg == null ||
    typeof currentKg !== "number" ||
    !(currentKg > 0)
  ) {
    return null;
  }
  return (
    Math.round((result.intendedThisWeekLossKg / currentKg) * 100 * 100) / 100
  );
}
