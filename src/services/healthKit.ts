/**
 * Apple HealthKit wrapper. Single entry point for everything HealthKit-related;
 * the rest of the app imports `healthKit` / `HEALTH_METRICS` and never touches
 * the underlying Capacitor plugin.
 *
 * Plugin: @capgo/capacitor-health@^8.5.1 (Capacitor 8, Swift Package Manager,
 * targets iOS 15+). Replaces the deprecated @perfood/capacitor-healthkit which
 * was Cap-4 era and missing from CapApp-SPM/Package.swift on Cap 8.
 *
 * Plugin coverage:
 *   - Supported metrics: HRV (heartRateVariability), restingHeartRate, sleep
 *     stages, workouts, activeEnergy, steps, vo2Max, respiratoryRate, weight,
 *     bodyFat — covers everything the score engine needs except wrist temp.
 *   - Unsupported: wrist_temp_delta (no Cap-8 plugin exposes
 *     HKQuantityTypeIdentifierAppleSleepingWristTemperature yet — the metric
 *     is left in HEALTH_METRICS so the UI can render a "tier-gated" badge, but
 *     the wrapper returns [] and `granted: false` for it).
 *   - Background delivery: the plugin does not yet expose
 *     `enableBackgroundObserverQuery`, so `enableBackgroundDelivery` remains
 *     a documented no-op (sync still runs on foreground). Tracked separately.
 *
 * Conventions:
 *  - All timestamps are epoch ms. Convex rollup converts to local YYYY-MM-DD.
 *  - HR is not exposed raw — only daily restingHeartRate summaries (spec §10/12).
 *  - Sleep stage segments are bucketed per (source, night) in JS.
 *  - All public methods are null-safe on non-iOS platforms.
 */

import { Capacitor } from "@capacitor/core";
import { logger } from "@/lib/logger";
import type {
  AuthorizationStatus,
  HealthMetric,
  PermissionResult,
  RawSample,
} from "./healthKit.types";

/**
 * Canonical metric list. The order here is the order the UI lists them in the
 * permission explainer; treat it as a public spec, not a code detail.
 */
export const HEALTH_METRICS: readonly HealthMetric[] = [
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
  "body_fat_pct",
] as const;

/**
 * Overlap window applied to `syncSinceLastSync` so late-arriving samples
 * (Whoop / Oura syncing 1–3 days late) are not missed. Spec §10 (5).
 */
const SYNC_OVERLAP_MS = 60 * 60 * 1000; // 1 hour

/** Hard ceiling on backfill at first connection: 30 days. */
const INITIAL_BACKFILL_MS = 30 * 24 * 60 * 60 * 1000;

/** Per-metric `limit` parameter passed to the plugin query (0 = no limit). */
const QUERY_LIMIT = 0;

const HEALTH_APP_URL = "x-apple-health://";

// ---------------------------------------------------------------------------
// Plugin shape — the Capgo @capgo/capacitor-health JS surface we depend on.
// We declare structurally so this file compiles cleanly before the dep is
// installed and is resilient to non-breaking additions in the upstream plugin.
// ---------------------------------------------------------------------------

/** Subset of `HealthDataType` the wrapper actually requests. */
type PluginDataType =
  | "heartRateVariability"
  | "restingHeartRate"
  | "sleep"
  | "workouts"
  | "calories"
  | "steps"
  | "vo2Max"
  | "respiratoryRate"
  | "weight"
  | "bodyFat";

type PluginSleepState =
  | "inBed"
  | "asleep"
  | "awake"
  | "rem"
  | "deep"
  | "light";

interface PluginHealthSample {
  dataType: PluginDataType | string;
  value: number;
  unit?: string;
  startDate: string;
  endDate: string;
  sourceName?: string;
  sourceId?: string;
  platformId?: string;
  sleepState?: PluginSleepState;
}

interface PluginReadSamplesResult {
  samples: PluginHealthSample[];
}

interface PluginWorkout {
  workoutType?: string;
  duration?: number; // seconds
  totalEnergyBurned?: number; // kilocalories
  totalDistance?: number; // meters
  startDate: string;
  endDate: string;
  sourceName?: string;
  sourceId?: string;
  platformId?: string;
}

interface PluginWorkoutsResult {
  workouts: PluginWorkout[];
  anchor?: string;
}

interface PluginAvailabilityResult {
  available: boolean;
  platform?: string;
  reason?: string;
}

interface PluginAuthorizationStatus {
  readAuthorized: string[];
  readDenied: string[];
  writeAuthorized: string[];
  writeDenied: string[];
}

interface PluginHandle {
  isAvailable: () => Promise<PluginAvailabilityResult>;
  requestAuthorization: (opts: {
    read?: PluginDataType[];
    write?: PluginDataType[];
  }) => Promise<PluginAuthorizationStatus>;
  checkAuthorization: (opts: {
    read?: PluginDataType[];
    write?: PluginDataType[];
  }) => Promise<PluginAuthorizationStatus>;
  readSamples: (opts: {
    dataType: PluginDataType;
    startDate?: string;
    endDate?: string;
    limit?: number;
    ascending?: boolean;
  }) => Promise<PluginReadSamplesResult>;
  queryWorkouts: (opts: {
    startDate?: string;
    endDate?: string;
    limit?: number;
    ascending?: boolean;
  }) => Promise<PluginWorkoutsResult>;
}

// ---------------------------------------------------------------------------
// Metric ↔ plugin mapping.
//
// `dataType`           — `HealthDataType` string passed to `readSamples` /
//                        `requestAuthorization`. `null` means the metric is
//                        not supported by the installed plugin.
// `requiresWorkoutApi` — read via `queryWorkouts`, not `readSamples`.
// `canonicalUnit`      — the unit `RawSample.unit` is normalised to.
// ---------------------------------------------------------------------------
interface MetricBinding {
  dataType: PluginDataType | null;
  requiresWorkoutApi?: boolean;
  canonicalUnit: string;
}

const METRIC_TABLE: Record<HealthMetric, MetricBinding> = {
  hrv_sdnn:           { dataType: "heartRateVariability", canonicalUnit: "ms" },
  resting_hr:         { dataType: "restingHeartRate",     canonicalUnit: "bpm" },
  sleep_total:        { dataType: "sleep",                canonicalUnit: "min" },
  sleep_deep:         { dataType: "sleep",                canonicalUnit: "min" },
  sleep_rem:          { dataType: "sleep",                canonicalUnit: "min" },
  sleep_core:         { dataType: "sleep",                canonicalUnit: "min" },
  workout_minutes:    { dataType: "workouts", requiresWorkoutApi: true, canonicalUnit: "min" },
  active_energy_kcal: { dataType: "calories",             canonicalUnit: "kcal" },
  steps:              { dataType: "steps",                canonicalUnit: "count" },
  vo2_max:            { dataType: "vo2Max",               canonicalUnit: "ml/kg/min" },
  respiratory_rate:   { dataType: "respiratoryRate",      canonicalUnit: "brpm" },
  // Wrist-temperature delta is not yet exposed by @capgo/capacitor-health.
  // The metric stays in HEALTH_METRICS for UI continuity; sync emits zero
  // samples and checkAuthorization reports it as unsupported.
  wrist_temp_delta:   { dataType: null,                   canonicalUnit: "celsius" },
  body_mass_kg:       { dataType: "weight",               canonicalUnit: "kg" },
  body_fat_pct:       { dataType: "bodyFat",              canonicalUnit: "pct" },
};

const metricBinding = (m: HealthMetric): MetricBinding => METRIC_TABLE[m];

// --- Lazy plugin loader (web-safe) ---
let pluginPromise: Promise<PluginHandle | null> | null = null;

async function getPlugin(): Promise<PluginHandle | null> {
  if (Capacitor.getPlatform() !== "ios") return null;
  if (!pluginPromise) {
    // We log any import failure as `error` (not `warn`) because a missing
    // plugin in an iOS build is a hard misconfiguration that Sentry must surface.
    pluginPromise = (async () => {
      try {
        // Static string-literal specifier (NOT a variable + @vite-ignore) so Vite
        // bundles the plugin's JS into a lazy chunk. A bare-specifier runtime import
        // cannot be resolved inside the iOS WKWebView, which made isAvailable() reject
        // and surface "Apple Health unavailable" on device. Mirrors the working
        // RevenueCat loader in src/lib/purchases.ts.
        const mod = (await import("@capgo/capacitor-health")) as unknown as {
          Health?: unknown;
        };
        if (!mod.Health) {
          logger.error("healthKit: Health export missing from @capgo/capacitor-health");
          return null;
        }
        return mod.Health as PluginHandle;
      } catch (err) {
        logger.error("healthKit: plugin import failed", { error: String(err) });
        return null;
      }
    })();
  }
  return pluginPromise;
}

// --- Helpers ---
function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function toMs(iso: string | undefined): number {
  if (!iso) return 0;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

function debug(msg: string, data?: Record<string, unknown>) {
  logger.debug(`healthKit: ${msg}`, data);
}

function uniqueReadTypes(metrics: readonly HealthMetric[]): PluginDataType[] {
  const set = new Set<PluginDataType>();
  for (const m of metrics) {
    const t = metricBinding(m).dataType;
    if (t) set.add(t);
  }
  return [...set];
}

function dedupeByExternalId(samples: RawSample[]): RawSample[] {
  const seen = new Set<string>();
  const out: RawSample[] = [];
  for (const s of samples) {
    if (!s.externalId) continue;
    if (seen.has(s.externalId)) continue;
    seen.add(s.externalId);
    out.push(s);
  }
  return out;
}

function deviceLabel(s: PluginHealthSample | PluginWorkout): string | undefined {
  return s.sourceName ?? s.sourceId ?? undefined;
}

// ---------------------------------------------------------------------------
// Per-metric readers
// ---------------------------------------------------------------------------

async function readPluginSamples(
  dataType: PluginDataType,
  sinceMs: number,
  untilMs: number,
): Promise<PluginHealthSample[]> {
  const plugin = await getPlugin();
  if (!plugin) return [];
  try {
    const result = await plugin.readSamples({
      dataType,
      startDate: toIso(sinceMs),
      endDate: toIso(untilMs),
      limit: QUERY_LIMIT,
      ascending: true,
    });
    return result?.samples ?? [];
  } catch (err) {
    debug(`readSamples failed for ${dataType}`, { error: String(err) });
    return [];
  }
}

async function readPluginWorkouts(
  sinceMs: number,
  untilMs: number,
): Promise<PluginWorkout[]> {
  const plugin = await getPlugin();
  if (!plugin) return [];
  try {
    const result = await plugin.queryWorkouts({
      startDate: toIso(sinceMs),
      endDate: toIso(untilMs),
      limit: QUERY_LIMIT,
      ascending: true,
    });
    return result?.workouts ?? [];
  } catch (err) {
    debug(`queryWorkouts failed`, { error: String(err) });
    return [];
  }
}

function mapQuantitySamples(
  metric: HealthMetric,
  rows: PluginHealthSample[],
): RawSample[] {
  const unit = metricBinding(metric).canonicalUnit;
  const out: RawSample[] = [];
  for (const r of rows) {
    if (!r.platformId) continue;
    const value = typeof r.value === "number" ? r.value : NaN;
    if (!Number.isFinite(value)) continue;
    const startedAt = toMs(r.startDate);
    const endedAt = toMs(r.endDate) || startedAt;
    if (!startedAt) continue;
    out.push({
      externalId: r.platformId,
      metric,
      value,
      unit,
      startedAt,
      endedAt,
      device: deviceLabel(r),
    });
  }
  return out;
}

type SleepStage = "sleep_total" | "sleep_deep" | "sleep_rem" | "sleep_core";

function mapSleepState(state: PluginSleepState | undefined): SleepStage | null {
  if (!state) return null;
  switch (state) {
    case "deep":
      return "sleep_deep";
    case "rem":
      return "sleep_rem";
    case "light":
      return "sleep_core";
    case "asleep":
      // iOS pre-16 collapses all asleep segments into a single 'asleep' state.
      return "sleep_total";
    case "inBed":
    case "awake":
    default:
      return null;
  }
}

interface SleepBucket {
  stage: SleepStage;
  source: string;
  night: string;
  minutes: number;
  startedAt: number;
  endedAt: number;
}

/**
 * Sleep samples come back as one row per stage segment per source. v1 only
 * needs daily totals, so we bucket per (source, stage, night) and emit one
 * synthetic sample per bucket. Night key = local YYYY-MM-DD of (midpoint − 6h)
 * so a session that started at 23:00 still buckets to "last night".
 */
function bucketSleepSamples(rows: PluginHealthSample[]): RawSample[] {
  const buckets = new Map<string, SleepBucket>();
  const merge = (
    stage: SleepStage,
    source: string,
    night: string,
    startedAt: number,
    endedAt: number,
    minutes: number,
  ) => {
    const key = `${source}::${stage}::${night}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.minutes += minutes;
      existing.startedAt = Math.min(existing.startedAt, startedAt);
      existing.endedAt = Math.max(existing.endedAt, endedAt);
    } else {
      buckets.set(key, { stage, source, night, minutes, startedAt, endedAt });
    }
  };

  for (const r of rows) {
    const stage = mapSleepState(r.sleepState);
    if (!stage) continue;
    const startedAt = toMs(r.startDate);
    const endedAt = toMs(r.endDate);
    if (!startedAt || !endedAt || endedAt <= startedAt) continue;

    const minutes = (endedAt - startedAt) / 60000;
    const source = deviceLabel(r) ?? "unknown";
    const midpoint = (startedAt + endedAt) / 2;
    const night = new Date(midpoint - 6 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    merge(stage, source, night, startedAt, endedAt, minutes);
    if (stage !== "sleep_total") {
      merge("sleep_total", source, night, startedAt, endedAt, minutes);
    }
  }

  return [...buckets.values()].map((b) => ({
    // Stable synthetic externalId — keeps server-side rollup idempotent.
    externalId: `sleep::${b.source}::${b.stage}::${b.night}`,
    metric: b.stage,
    value: Math.round(b.minutes),
    unit: "min",
    startedAt: b.startedAt,
    endedAt: b.endedAt,
    device: b.source,
  }));
}

function mapWorkoutSamples(rows: PluginWorkout[]): RawSample[] {
  const out: RawSample[] = [];
  for (const r of rows) {
    const externalIdBase = r.platformId;
    if (!externalIdBase) continue;
    const startedAt = toMs(r.startDate);
    const endedAt = toMs(r.endDate);
    if (!startedAt || !endedAt || endedAt <= startedAt) continue;

    // Prefer the plugin-reported duration (seconds) so segmented workouts
    // with paused intervals report active minutes rather than wall-clock.
    const durationSeconds =
      typeof r.duration === "number" && r.duration > 0
        ? r.duration
        : (endedAt - startedAt) / 1000;
    const durationMin = Math.round(durationSeconds / 60);
    if (durationMin <= 0) continue;
    const device = deviceLabel(r);

    out.push({
      externalId: `workout-min::${externalIdBase}`,
      metric: "workout_minutes",
      value: durationMin,
      unit: "min",
      startedAt,
      endedAt,
      device,
    });

    const teb = r.totalEnergyBurned;
    if (typeof teb === "number" && teb > 0) {
      out.push({
        externalId: `workout-kcal::${externalIdBase}`,
        metric: "active_energy_kcal",
        value: Math.round(teb),
        unit: "kcal",
        startedAt,
        endedAt,
        device,
      });
    }
  }
  return out;
}

async function readMetric(
  metric: HealthMetric,
  sinceMs: number,
  untilMs: number,
): Promise<RawSample[]> {
  const binding = metricBinding(metric);
  if (!binding.dataType) {
    debug(`metric ${metric} not supported by installed plugin — skipping`);
    return [];
  }

  if (binding.requiresWorkoutApi) {
    const workouts = await readPluginWorkouts(sinceMs, untilMs);
    return mapWorkoutSamples(workouts);
  }

  const rows = await readPluginSamples(binding.dataType, sinceMs, untilMs);
  if (rows.length === 0) return [];

  if (binding.dataType === "sleep") {
    // All 4 sleep metrics share this code path; downstream dedupeByExternalId
    // collapses duplicates emitted by `sleep_total`/`sleep_deep`/etc.
    return bucketSleepSamples(rows);
  }
  return mapQuantitySamples(metric, rows);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

class HealthKitService {
  /** True if HealthKit can be read on this device. Always false on web/Android. */
  async isAvailable(): Promise<boolean> {
    if (Capacitor.getPlatform() !== "ios") return false;
    const plugin = await getPlugin();
    if (!plugin) return false;
    try {
      const result = await plugin.isAvailable();
      return Boolean(result?.available);
    } catch (err) {
      debug("isAvailable() rejected", { error: String(err) });
      return false;
    }
  }

  /**
   * Triggers the native HealthKit permission sheet. iOS gives no signal back
   * about per-scope grant vs deny — `granted` only reflects that the sheet
   * resolved. Callers should treat empty sample arrays as possible silent
   * denial.
   */
  async requestPermissions(
    metrics: readonly HealthMetric[] = HEALTH_METRICS,
  ): Promise<PermissionResult> {
    if (!(await this.isAvailable())) return { granted: false, perMetric: [] };
    const plugin = await getPlugin();
    if (!plugin) return { granted: false, perMetric: [] };

    const readTypes = uniqueReadTypes(metrics);
    try {
      await plugin.requestAuthorization({
        read: readTypes,
        write: [],
      });
      const perMetric = await this.checkAuthorization(metrics);
      return { granted: true, perMetric };
    } catch (err) {
      debug("requestAuthorization rejected", { error: String(err) });
      return { granted: false, perMetric: [] };
    }
  }

  /**
   * Best-effort per-metric authorisation snapshot. iOS does not expose read
   * scope status, so the plugin reports `readAuthorized` optimistically (any
   * type whose status is not `notDetermined` is treated as authorised). The
   * authoritative signal remains `sourcesPresent` server-side after the first
   * successful sync.
   */
  async checkAuthorization(
    metrics: readonly HealthMetric[] = HEALTH_METRICS,
  ): Promise<AuthorizationStatus[]> {
    if (Capacitor.getPlatform() !== "ios") {
      return metrics.map((metric) => ({
        metric,
        granted: false,
        rawStatus: "non-ios-platform",
      }));
    }
    const plugin = await getPlugin();
    if (!plugin) {
      return metrics.map((metric) => ({
        metric,
        granted: false,
        rawStatus: "plugin-unavailable",
      }));
    }

    const readTypes = uniqueReadTypes(metrics);
    let authorised = new Set<string>();
    let denied = new Set<string>();
    try {
      const status = await plugin.checkAuthorization({
        read: readTypes,
        write: [],
      });
      authorised = new Set(status?.readAuthorized ?? []);
      denied = new Set(status?.readDenied ?? []);
    } catch (err) {
      debug("checkAuthorization rejected", { error: String(err) });
    }

    return metrics.map((metric) => {
      const binding = metricBinding(metric);
      if (!binding.dataType) {
        return {
          metric,
          granted: false,
          rawStatus: "plugin-unsupported",
        };
      }
      if (denied.has(binding.dataType)) {
        return { metric, granted: false, rawStatus: "ios-read-denied" };
      }
      if (authorised.has(binding.dataType)) {
        return { metric, granted: true, rawStatus: "ios-read-authorized" };
      }
      return { metric, granted: false, rawStatus: "ios-read-not-determined" };
    });
  }

  /** Single-metric read. Production callers should prefer `syncSinceLastSync`. */
  async readSamples(
    metric: HealthMetric,
    since: number,
    until: number = Date.now(),
  ): Promise<RawSample[]> {
    if (!(await this.isAvailable())) return [];
    return dedupeByExternalId(await readMetric(metric, since, until));
  }

  /**
   * Pulls all supported metrics since the last sync (with a 1h overlap for
   * late-arriving samples) and returns a deduped flat array. Caller batches
   * into `api.health.insertSamples`.
   */
  async syncSinceLastSync(lastSyncAt: number | null): Promise<RawSample[]> {
    if (!(await this.isAvailable())) return [];

    const now = Date.now();
    const baseSince =
      lastSyncAt && Number.isFinite(lastSyncAt)
        ? lastSyncAt - SYNC_OVERLAP_MS
        : now - INITIAL_BACKFILL_MS;
    const since = Math.max(0, baseSince);

    // Many metrics share underlying plugin data types (all 4 sleep stages
    // collapse to one `sleep` query). Dedupe by plugin dataType so we issue
    // each native query exactly once. Workouts use a separate API path.
    const seenDataTypes = new Set<PluginDataType>();
    const reads: Promise<RawSample[]>[] = [];
    for (const metric of HEALTH_METRICS) {
      const binding = metricBinding(metric);
      if (!binding.dataType) continue;
      if (seenDataTypes.has(binding.dataType)) continue;
      seenDataTypes.add(binding.dataType);
      const target: HealthMetric =
        binding.dataType === "sleep" ? "sleep_total" : metric;
      reads.push(readMetric(target, since, now));
    }

    let results: RawSample[][];
    try {
      results = await Promise.all(reads);
    } catch (err) {
      logger.warn("healthKit: syncSinceLastSync aggregate failure", {
        error: String(err),
      });
      return [];
    }

    const flat = results.flat();
    const deduped = dedupeByExternalId(flat);
    debug("syncSinceLastSync complete", {
      since,
      now,
      rawCount: flat.length,
      dedupedCount: deduped.length,
    });
    return deduped;
  }

  /**
   * Best-effort background-delivery enable.
   *
   * @capgo/capacitor-health v8.5.x does NOT expose
   * `HKHealthStore.enableBackgroundDelivery` — there is no JS bridge for
   * `enableBackgroundObserverQuery` yet (see plugin.ts `pluginMethods`). The
   * wrapper keeps this method on the public surface so callers don't need a
   * platform branch; replace with a real bridge call when the upstream
   * plugin lands one (or via a thin in-house native extension).
   *
   * Until then sync runs on foreground / app-resume only — fine for v1 since
   * the score engine recomputes on every sync, but worth tracking.
   */
  async enableBackgroundDelivery(
    _metrics: readonly HealthMetric[] = HEALTH_METRICS,
  ): Promise<void> {
    if (!(await this.isAvailable())) return;
    debug(
      "enableBackgroundDelivery: no-op — @capgo/capacitor-health does not yet expose this bridge",
    );
  }

  /**
   * Deep-links to the Apple Health app for users to manage per-metric scopes
   * when iOS refuses to re-show the permission sheet (spec §10/1). Cap 8
   * removed `App.openUrl()`; assigning `window.location.href` is the
   * supported pattern for custom URL schemes in the WebView.
   */
  async openHealthSettings(): Promise<void> {
    if (Capacitor.getPlatform() !== "ios") return;
    try {
      if (typeof window !== "undefined") {
        window.location.href = HEALTH_APP_URL;
      }
    } catch (err) {
      logger.warn("healthKit: openHealthSettings failed", {
        error: String(err),
      });
    }
  }
}

export const healthKit = new HealthKitService();
export type {
  AuthorizationStatus,
  HealthMetric,
  PermissionResult,
  RawSample,
  Tier,
} from "./healthKit.types";
