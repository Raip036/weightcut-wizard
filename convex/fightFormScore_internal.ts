import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { CURRENT_CONFIG } from "../src/scoring/config";
import type { HealthSignal, HealthSignals, ScoringInputSources } from "../src/scoring/types";

/**
 * Metric strings written by `internal.health.computeBaselines` (spec §5.1).
 * Centralised here so a typo can't silently produce a null baseline.
 */
const HEALTH_METRIC = {
  hrv: "hrv_sdnn",
  restingHr: "resting_hr",
  sleepTotal: "sleep_total",
  sleepEfficiency: "sleep_efficiency",
  wristTempDelta: "wrist_temp_delta",
  vo2Max: "vo2_max",
} as const;

/**
 * Confidence floor based on how many days of history backed the baseline.
 * Mirrors the tier thresholds in spec §6: ≥7 days → full confidence,
 * 3–6 days → partial, <3 days → unknown baseline (we still surface the
 * raw value but flag z as null so the engine doesn't react).
 */
function confidenceForSampleCount(sampleCount: number): number {
  if (sampleCount >= 7) return 1.0;
  if (sampleCount >= 3) return 0.6;
  if (sampleCount >= 1) return 0.3;
  return 0.0;
}

/**
 * Compose a `HealthSignal` from today's value + the matching baseline row.
 * Clips deviationZ to [-3, 3] (the engine assumes clipped z) and degrades
 * gracefully when either operand is missing.
 *
 * For wrist-temp delta we treat `value` as the deviation itself (HealthKit
 * pre-computes it against the user's 30-day baseline) — pass `treatValueAsDeviation`
 * to skip the baseline-vs-value subtraction.
 */
function buildSignal(
  value: number | null | undefined,
  baseline: { rolling14dMean: number; rolling14dStdDev: number; sampleCount: number } | null,
  options: { treatValueAsDeviation?: boolean } = {},
): HealthSignal {
  if (value === null || value === undefined) {
    return { value: null, baseline: null, deviationZ: null, confidence: 0 };
  }

  // Wrist temp: value IS the deviation, baseline is 0 by definition.
  if (options.treatValueAsDeviation) {
    return {
      value,
      baseline: 0,
      deviationZ: Math.max(-3, Math.min(3, value)),
      // Wrist temp has no rolling baseline (HealthKit owns it); trust the
      // sample directly with full confidence whenever a value exists.
      confidence: 1.0,
    };
  }

  if (!baseline || baseline.rolling14dStdDev <= 0) {
    return {
      value,
      baseline: baseline?.rolling14dMean ?? null,
      deviationZ: null,
      confidence: confidenceForSampleCount(baseline?.sampleCount ?? 0),
    };
  }

  const rawZ = (value - baseline.rolling14dMean) / baseline.rolling14dStdDev;
  return {
    value,
    baseline: baseline.rolling14dMean,
    deviationZ: Math.max(-3, Math.min(3, rawZ)),
    confidence: confidenceForSampleCount(baseline.sampleCount),
  };
}

/**
 * Build the full `HealthSignals` bundle for a given user/date. Returns
 * `null` when the user has no `daily_health_summary` row for the target
 * date — the engine then falls back to the pre-HealthKit self-report
 * path and behaviour is identical to today.
 */
type BaselineRow = {
  rolling14dMean: number;
  rolling14dStdDev: number;
  sampleCount: number;
};

function assembleHealthSignals(
  summary: {
    hrvAvgMs?: number;
    restingHrBpm?: number;
    sleepMinutes?: number;
    sleepEfficiencyPct?: number;
    wristTempDeltaC?: number;
    vo2Max?: number;
  } | null,
  baselineByMetric: Map<string, BaselineRow>,
): HealthSignals | null {
  if (summary === null) return null;
  return {
    hrv: buildSignal(summary.hrvAvgMs ?? null, baselineByMetric.get(HEALTH_METRIC.hrv) ?? null),
    restingHr: buildSignal(summary.restingHrBpm ?? null, baselineByMetric.get(HEALTH_METRIC.restingHr) ?? null),
    sleepMinutes: buildSignal(summary.sleepMinutes ?? null, baselineByMetric.get(HEALTH_METRIC.sleepTotal) ?? null),
    sleepEfficiency: buildSignal(summary.sleepEfficiencyPct ?? null, baselineByMetric.get(HEALTH_METRIC.sleepEfficiency) ?? null),
    wristTempDelta: buildSignal(summary.wristTempDeltaC ?? null, null, { treatValueAsDeviation: true }),
    vo2Max: buildSignal(summary.vo2Max ?? null, baselineByMetric.get(HEALTH_METRIC.vo2Max) ?? null),
  };
}

export const fetchScoringInputs = internalQuery({
  args: { userId: v.id("users"), date: v.string() },
  handler: async (ctx, { userId, date }) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const end = new Date(date + "T00:00:00Z");
    const lookbackStart = new Date(end);
    lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 28);
    const lookbackStartIso = lookbackStart.toISOString().slice(0, 10);

    const weights = await ctx.db
      .query("weight_logs")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", lookbackStartIso))
      .collect();
    const sleep = await ctx.db
      .query("sleep_logs")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", lookbackStartIso))
      .collect();
    const sessions = await ctx.db
      .query("gym_sessions")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", lookbackStartIso))
      .collect();
    // Mirrors the union used in `loggedTodayBundle` so the assumed-sleep
    // rescue (below) fires whether the user logged via the GymTracker
    // (gym_sessions) or the fight-camp calendar.
    const calendarEntries = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", lookbackStartIso))
      .collect();
    const wellness = await ctx.db
      .query("daily_wellness_checkins")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", lookbackStartIso))
      .collect();

    // HealthKit-derived signals (Agent B owns these tables).
    // We fetch the FULL lookback window of `daily_health_summary` rows
    // (not just the target date) because sleep / body-mass values from
    // HealthKit need to win over manual logs on a *per-date* basis, not
    // only for today. The single row for the target date is then pulled
    // out for `assembleHealthSignals` (which still drives recovery).
    const healthSummaryRows = await ctx.db
      .query("daily_health_summary")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", lookbackStartIso))
      .collect();
    const healthSummaryRow = healthSummaryRows.find((r) => r.date === date) ?? null;
    const healthBaselineRows = await ctx.db
      .query("health_baselines")
      .withIndex("by_user_metric", (q) => q.eq("userId", userId))
      .collect();
    const baselineByMetric = new Map<string, BaselineRow>();
    for (const row of healthBaselineRows) {
      baselineByMetric.set(row.metric, {
        rolling14dMean: row.rolling14dMean,
        rolling14dStdDev: row.rolling14dStdDev,
        sampleCount: row.sampleCount,
      });
    }
    const healthSignals = assembleHealthSignals(
      healthSummaryRow
        ? {
            hrvAvgMs: healthSummaryRow.hrvAvgMs,
            restingHrBpm: healthSummaryRow.restingHrBpm,
            sleepMinutes: healthSummaryRow.sleepMinutes,
            sleepEfficiencyPct: healthSummaryRow.sleepEfficiencyPct,
            wristTempDeltaC: healthSummaryRow.wristTempDeltaC,
            vo2Max: healthSummaryRow.vo2Max,
          }
        : null,
      baselineByMetric,
    );

    // Self-report soreness/energy from the morning check-in for the
    // target date — augments (not replaces) the HealthKit signals.
    const todayCheckIn = wellness.find((w) => w.date === date);
    const selfReportRecovery = todayCheckIn
      ? {
          // `sorenessLevel` is on a 1..10 scale; `energyLevel` likewise.
          soreness: todayCheckIn.sorenessLevel ?? null,
          energy: todayCheckIn.energyLevel ?? null,
        }
      : null;
    const meals = await ctx.db
      .query("meals")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", lookbackStartIso))
      .collect();

    // Aggregate meals by day (cal + protein from meal_items)
    const mealsByDay = new Map<string, { date: string; calories: number; proteinG: number }>();
    for (const m of meals) {
      const items = await ctx.db
        .query("meal_items")
        .withIndex("by_meal", (q) => q.eq("mealId", m._id))
        .collect();
      const cal = items.reduce((a, x) => a + (x.calories ?? 0), 0);
      const pro = items.reduce((a, x) => a + (x.proteinG ?? 0), 0);
      const cur = mealsByDay.get(m.date) ?? { date: m.date, calories: 0, proteinG: 0 };
      cur.calories += cal;
      cur.proteinG += pro;
      mealsByDay.set(m.date, cur);
    }

    // Prior raw scores for EMA (last 3 days before target)
    const priorEnd = new Date(end); priorEnd.setUTCDate(priorEnd.getUTCDate() - 1);
    const priorStart = new Date(priorEnd); priorStart.setUTCDate(priorStart.getUTCDate() - 2);
    const priorRaw = await ctx.db
      .query("fight_form_scores")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId)
         .gte("date", priorStart.toISOString().slice(0, 10))
         .lte("date", priorEnd.toISOString().slice(0, 10)),
      )
      .collect();

    // Prior ceilings for latching: any fired safety cap within the latch
    // cooldown window before the target date. The engine holds such a cap
    // when its governing pillar is stale (anti-gaming), and releases it only
    // when fresh data clears the rule. Row `date` IS the fired date.
    const ceilLookback = new Date(end);
    ceilLookback.setUTCDate(ceilLookback.getUTCDate() - CURRENT_CONFIG.confidence.ceilingCooldownDays);
    const ceilStart = ceilLookback.toISOString().slice(0, 10);
    const priorBeforeToday = new Date(end);
    priorBeforeToday.setUTCDate(priorBeforeToday.getUTCDate() - 1);
    const ceilEnd = priorBeforeToday.toISOString().slice(0, 10);
    const priorCeilingRows = await ctx.db
      .query("fight_form_scores")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", ceilStart).lte("date", ceilEnd),
      )
      .collect();
    const priorCeilings = priorCeilingRows
      .filter((r) => r.appliedCeiling != null)
      .map((r) => ({ date: r.date, ruleId: r.appliedCeiling!.ruleId, cap: r.appliedCeiling!.cap }));

    // HealthKit precedence: per-date overrides for sleep hours + body
    // mass. When `daily_health_summary` has a usable value for a given
    // date, it WINS over the matching manual `sleep_logs` / `weight_logs`
    // row — manual is the fallback. We guard on `> 0` (not just non-null)
    // because the roll-up can write a 0 for "no samples that day" and
    // we don't want a phantom 0h sleep / 0kg weigh-in to clobber a real
    // manual entry. The `sources` map records which source the engine
    // ended up consuming per date for downstream debugging / UI badges.
    const healthSleepByDate = new Map<string, number>();   // date -> hours
    const healthWeightByDate = new Map<string, number>();  // date -> kg
    for (const row of healthSummaryRows) {
      if (row.sleepMinutes != null && row.sleepMinutes > 0) {
        healthSleepByDate.set(row.date, row.sleepMinutes / 60);
      }
      if (row.bodyMassKg != null && row.bodyMassKg > 0) {
        healthWeightByDate.set(row.date, row.bodyMassKg);
      }
    }

    const sleepDatesUnion = new Set<string>([
      ...sleep.map((s) => s.date),
      ...healthSleepByDate.keys(),
    ]);
    const sleepHoursByDateSource: Record<string, "healthkit" | "manual"> = {};
    const mergedSleep: Array<{ date: string; hours: number }> = [];
    for (const d of sleepDatesUnion) {
      const hk = healthSleepByDate.get(d);
      if (hk != null) {
        mergedSleep.push({ date: d, hours: hk });
        sleepHoursByDateSource[d] = "healthkit";
      } else {
        const manual = sleep.find((s) => s.date === d);
        if (manual) {
          mergedSleep.push({ date: d, hours: manual.hours });
          sleepHoursByDateSource[d] = "manual";
        }
      }
    }

    const weightDatesUnion = new Set<string>([
      ...weights.map((w) => w.date),
      ...healthWeightByDate.keys(),
    ]);
    const weightsByDateSource: Record<string, "healthkit" | "manual"> = {};
    const mergedWeights: Array<{ date: string; weightKg: number }> = [];
    for (const d of weightDatesUnion) {
      const hk = healthWeightByDate.get(d);
      if (hk != null) {
        mergedWeights.push({ date: d, weightKg: hk });
        weightsByDateSource[d] = "healthkit";
      } else {
        const manual = weights.find((w) => w.date === d);
        if (manual) {
          mergedWeights.push({ date: d, weightKg: manual.weightKg });
          weightsByDateSource[d] = "manual";
        }
      }
    }

    // "Forgot to log sleep" rescue: if the user has no sleep entry for
    // the target date (HK or manual) but logged a meaningful training
    // session that day (≥ N minutes, where N is tunable in
    // ScoringConfig), inject a default sleep entry so the score isn't
    // penalised for a missing log. The assumption is NOT written to
    // `sleep_logs` — when the user later enters their real hours, the
    // standard upsert + scheduled recompute (see convex/sleep_logs.ts)
    // overrides the assumption cleanly.
    const minDuration = CURRENT_CONFIG.sleep.minTrainingDurationForAssumption;
    const hasSleepForTargetDate = mergedSleep.some((s) => s.date === date);
    const meaningfulGym = sessions.some(
      (s) =>
        s.date === date &&
        s.status === "completed" &&
        (s.durationMinutes ?? 0) >= minDuration,
    );
    const meaningfulCalendar = calendarEntries.some(
      (c) =>
        c.date === date &&
        (c.sessionType ?? "").toLowerCase() !== "rest" &&
        (c.durationMinutes ?? 0) >= minDuration,
    );
    const trainedToday = meaningfulGym || meaningfulCalendar;
    const sleepLogsForScoring = [...mergedSleep];
    const assumedSleepDates: string[] = [];
    if (!hasSleepForTargetDate && trainedToday) {
      sleepLogsForScoring.push({ date, hours: CURRENT_CONFIG.sleep.defaultAssumedHours });
      assumedSleepDates.push(date);
      // Assumed entries are server-injected, not from any user source;
      // bucket them under 'manual' so the UI doesn't claim "from Apple
      // Health" for a fallback we generated.
      sleepHoursByDateSource[date] = "manual";
    }

    const sortedMergedWeights = [...mergedWeights].sort((a, b) => a.date.localeCompare(b.date));
    const latestMergedWeight = sortedMergedWeights[sortedMergedWeights.length - 1] ?? null;
    const sources: ScoringInputSources = {
      sleepHoursByDate: sleepHoursByDateSource,
      weightsByDate: weightsByDateSource,
      weightLatest: latestMergedWeight ? weightsByDateSource[latestMergedWeight.date] ?? "manual" : null,
      sleepHoursTargetDate: sleepHoursByDateSource[date] ?? null,
    };

    // Explicitly-marked rest days within the lookback window. Reuses the
    // `calendarEntries` fetch above (also used by the assumed-sleep rescue)
    // to avoid a second round-trip to `fight_camp_calendar`. Rest days don't
    // contribute load (so ACWR math is untouched) but they let the engine
    // distinguish planned 0-load days from missing data — see
    // `computeTrainingLoad`'s cold-start gate.
    const restDays = calendarEntries
      .filter((c) => (c.sessionType ?? "").toLowerCase() === "rest")
      .map((c) => c.date);

    return {
      date,
      profile,
      weights: mergedWeights,
      sleepHours: sleepLogsForScoring,
      assumedSleepDates,
      sources,
      // gym_sessions has no session-level `rpe`; use `perceivedFatigue` as proxy.
      sessions: sessions
        .filter((s) => s.durationMinutes != null && s.perceivedFatigue != null)
        .map((s) => ({ date: s.date, rpe: s.perceivedFatigue!, durationMinutes: s.durationMinutes! })),
      restDays,
      hooperByDate: wellness
        .filter((w) => w.hooperIndex != null)
        .map((w) => ({ date: w.date, hooper: w.hooperIndex! })),
      meals: Array.from(mealsByDay.values()),
      priorRawScores: priorRaw.map((p) => ({ date: p.date, rawScore: p.rawScore })),
      priorCeilings,
      healthSignals,
      selfReportRecovery,
    };
  },
});

export const upsertScore = internalMutation({
  args: {
    userId: v.id("users"),
    date: v.string(),
    campId: v.optional(v.id("fight_camps")),
    score: v.any(),
  },
  handler: async (ctx, { userId, date, campId, score }) => {
    const existing = await ctx.db
      .query("fight_form_scores")
      .withIndex("by_user_date_version", (q) =>
        q.eq("userId", userId).eq("date", date).eq("algorithmVersion", score.algorithmVersion),
      )
      .first();
    const row = {
      userId,
      date,
      campId,
      rawScore: score.rawScore,
      displayedScore: score.score,
      label: score.label,
      state: score.state,
      phase: score.phase ?? undefined,
      subScores: score.subScores,
      appliedCeiling: score.appliedCeiling ?? undefined,
      dataConfidence: score.dataConfidence,
      dataAgeDays: score.dataAgeDays,
      activePillars: score.activePillars,
      totalPillars: score.totalPillars,
      formMomentum: score.formMomentum,
      campAge: score.campAge ?? undefined,
      topDriver: score.topDriver,
      topLimiter: score.topLimiter,
      algorithmVersion: score.algorithmVersion,
      computedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, row);
      return existing._id;
    }
    return await ctx.db.insert("fight_form_scores", row);
  },
});

/**
 * Returns the userIds of every profile that has a target date set.
 * The fight camp is now derived from `profiles.targetDate` (the date the
 * user is walking towards) plus the earliest weight log, so anyone with a
 * profile is in scope. Previously this scanned the `fight_camps` table.
 */
export const listActiveCampUserIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<Id<"users">>> => {
    const profiles = await ctx.db.query("profiles").collect();
    return profiles
      .filter((p) => typeof p.targetDate === "string" && p.targetDate.length > 0)
      .map((p) => p.userId);
  },
});
