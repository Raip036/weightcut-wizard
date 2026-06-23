import type { ScoringInputs, SubScoreKey } from "./types";

/** Whole UTC days from `from` to `to` (both ISO YYYY-MM-DD). Negative if to < from. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

function maxDate(dates: string[]): string | null {
  let best: string | null = null;
  for (const d of dates) if (best === null || d > best) best = d;
  return best;
}

/** Most recent log date per pillar (null when the pillar has no data). */
export function lastLogDates(inputs: ScoringInputs): Record<SubScoreKey, string | null> {
  const skipsFor = (key: SubScoreKey): string[] =>
    (inputs.markedSkips ?? []).filter((s) => s.pillar === key).map((s) => s.date);
  return {
    trainingLoad: maxDate([
      ...inputs.sessions.map((s) => s.date),
      ...((inputs.restDays ?? []) as string[]),
      ...skipsFor("trainingLoad"),
    ]),
    sleep: maxDate([...inputs.sleepHours.map((s) => s.date), ...skipsFor("sleep")]),
    weightCut: maxDate([...inputs.weights.map((w) => w.date), ...skipsFor("weightCut")]),
    wellness: maxDate([...inputs.hooperByDate.map((h) => h.date), ...skipsFor("wellness")]),
    nutritionAdherence: maxDate([...inputs.meals.map((m) => m.date), ...skipsFor("nutritionAdherence")]),
  };
}

/**
 * Most recent REAL log date per pillar, excluding markedSkips. Used by
 * compose.ts to determine the `asOf` date when computing a windowed
 * sub-score — skips pause staleness but don't move the sub-score window.
 */
export function lastRealLogDates(inputs: ScoringInputs): Record<SubScoreKey, string | null> {
  return {
    trainingLoad: maxDate([
      ...inputs.sessions.map((s) => s.date),
      ...((inputs.restDays ?? []) as string[]),
    ]),
    sleep: maxDate(inputs.sleepHours.map((s) => s.date)),
    weightCut: maxDate(inputs.weights.map((w) => w.date)),
    wellness: maxDate(inputs.hooperByDate.map((h) => h.date)),
    nutritionAdherence: maxDate(inputs.meals.map((m) => m.date)),
  };
}

/** Days since the pillar's last log relative to the as-of date; null if never. */
export function staleDaysFor(lastDate: string | null, asOfDate: string): number | null {
  if (lastDate === null) return null;
  return Math.max(0, daysBetween(lastDate, asOfDate));
}

/**
 * Decay fraction toward neutral for a stale pillar. 0 within grace, ramps
 * linearly to `dMax` at `horizonDays`, capped at `dMax`.
 */
export function decayFactor(
  staleDays: number,
  cfg: { graceDays: number; horizonDays: number; dMax: number },
): number {
  if (staleDays <= cfg.graceDays) return 0;
  const span = Math.max(1, cfg.horizonDays - cfg.graceDays);
  const raw = (staleDays - cfg.graceDays) / span;
  return Math.min(cfg.dMax, Math.max(0, raw));
}
