/**
 * Pure aggregation helpers for the Apple Health pipeline. Kept free of
 * any Convex `ctx` so they can be unit-tested without a runtime. The
 * Convex actions in `convex/health.ts` orchestrate fetch / call / write
 * and delegate the math here.
 */
import type { Doc } from "../../_generated/dataModel";
import { sourcePriority } from "./constants";

// ───────────────────────────────────────────────────────────────────────
// Basic stats
// ───────────────────────────────────────────────────────────────────────

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function stdDev(xs: number[], xMean: number): number {
  if (xs.length < 2) return 0;
  let sq = 0;
  for (const x of xs) sq += (x - xMean) * (x - xMean);
  return Math.sqrt(sq / (xs.length - 1));
}

/** UTC YYYY-MM-DD from an epoch-ms timestamp. We store dates in UTC to
 *  keep cross-timezone roll-ups deterministic; spec §10.9 accepts a minor
 *  double-bucket for travelling users and relies on the daily re-rollup
 *  to reconcile. */
export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ───────────────────────────────────────────────────────────────────────
// Source-priority dedup + summary aggregation
// ───────────────────────────────────────────────────────────────────────

/**
 * Folds raw `health_samples` rows into a daily summary. Exported as a
 * pure function so it can be unit-tested without a Convex context.
 *
 * For each metric we apply the source-priority rule (spec §10.6): keep
 * samples from the highest-priority device that contributed *any* sample
 * for that metric, and ignore lower-priority sources. Within that bucket
 * we then average (for instantaneous metrics) or sum (for cumulative
 * metrics like sleep minutes / steps / active energy).
 */
export function aggregateSamplesIntoSummary(
  samples: ReadonlyArray<Doc<"health_samples">>,
): {
  hrvAvgMs?: number;
  restingHrBpm?: number;
  sleepMinutes?: number;
  sleepDeepMinutes?: number;
  sleepRemMinutes?: number;
  sleepEfficiencyPct?: number;
  workoutMinutes?: number;
  activeEnergyKcal?: number;
  stepCount?: number;
  vo2Max?: number;
  respiratoryRateAvg?: number;
  wristTempDeltaC?: number;
  bodyMassKg?: number;
  sourcesPresent: string[];
} {
  const byMetric = new Map<string, Doc<"health_samples">[]>();
  const sources = new Set<string>();
  for (const s of samples) {
    if (s.device) sources.add(s.device);
    const arr = byMetric.get(s.metric) ?? [];
    arr.push(s);
    byMetric.set(s.metric, arr);
  }

  /** Keep only the samples from the highest-priority source represented
   *  in `arr`. */
  const pickTopSource = (
    arr: Doc<"health_samples">[],
  ): Doc<"health_samples">[] => {
    if (arr.length === 0) return arr;
    let topPriority = -1;
    for (const s of arr) {
      const p = sourcePriority(s.device);
      if (p > topPriority) topPriority = p;
    }
    return arr.filter((s) => sourcePriority(s.device) === topPriority);
  };

  const avg = (metric: string): number | undefined => {
    const arr = pickTopSource(byMetric.get(metric) ?? []);
    if (arr.length === 0) return undefined;
    return mean(arr.map((s) => s.value));
  };
  const sum = (metric: string): number | undefined => {
    const arr = pickTopSource(byMetric.get(metric) ?? []);
    if (arr.length === 0) return undefined;
    let s = 0;
    for (const x of arr) s += x.value;
    return s;
  };
  const last = (metric: string): number | undefined => {
    const arr = pickTopSource(byMetric.get(metric) ?? []);
    if (arr.length === 0) return undefined;
    // Most-recent sample wins for "snapshot" metrics like body mass.
    arr.sort((a, b) => b.endedAt - a.endedAt);
    return arr[0].value;
  };

  const sleepMinutes = sum("sleep_total");
  const sleepDeep = sum("sleep_deep");
  const sleepRem = sum("sleep_rem");
  // Spec §7.2 uses (deep + rem) / total for the sleep-quality component;
  // surface that ratio as a single 0–100 efficiency value too so the UI
  // doesn't have to recompute it.
  let sleepEfficiencyPct: number | undefined;
  if (
    sleepMinutes &&
    sleepMinutes > 0 &&
    (sleepDeep ?? 0) + (sleepRem ?? 0) > 0
  ) {
    sleepEfficiencyPct = Math.min(
      100,
      (((sleepDeep ?? 0) + (sleepRem ?? 0)) / sleepMinutes) * 100,
    );
  }

  return {
    hrvAvgMs: avg("hrv_sdnn"),
    restingHrBpm: avg("resting_hr"),
    sleepMinutes,
    sleepDeepMinutes: sleepDeep,
    sleepRemMinutes: sleepRem,
    sleepEfficiencyPct,
    workoutMinutes: sum("workout_minutes"),
    activeEnergyKcal: sum("active_energy_kcal"),
    stepCount: sum("steps"),
    vo2Max: avg("vo2_max"),
    respiratoryRateAvg: avg("respiratory_rate"),
    wristTempDeltaC: avg("wrist_temp_delta"),
    bodyMassKg: last("body_mass_kg"),
    sourcesPresent: Array.from(sources),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Baseline / tier helpers
// ───────────────────────────────────────────────────────────────────────

/** Maps the canonical `metric` key to the field on
 *  `daily_health_summary` that holds its daily value. Returns null for
 *  metrics we don't currently baseline. */
export function summaryFieldForMetric(
  metric: string,
): keyof Doc<"daily_health_summary"> | null {
  switch (metric) {
    case "hrv_sdnn":
      return "hrvAvgMs";
    case "resting_hr":
      return "restingHrBpm";
    case "sleep_total":
      return "sleepMinutes";
    case "respiratory_rate":
      return "respiratoryRateAvg";
    default:
      return null;
  }
}

/** Tier classification (spec §6). */
export function classifyTier(
  summaries: ReadonlyArray<Doc<"daily_health_summary">>,
): "tier_0" | "tier_1" | "tier_2" {
  let hrvDays = 0;
  let sleepDays = 0;
  let workoutDays = 0;
  for (const s of summaries) {
    if (s.hrvAvgMs != null) hrvDays++;
    if (s.sleepMinutes != null) sleepDays++;
    if (s.workoutMinutes != null && s.workoutMinutes > 0) workoutDays++;
  }
  if (hrvDays >= 7) return "tier_2";
  if (sleepDays >= 7 || workoutDays >= 7) return "tier_1";
  return "tier_0";
}
