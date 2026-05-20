/**
 * Apple HealthKit integration — shared constants. Pulled out of
 * `convex/health.ts` so the registry stays under one source-of-truth and
 * the main module file stays under the 500-line cap.
 */

/**
 * Canonical metric keys we ingest from HealthKit. Kept in sync with the
 * `HealthMetric` type that Agent A exposes from `src/services/healthKit.ts`.
 * Anything not in this set is rejected by `insertSamples` so a typo in
 * the client can't silently fill the table with bogus rows.
 */
export const KNOWN_METRICS = new Set<string>([
  "hrv_sdnn",
  "resting_hr",
  "sleep_total",
  "sleep_deep",
  "sleep_rem",
  "sleep_core",
  "workout_minutes",
  "active_energy_kcal",
  "steps",
  "vo2_max",
  "respiratory_rate",
  "wrist_temp_delta",
  "body_mass_kg",
]);

/**
 * Metrics we maintain rolling baselines for. Limited to the ones the
 * recovery sub-score (spec §7.1) actually consumes — adding more here is
 * free, but extra baseline rows have no consumer today.
 */
export const BASELINE_METRICS = [
  "hrv_sdnn",
  "resting_hr",
  "sleep_total",
  "respiratory_rate",
] as const;

/**
 * Source priority for duplicate-source dedup (spec §10.6). Higher number
 * wins when the same metric/date has samples from multiple devices.
 */
export const SOURCE_PRIORITY: Record<string, number> = {
  "Apple Watch": 4,
  Whoop: 3,
  Oura: 2,
  generic: 1,
};

/** Loose substring match — HealthKit device strings vary
 *  ("Apple Watch Series 8", "WHOOP 4.0", "Oura Ring Gen3"). */
export function sourcePriority(device: string | undefined): number {
  if (!device) return SOURCE_PRIORITY.generic;
  if (/apple\s*watch/i.test(device)) return SOURCE_PRIORITY["Apple Watch"];
  if (/whoop/i.test(device)) return SOURCE_PRIORITY.Whoop;
  if (/oura/i.test(device)) return SOURCE_PRIORITY.Oura;
  return SOURCE_PRIORITY.generic;
}
