/**
 * Apple HealthKit ingestion, daily roll-up, baselines, and tier classification.
 * Spec: docs/superpowers/specs/2026-05-20-apple-health-integration-design.md
 * Pure math lives in `convex/lib/health/aggregate.ts`.
 */
import { v } from "convex/values";
import {
  query,
  mutation,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireUserId } from "./lib/auth";
import { KNOWN_METRICS, BASELINE_METRICS } from "./lib/health/constants";
import {
  aggregateSamplesIntoSummary,
  classifyTier,
  mean,
  stdDev,
  summaryFieldForMetric,
  utcDate,
} from "./lib/health/aggregate";

// ───────────────────────────────────────────────────────────────────────
// Public mutations / queries
// ───────────────────────────────────────────────────────────────────────

const sampleValidator = v.object({
  externalId: v.optional(v.string()),
  metric: v.string(),
  value: v.number(),
  unit: v.string(),
  startedAt: v.number(),
  endedAt: v.number(),
  device: v.optional(v.string()),
});

/**
 * Batch insert HealthKit samples. Idempotent on `externalId`: samples whose
 * external id is already present in `health_samples` are silently skipped.
 *
 * After all inserts land, we schedule `internal.health.rollupDaily` 30s
 * later per affected date (spec §6 — debounced post-insert). The roll-up
 * itself is idempotent so even if multiple insert batches race the worst
 * case is a few extra recomputes of the same daily summary.
 */
export const insertSamples = mutation({
  args: { samples: v.array(sampleValidator) },
  handler: async (ctx, { samples }) => {
    const userId = await requireUserId(ctx);
    let inserted = 0;
    let skipped = 0;
    const affectedDates = new Set<string>();

    for (const s of samples) {
      if (!KNOWN_METRICS.has(s.metric)) {
        skipped++;
        continue;
      }
      if (s.externalId) {
        const existing = await ctx.db
          .query("health_samples")
          .withIndex("by_external_id", (q) =>
            q.eq("externalId", s.externalId),
          )
          .first();
        if (existing) {
          skipped++;
          continue;
        }
      }
      await ctx.db.insert("health_samples", {
        userId,
        metric: s.metric,
        value: s.value,
        unit: s.unit,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        source: "healthkit",
        device: s.device,
        externalId: s.externalId,
      });
      inserted++;
      affectedDates.add(utcDate(s.startedAt));
      // For samples that span a day boundary (sleep), also touch the end
      // date so its summary recomputes too.
      if (utcDate(s.endedAt) !== utcDate(s.startedAt)) {
        affectedDates.add(utcDate(s.endedAt));
      }
    }

    // Stamp last-sync on the profile so the next foreground sync uses a
    // narrower window. Done even when no rows inserted so a
    // "nothing-new" sync still updates the timestamp.
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (profile) {
      await ctx.db.patch(profile._id, { healthLastSyncAt: Date.now() });
    }

    // Debounced roll-up — 30s gives a few more insert batches time to
    // land before we recompute the summary. Per spec §6.
    for (const date of affectedDates) {
      await ctx.scheduler.runAfter(30_000, internal.health.rollupDaily, {
        userId,
        date,
      });
    }

    return { inserted, skipped, scheduledRollups: affectedDates.size };
  },
});

/**
 * Returns the last N (default 14) daily summary rows for the auth user,
 * ordered most-recent first. Used by `HealthTilesPanel` and the recovery
 * sub-score's fetch path.
 */
export const listDailySummary = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const userId = await requireUserId(ctx);
    const limit = days ?? 14;
    const rows = await ctx.db
      .query("daily_health_summary")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
    return rows;
  },
});

/**
 * Tier + connection metadata for the calling user. Returns a defaulted
 * tier_0 shape when the profile is missing so the UI can render its
 * "not connected" state without a null check.
 */
export const getTier = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const tier = (profile?.healthDataTier ?? "tier_0") as
      | "tier_0"
      | "tier_1"
      | "tier_2";
    return {
      tier,
      grantedMetrics: profile?.healthGrantedMetrics ?? [],
      lastSyncAt: profile?.healthLastSyncAt ?? null,
      connectedAt: profile?.healthKitConnectedAt ?? null,
    };
  },
});

/**
 * Called by `ConnectAppleHealthSheet` after the user accepts the iOS
 * permission sheet. Stamps `healthKitConnectedAt` (if not already set),
 * stores the granted-metric set, refreshes `healthLastSyncAt`, and clears
 * any prior `healthKitDisabledAt`.
 */
export const setHealthKitConnected = mutation({
  args: { grantedMetrics: v.array(v.string()) },
  handler: async (ctx, { grantedMetrics }) => {
    const userId = await requireUserId(ctx);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) throw new Error("Profile not found");
    const now = Date.now();
    await ctx.db.patch(profile._id, {
      // Keep the original connect timestamp on re-grant so the "connected
      // since" UI string stays accurate.
      healthKitConnectedAt: profile.healthKitConnectedAt ?? now,
      healthGrantedMetrics: grantedMetrics,
      healthLastSyncAt: profile.healthLastSyncAt ?? now,
      healthKitDisabledAt: undefined,
    });
    return null;
  },
});

/** Onboarding "Skip for now" — stops the wizard re-prompting. */
export const recordPromptShown = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return null;
    await ctx.db.patch(profile._id, { healthKitPromptedAt: Date.now() });
    return null;
  },
});

/**
 * Local disconnect. iOS won't let us programmatically revoke the OS-level
 * grant — the Settings card instructs the user to do that via the Health
 * app. We mirror that disconnect on our side by clearing tier + stamping
 * `healthKitDisabledAt`. Existing `health_samples` are kept (spec §9).
 */
export const markDisconnected = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return null;
    await ctx.db.patch(profile._id, {
      healthKitDisabledAt: Date.now(),
      healthDataTier: "tier_0",
      healthGrantedMetrics: [],
    });
    return null;
  },
});

// ───────────────────────────────────────────────────────────────────────
// Internal queries / mutations
// ───────────────────────────────────────────────────────────────────────

export const _fetchSamplesForDate = internalQuery({
  args: { userId: v.id("users"), date: v.string() },
  handler: async (ctx, { userId, date }) => {
    // Bracket the UTC day in epoch ms. We include any sample that
    // *starts* in the window — sleep samples that wrap midnight are
    // double-counted into both days, which is fine because the sleep
    // metrics get session-deduped further down (see aggregate.ts).
    const start = Date.parse(date + "T00:00:00Z");
    const end = start + 24 * 60 * 60 * 1000;
    const all: Doc<"health_samples">[] = [];
    for (const metric of KNOWN_METRICS) {
      const rows = await ctx.db
        .query("health_samples")
        .withIndex("by_user_metric_started", (q) =>
          q
            .eq("userId", userId)
            .eq("metric", metric)
            .gte("startedAt", start)
            .lt("startedAt", end),
        )
        .collect();
      all.push(...rows);
    }
    return all;
  },
});

export const _upsertDailySummary = internalMutation({
  args: {
    userId: v.id("users"),
    date: v.string(),
    summary: v.object({
      hrvAvgMs: v.optional(v.number()),
      restingHrBpm: v.optional(v.number()),
      sleepMinutes: v.optional(v.number()),
      sleepDeepMinutes: v.optional(v.number()),
      sleepRemMinutes: v.optional(v.number()),
      sleepEfficiencyPct: v.optional(v.number()),
      workoutMinutes: v.optional(v.number()),
      activeEnergyKcal: v.optional(v.number()),
      stepCount: v.optional(v.number()),
      vo2Max: v.optional(v.number()),
      respiratoryRateAvg: v.optional(v.number()),
      wristTempDeltaC: v.optional(v.number()),
      bodyMassKg: v.optional(v.number()),
      sourcesPresent: v.array(v.string()),
    }),
  },
  handler: async (ctx, { userId, date, summary }) => {
    const existing = await ctx.db
      .query("daily_health_summary")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).eq("date", date),
      )
      .unique();
    const row = { userId, date, ...summary, computedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, row);
      return existing._id;
    }
    return await ctx.db.insert("daily_health_summary", row);
  },
});

export const _fetchSummaries14d = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("daily_health_summary")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .take(14);
  },
});

export const _upsertBaseline = internalMutation({
  args: {
    userId: v.id("users"),
    metric: v.string(),
    rolling14dMean: v.number(),
    rolling14dStdDev: v.number(),
    rolling7dMean: v.optional(v.number()),
    sampleCount: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("health_baselines")
      .withIndex("by_user_metric", (q) =>
        q.eq("userId", args.userId).eq("metric", args.metric),
      )
      .unique();
    const row = { ...args, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, row);
      return existing._id;
    }
    return await ctx.db.insert("health_baselines", row);
  },
});

export const _setTier = internalMutation({
  args: {
    userId: v.id("users"),
    tier: v.union(
      v.literal("tier_0"),
      v.literal("tier_1"),
      v.literal("tier_2"),
    ),
  },
  handler: async (ctx, { userId, tier }) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return null;
    await ctx.db.patch(profile._id, { healthDataTier: tier });
    return null;
  },
});

/** Returns every userId with `healthKitConnectedAt != null` and no
 *  active disconnect. The crons fan out to these users. */
export const _listConnectedUserIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<Id<"users">>> => {
    const profiles = await ctx.db.query("profiles").collect();
    return profiles
      .filter(
        (p) =>
          p.healthKitConnectedAt != null && p.healthKitDisabledAt == null,
      )
      .map((p) => p.userId);
  },
});

// ───────────────────────────────────────────────────────────────────────
// Internal actions (pipeline + cron entry points)
// ───────────────────────────────────────────────────────────────────────

/**
 * Re-builds the `daily_health_summary` row for (userId, date). Idempotent.
 * Scheduled 30s after every `insertSamples` batch and again nightly via
 * cron for the previous day across all connected users.
 */
export const rollupDaily = internalAction({
  args: { userId: v.id("users"), date: v.string() },
  handler: async (ctx, { userId, date }): Promise<null> => {
    const samples: Doc<"health_samples">[] = await ctx.runQuery(
      internal.health._fetchSamplesForDate,
      { userId, date },
    );
    const summary = aggregateSamplesIntoSummary(samples);
    await ctx.runMutation(internal.health._upsertDailySummary, {
      userId,
      date,
      summary,
    });
    return null;
  },
});

/**
 * Recompute the 14-day rolling mean + stddev (and 7-day mean) per metric,
 * then reclassify the user's tier based on sample coverage (spec §6).
 */
export const computeBaselines = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<null> => {
    const summaries: Doc<"daily_health_summary">[] = await ctx.runQuery(
      internal.health._fetchSummaries14d,
      { userId },
    );
    const last7 = summaries.slice(0, 7);

    for (const metric of BASELINE_METRICS) {
      const field = summaryFieldForMetric(metric);
      if (!field) continue;
      const values14 = summaries
        .map((s) => s[field] as number | undefined)
        .filter((x): x is number => typeof x === "number");
      if (values14.length === 0) continue;
      const m14 = mean(values14);
      const sd14 = stdDev(values14, m14);
      const values7 = last7
        .map((s) => s[field] as number | undefined)
        .filter((x): x is number => typeof x === "number");
      const m7 = values7.length > 0 ? mean(values7) : undefined;
      await ctx.runMutation(internal.health._upsertBaseline, {
        userId,
        metric,
        rolling14dMean: m14,
        rolling14dStdDev: sd14,
        rolling7dMean: m7,
        sampleCount: values14.length,
      });
    }

    const tier = classifyTier(summaries);
    await ctx.runMutation(internal.health._setTier, { userId, tier });
    return null;
  },
});

/** Yesterday in UTC. The nightly roll-up re-bakes the previous full day
 *  to absorb late-arriving watch / Whoop sync data (spec §10.5). */
function yesterdayUtc(): string {
  return utcDate(Date.now() - 24 * 60 * 60 * 1000);
}

/**
 * Cron entry point at 04:00 UTC daily — re-rolls yesterday's summary for
 * every connected user. Scheduled (not awaited) so a single slow user
 * doesn't block the rest.
 */
export const scheduleNightlyRollups = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    const userIds: Array<Id<"users">> = await ctx.runQuery(
      internal.health._listConnectedUserIds,
    );
    const date = yesterdayUtc();
    for (const userId of userIds) {
      await ctx.scheduler.runAfter(0, internal.health.rollupDaily, {
        userId,
        date,
      });
    }
    return null;
  },
});

/** Cron entry point at 04:30 UTC daily — refreshes baselines + tier for
 *  every connected user. */
export const scheduleNightlyBaselines = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    const userIds: Array<Id<"users">> = await ctx.runQuery(
      internal.health._listConnectedUserIds,
    );
    for (const userId of userIds) {
      await ctx.scheduler.runAfter(0, internal.health.computeBaselines, {
        userId,
      });
    }
    return null;
  },
});
