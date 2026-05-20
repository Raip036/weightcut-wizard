/**
 * Apple HealthKit wrapper. Single entry point for everything HealthKit-related;
 * the rest of the app imports `healthKit` / `HEALTH_METRICS` and never touches
 * the underlying Capacitor plugin.
 *
 * Plugin: @perfood/capacitor-healthkit@1.3.2 (declares Cap ^4 peer dep but its
 * podspec depends on `Capacitor` unversioned and the native bridge surface is
 * stable across Cap 4→8). Gaps in 1.3.2: HRV / VO2Max / wrist-temp-delta — the
 * wrapper accepts those metrics but returns `[]` with a debug log until a thin
 * native extension lands. Downstream rollup / scoring already null-tolerates
 * missing metrics and redistributes weights (spec §7.2).
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

// --- Plugin metric mapping ---
// Tuple: [pluginSampleName, pluginAuthShortName, canonicalUnit].
// A null sampleName means the metric is not yet supported by the installed
// plugin version (HRV / VO2Max / wrist-temp-delta — needs native extension).
// Auth short-names match the plugin's Swift `getTypes()` switch statement.
const METRIC_TABLE: Record<HealthMetric, [string | null, string | null, string]> = {
  hrv_sdnn:           [null,                  null,              "ms"],
  resting_hr:         ["restingHeartRate",    "restingHeartRate", "bpm"],
  sleep_total:        ["sleepAnalysis",       "activity",         "min"],
  sleep_deep:         ["sleepAnalysis",       "activity",         "min"],
  sleep_rem:          ["sleepAnalysis",       "activity",         "min"],
  sleep_core:         ["sleepAnalysis",       "activity",         "min"],
  workout_minutes:    ["workoutType",         "activity",         "min"],
  active_energy_kcal: ["activeEnergyBurned",  "calories",         "kcal"],
  steps:              ["stepCount",           "steps",            "count"],
  vo2_max:            [null,                  null,              "ml/kg/min"],
  respiratory_rate:   ["respiratoryRate",     "respiratoryRate",  "brpm"],
  wrist_temp_delta:   [null,                  null,              "celsius"],
  body_mass_kg:       ["weight",              "weight",           "kg"],
  body_fat_pct:       ["bodyFat",             "bodyFat",          "pct"],
};

const pluginSampleName = (m: HealthMetric) => METRIC_TABLE[m][0];
const pluginAuthName = (m: HealthMetric) => METRIC_TABLE[m][1];
const metricUnit = (m: HealthMetric) => METRIC_TABLE[m][2];

// --- Plugin shape (the plugin's own d.ts isn't tightly typed) ---
interface PluginQueryResult {
  countReturn: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resultData: any[];
}

interface PluginHandle {
  isAvailable: () => Promise<void>;
  requestAuthorization: (opts: {
    all: string[];
    read: string[];
    write: string[];
  }) => Promise<void>;
  queryHKitSampleType: (opts: {
    sampleName: string;
    startDate: string;
    endDate: string;
    limit: number;
  }) => Promise<PluginQueryResult>;
  // Used as a heuristic per-metric permission check post-grant. Returns
  // resolved on authorised, rejects otherwise (per plugin behaviour for the
  // WRITE auth check — read-side check is identical at the bridge).
  isEditionAuthorized?: (opts: { sampleName: string }) => Promise<void>;
}

// --- Lazy plugin loader (web-safe) ---
let pluginPromise: Promise<PluginHandle | null> | null = null;

async function getPlugin(): Promise<PluginHandle | null> {
  if (Capacitor.getPlatform() !== "ios") return null;
  if (!pluginPromise) {
    // Dynamic import via variable specifier — keeps web/Android bundles
    // clean and lets TS compile before the wiring agent runs `npm install`.
    // Missing dep at runtime silently degrades to "no plugin".
    pluginPromise = (async () => {
      try {
        const specifier: string = "@perfood/capacitor-healthkit";
        const mod = (await import(
          /* @vite-ignore */ specifier
        )) as { CapacitorHealthkit?: unknown };
        if (!mod.CapacitorHealthkit) {
          logger.warn("healthKit: CapacitorHealthkit export missing");
          return null;
        }
        return mod.CapacitorHealthkit as PluginHandle;
      } catch (err) {
        logger.warn("healthKit: plugin import failed", { error: String(err) });
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

function uniqueAuthNames(metrics: readonly HealthMetric[]): string[] {
  const set = new Set<string>();
  for (const m of metrics) {
    const name = pluginAuthName(m);
    if (name) set.add(name);
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

interface RawPluginSample {
  uuid?: string;
  startDate?: string;
  endDate?: string;
  value?: number;
  unitName?: string;
  duration?: number; // hours, for sleep / workouts
  sleepState?: string;
  workoutActivityName?: string;
  totalEnergyBurned?: number;
  source?: string;
  sourceBundleId?: string;
  device?: { name?: string | null } | null;
}

function deviceLabel(s: RawPluginSample): string | undefined {
  const name = s.device?.name ?? undefined;
  if (name) return name;
  return s.source ?? undefined;
}

// --- Per-metric readers ---
async function queryRange(
  sampleName: string,
  sinceMs: number,
  untilMs: number,
): Promise<RawPluginSample[]> {
  const plugin = await getPlugin();
  if (!plugin) return [];
  try {
    const result = await plugin.queryHKitSampleType({
      sampleName,
      startDate: toIso(sinceMs),
      endDate: toIso(untilMs),
      limit: QUERY_LIMIT,
    });
    return (result?.resultData ?? []) as RawPluginSample[];
  } catch (err) {
    debug(`query failed for ${sampleName}`, { error: String(err) });
    return [];
  }
}

function mapQuantitySamples(
  metric: HealthMetric,
  rows: RawPluginSample[],
): RawSample[] {
  const unit = metricUnit(metric);
  const out: RawSample[] = [];
  for (const r of rows) {
    if (!r.uuid) continue;
    const value = typeof r.value === "number" ? r.value : NaN;
    if (!Number.isFinite(value)) continue;
    const startedAt = toMs(r.startDate);
    const endedAt = toMs(r.endDate) || startedAt;
    if (!startedAt) continue;
    out.push({
      externalId: r.uuid,
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

function mapSleepState(state: string | undefined): SleepStage | null {
  if (!state) return null;
  const s = state.toLowerCase();
  if (s.includes("deep")) return "sleep_deep";
  if (s.includes("rem")) return "sleep_rem";
  if (s.includes("core") || s.includes("light")) return "sleep_core";
  if (s.includes("asleep") || s.includes("unspecified")) return "sleep_total";
  return null; // InBed / Awake — ignored for daily totals
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
function bucketSleepSamples(rows: RawPluginSample[]): RawSample[] {
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

function mapWorkoutSamples(rows: RawPluginSample[]): RawSample[] {
  const out: RawSample[] = [];
  for (const r of rows) {
    if (!r.uuid) continue;
    const startedAt = toMs(r.startDate);
    const endedAt = toMs(r.endDate);
    if (!startedAt || !endedAt || endedAt <= startedAt) continue;
    const durationMin = Math.round((endedAt - startedAt) / 60000);
    if (durationMin <= 0) continue;
    const device = deviceLabel(r);

    out.push({
      externalId: `workout-min::${r.uuid}`,
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
        externalId: `workout-kcal::${r.uuid}`,
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
  const sampleName = pluginSampleName(metric);
  if (!sampleName) {
    debug(`metric ${metric} not yet supported by installed plugin — skipping`);
    return [];
  }

  const rows = await queryRange(sampleName, sinceMs, untilMs);
  if (rows.length === 0) return [];

  if (sampleName === "sleepAnalysis") {
    // All 4 sleep metrics share this code path; downstream dedupeByExternalId
    // collapses duplicates emitted by `sleep_total`/`sleep_deep`/etc.
    return bucketSleepSamples(rows);
  }
  if (sampleName === "workoutType") {
    return mapWorkoutSamples(rows);
  }
  return mapQuantitySamples(metric, rows);
}

// --- Public API ---
class HealthKitService {
  /** True if HealthKit can be read on this device. Always false on web/Android. */
  async isAvailable(): Promise<boolean> {
    if (Capacitor.getPlatform() !== "ios") return false;
    const plugin = await getPlugin();
    if (!plugin) return false;
    try {
      await plugin.isAvailable();
      return true;
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

    const authNames = uniqueAuthNames(metrics);
    try {
      await plugin.requestAuthorization({
        all: authNames,
        read: authNames,
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
   * scope status, so `granted` only reflects whether the metric is supported
   * by the installed plugin on iOS. Authoritative signal is `sourcesPresent`
   * server-side after the first successful sync.
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
    return metrics.map((metric) => {
      const supported = pluginSampleName(metric) !== null;
      return {
        metric,
        granted: Boolean(plugin) && supported,
        rawStatus: supported ? "ios-read-opaque" : "plugin-unsupported",
      };
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

    // Many metrics share underlying plugin sample types (all 4 sleep stages
    // collapse to one `sleepAnalysis` query). Dedupe by plugin sample-name
    // so we issue each native query exactly once.
    const seenSampleNames = new Set<string>();
    const reads: Promise<RawSample[]>[] = [];
    for (const metric of HEALTH_METRICS) {
      const sampleName = pluginSampleName(metric);
      if (!sampleName || seenSampleNames.has(sampleName)) continue;
      seenSampleNames.add(sampleName);
      const target: HealthMetric =
        sampleName === "sleepAnalysis" ? "sleep_total" : metric;
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
   * Best-effort background-delivery enable. The installed plugin version does
   * not expose this API — kept as a no-op so callers don't need a platform
   * branch. Wire up when a native extension lands.
   */
  async enableBackgroundDelivery(): Promise<void> {
    if (!(await this.isAvailable())) return;
    try {
      debug("enableBackgroundDelivery: no-op (plugin support pending)");
    } catch (err) {
      logger.warn("healthKit: enableBackgroundDelivery failed", {
        error: String(err),
      });
    }
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
