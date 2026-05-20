/**
 * Apple Health integration — shared types.
 *
 * These types are the hand-off contract between:
 *   - the native plugin wrapper (`healthKit.ts`)
 *   - the Convex backend ingestion mutation (`api.health.insertSamples`)
 *   - the score engine (`src/scoring`)
 *   - the UI surfaces (`src/components/health/*`)
 *
 * `RawSample` must remain stable — Convex `health_samples` schema mirrors it
 * 1:1 (see spec §5.1).
 */

/**
 * Canonical metric identifiers used throughout the app. They map onto
 * HealthKit sample types inside the plugin wrapper; renaming any of these is
 * a breaking change for downstream rollup / scoring code.
 */
export type HealthMetric =
  | "hrv_sdnn"
  | "resting_hr"
  | "sleep_total"
  | "sleep_deep"
  | "sleep_rem"
  | "sleep_core"
  | "workout_minutes"
  | "active_energy_kcal"
  | "steps"
  | "vo2_max"
  | "respiratory_rate"
  | "wrist_temp_delta"
  | "body_mass_kg"
  | "body_fat_pct";

/**
 * Tier classification — driven server-side by `health.reclassifyTier` after
 * each baseline refresh, but the type lives here so the UI can render badges
 * without importing the Convex API surface.
 */
export type Tier = "tier_0" | "tier_1" | "tier_2";

/**
 * Per-metric authorisation snapshot. HealthKit on iOS does NOT reveal whether
 * the user denied a read scope — `granted` is best-effort: it reflects what
 * the plugin reports plus our own empty-result heuristic.
 */
export interface AuthorizationStatus {
  metric: HealthMetric;
  granted: boolean;
  /** Plugin-reported raw status, for debugging. iOS values: notDetermined / sharingAuthorized / sharingDenied. */
  rawStatus?: string;
}

/**
 * The de-facto record shape that flows native → JS → Convex.
 *
 * All timestamps are epoch milliseconds (UTC) — the Convex rollup converts to
 * user-local YYYY-MM-DD using the device timezone.
 *
 * `externalId` is the HealthKit sample UUID and is the dedup key both
 * client-side (within a sync batch) and server-side (`by_external_id` index).
 */
export interface RawSample {
  externalId: string;
  metric: HealthMetric;
  value: number;
  /** Canonical unit per metric (e.g. "ms" for HRV, "bpm" for RHR, "kcal" for energy). */
  unit: string;
  startedAt: number;
  endedAt: number;
  device?: string;
}

/**
 * Result of a permission request — `granted` is true if the user did not
 * explicitly deny. iOS gives no signal between "granted" and "not asked", so
 * downstream code should still null-check sample arrays before assuming data
 * exists.
 */
export interface PermissionResult {
  granted: boolean;
  /** Metric-by-metric breakdown returned by `checkAuthorization()` after the dialog closes. */
  perMetric: AuthorizationStatus[];
}
