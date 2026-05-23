/**
 * Apple HealthKit sync orchestrator.
 *
 * Bridges the native plugin wrapper (`healthKit.ts`) and the Convex
 * ingestion mutation (`api.health.insertSamples`). All callers (App.tsx
 * foreground handler, Dashboard mount, ConnectAppleHealthSheet post-grant,
 * HealthSettingsCard "Sync now" button) funnel through `runHealthKitSync`
 * so:
 *
 *   1. The throttle is shared device-wide — a manual sync from settings
 *      and an app-foreground sync racing each other only fires once.
 *   2. The payload-flattening logic (samplesByMetric → flat samples[])
 *      lives in exactly one place.
 *   3. Errors / no-op cases are logged with a uniform shape.
 *
 * Throttle key: a single in-memory timestamp (`lastRunAt`). 60s window.
 * This is intentionally global rather than per-user because (a) the app
 * is single-user-per-install, and (b) sharing the window across modules
 * is the whole point — losing it would let a manual click race the
 * appStateChange handler.
 *
 * The native plugin gate (`healthKit.isAvailable()`) means web/Android
 * builds short-circuit to `null` without ever calling the mutation.
 */

import { healthKit } from "./healthKit";
import type { HealthMetric, RawSample } from "./healthKit.types";
import { logger } from "@/lib/logger";

/** Minimum gap between syncs in ms. App foreground + dashboard mount can
 *  fire within 100ms of each other; throttling here keeps that single. */
export const HEALTHKIT_SYNC_THROTTLE_MS = 60_000;

/** Shared in-memory throttle. Module-level so all call sites share it. */
let lastRunAt = 0;

/**
 * Bypass the throttle on next call. Manual "Sync now" tap from settings
 * uses this so the user always sees progress on demand.
 */
export function forceNextHealthKitSync(): void {
  lastRunAt = 0;
}

/**
 * What the helper hands back to call sites.
 *   - `null`        → throttled, unavailable, or nothing to send.
 *   - `{ insertedCount }` → mutation succeeded; count is from the server.
 */
export interface HealthKitSyncResult {
  insertedCount: number;
}

/**
 * The wider shape `syncSinceLastSync()` returns under the new plugin
 * contract. Re-declared here so the helper compiles even before the
 * parallel agent's API rewrite lands.
 */
interface SyncWindow {
  samplesByMetric: Record<HealthMetric, RawSample[]>;
  since: string;
  until: string;
}

/**
 * Convert the `samplesByMetric` map into the flat `RawSample[]` shape
 * `api.health.insertSamples` expects (validator at convex/health.ts:31).
 * Each entry already carries its own `metric` field; we just unbox the
 * map and concat.
 */
function flattenSamples(
  samplesByMetric: Record<HealthMetric, RawSample[]> | undefined,
): RawSample[] {
  if (!samplesByMetric) return [];
  const out: RawSample[] = [];
  for (const metric of Object.keys(samplesByMetric) as HealthMetric[]) {
    const bucket = samplesByMetric[metric];
    if (!Array.isArray(bucket)) continue;
    for (const sample of bucket) {
      // Defensive: keep the canonical metric on the sample even if the
      // plugin layer ever forgets to stamp it.
      if (!sample) continue;
      out.push(sample.metric ? sample : { ...sample, metric });
    }
  }
  return out;
}

/**
 * One-shot HealthKit sync + Convex ingest.
 *
 * @param insertSamples The bound Convex mutation handle from
 *   `useMutation(api.health.insertSamples)`. Typed loose (`any`) so this
 *   helper doesn't need the Convex API codegen at compile time — the
 *   mutation itself validates the payload shape.
 * @returns `{ insertedCount }` on success, `null` if throttled / unavailable.
 */
export async function runHealthKitSync(
  insertSamples: (args: { samples: RawSample[] }) => Promise<unknown>,
  options: { force?: boolean } = {},
): Promise<HealthKitSyncResult | null> {
  const now = Date.now();
  if (!options.force && now - lastRunAt < HEALTHKIT_SYNC_THROTTLE_MS) {
    return null;
  }
  // Reserve the slot up-front so concurrent callers don't both squeeze
  // through during the await below. If the sync itself throws we'll
  // restore the timestamp on the failure path.
  lastRunAt = now;

  try {
    const available = await healthKit.isAvailable();
    if (!available) {
      return null;
    }

    // The parallel agent's new `syncSinceLastSync()` returns a window
    // object keyed by metric and takes no arguments (the plugin layer
    // owns the last-sync bookkeeping internally now). We cast through
    // `unknown` so this helper compiles ahead of the API rewrite — and
    // we still handle the legacy flat-array return as a fallback so a
    // mid-rollout race doesn't crash the call site.
    const callable = healthKit.syncSinceLastSync as unknown as (
      ...args: unknown[]
    ) => Promise<SyncWindow | RawSample[] | undefined>;
    const result = await callable();

    const samples: RawSample[] = Array.isArray(result)
      ? result
      : flattenSamples(result?.samplesByMetric);

    if (samples.length === 0) {
      return { insertedCount: 0 };
    }

    const response = (await insertSamples({ samples })) as
      | { inserted?: number }
      | undefined;
    const insertedCount =
      typeof response?.inserted === "number" ? response.inserted : samples.length;

    return { insertedCount };
  } catch (err) {
    // Roll back the throttle so the next attempt (e.g. user re-tapping
    // "Sync now") isn't held off because of a transient failure.
    lastRunAt = 0;
    logger.error("runHealthKitSync failed", err);
    return null;
  }
}
