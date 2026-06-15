/**
 * Single source of truth for "which plan week is it, and what is THIS week's
 * target weight" — shared by the Fight Form Score's `weightCut` sub-score
 * (`src/scoring/subScores/weightCut.ts`, runs under both `src/` and `convex/`)
 * and the dashboard Camp Status widget (`CutPaceForecast.tsx`).
 *
 * Before this module the two computed the current week off DIFFERENT anchors
 * (the score off the earliest weight-log date, the widget off
 * `fightDate − totalWeeks×7`), so they could land on different `weeklyPlan`
 * rows and disagree on the target weight. Routing both through here keeps the
 * weekly target uniform across the app.
 *
 * All math is whole-day UTC arithmetic on `YYYY-MM-DD` strings. Because we only
 * ever add/subtract whole days, the calendar date is invariant to the viewer's
 * timezone — the resolver and the widget agree regardless of locale.
 */

const MS_PER_DAY = 86_400_000;

/** Shape of one `cutPlanJson.weeklyPlan` row. Only `week` + `targetWeight`
 *  are required here; callers carry the rest (phase, dailyFocus, …). */
export interface PlanWeekRow {
  week: number;
  targetWeight: number;
  [k: string]: unknown;
}

function utcDate(iso: string): Date {
  return new Date(iso.slice(0, 10) + "T00:00:00Z");
}

function isoFromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days from `a` to `b` (positive when `b` is later). */
export function daysBetweenIso(a: string, b: string): number {
  return Math.round((utcDate(b).getTime() - utcDate(a).getTime()) / MS_PER_DAY);
}

/** `iso` shifted by `days` (UTC, whole days). */
export function isoShift(iso: string, days: number): string {
  return isoFromUtc(new Date(utcDate(iso).getTime() + days * MS_PER_DAY));
}

/**
 * The camp's day-zero anchor: `fightDate − totalWeeks×7 days`. This is the
 * single definition both the score and the Camp Status widget build their
 * week windows from.
 */
export function planStartIso(fightDateIso: string, totalWeeks: number): string {
  return isoShift(fightDateIso, -totalWeeks * 7);
}

/** Resolve `totalWeeks` with the widget's precedence: explicit `totalWeeks`
 *  first, else the plan length. Returns 0 when neither is usable. */
export function resolveTotalWeeks(
  weeklyPlan: PlanWeekRow[] | null | undefined,
  totalWeeks?: number | null,
): number {
  if (typeof totalWeeks === "number" && totalWeeks > 0) return totalWeeks;
  return Array.isArray(weeklyPlan) ? weeklyPlan.length : 0;
}

export interface ResolvedPlanWeek {
  /** 1-indexed plan week, clamped to [1, totalWeeks]. */
  week: number;
  /** This week's plan target (kg), or null if the plan has no matching row. */
  targetWeight: number | null;
  weekStartIso: string;
  weekEndIso: string;
  planStartIso: string;
  totalWeeks: number;
}

/**
 * Resolve the plan week containing `asOfDate` and that week's target weight.
 *
 * `week = floor(daysBetween(planStart, asOfDate) / 7) + 1`, clamped to the
 * plan's bounds — identical to the per-week window test the Camp Status widget
 * uses (`asOfDate ∈ [weekStart, weekEnd]`). Returns `null` when the fight date
 * or total-weeks count is missing/unusable.
 */
export function resolvePlanWeek(params: {
  asOfDate: string;
  fightDate: string | null | undefined;
  weeklyPlan: PlanWeekRow[] | null | undefined;
  totalWeeks?: number | null;
}): ResolvedPlanWeek | null {
  const { asOfDate, fightDate, weeklyPlan } = params;
  if (!fightDate) return null;
  const totalWeeks = resolveTotalWeeks(weeklyPlan, params.totalWeeks);
  if (totalWeeks <= 0) return null;

  const startIso = planStartIso(fightDate, totalWeeks);
  const rawWeek = Math.floor(daysBetweenIso(startIso, asOfDate) / 7) + 1;
  const week = Math.max(1, Math.min(totalWeeks, rawWeek));

  let targetWeight: number | null = null;
  if (Array.isArray(weeklyPlan)) {
    const row = weeklyPlan.find((w) => w.week === week);
    if (row && typeof row.targetWeight === "number" && Number.isFinite(row.targetWeight)) {
      targetWeight = row.targetWeight;
    }
  }

  return {
    week,
    targetWeight,
    weekStartIso: isoShift(startIso, (week - 1) * 7),
    weekEndIso: isoShift(startIso, week * 7 - 1),
    planStartIso: startIso,
    totalWeeks,
  };
}
