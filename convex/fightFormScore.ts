import { v } from "convex/values";
import { query, internalAction, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { optionalUserId, requireUserId } from "./lib/auth";
import { computeFightFormScore } from "../src/scoring/compose";
import { CURRENT_CONFIG } from "../src/scoring/config";

function todayInUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export const getToday = query({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const userId = await optionalUserId(ctx);
    if (!userId) return null;
    const targetDate = date ?? todayInUtc();
    const row = await ctx.db
      .query("fight_form_scores")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", targetDate))
      .order("desc")
      .first();
    if (row) return row;

    // Synthesize calibrating fallback (no row written).
    return {
      date: targetDate,
      displayedScore: 0,
      rawScore: 0,
      label: "off_pace" as const,
      state: "calibrating" as const,
      phase: null,
      campAge: null,
      subScores: null,
      appliedCeiling: null,
      topDriver: null,
      topLimiter: null,
      algorithmVersion: "1.0.0",
    };
  },
});

/**
 * Returns four booleans for whether the authenticated user has logged each
 * core daily input today (or for the supplied `date`). Used by the new
 * dashboard `TodayPanel` to render its adherence dots without firing four
 * separate `useQuery` hooks. Returns `null` when unauthenticated so callers
 * can fall back to optimistic state.
 */
export const loggedTodayBundle = query({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const userId = await optionalUserId(ctx);
    if (!userId) return null;
    const targetDate = date ?? todayInUtc();

    const weight = await ctx.db
      .query("weight_logs")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", targetDate))
      .first();
    const sleep = await ctx.db
      .query("sleep_logs")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", targetDate))
      .first();
    const wellnessCheckin = await ctx.db
      .query("daily_wellness_checkins")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", targetDate))
      .first();
    // Training counts as "done" when EITHER (a) there's a completed
    // `gym_sessions` row, OR (b) there's a non-Rest `fight_camp_calendar`
    // entry for the date. The latter is the TrainingCalendar/fight-camp
    // page's primary write surface — without it, logging from that page
    // wouldn't flip the dashboard's training tick.
    const sessions = await ctx.db
      .query("gym_sessions")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", targetDate))
      .collect();
    const calendarEntries = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", targetDate))
      .collect();
    const training =
      sessions.some((s) => s.status === "completed") ||
      calendarEntries.some((c) => (c.sessionType ?? "").toLowerCase() !== "rest");

    return {
      weight: weight != null,
      sleep: sleep != null,
      training,
      wellnessCheckin: wellnessCheckin != null,
    };
  },
});

/**
 * Per-source 7-day logging breakdown + overall unlock progress for the
 * dashboard's Fight Form insight strip. Mirrors the cold-start gate used by
 * `computeFightFormScore` (`daysOfData < cfg.coldStart.minDaysOfDataIn7d`)
 * so the displayed numerator and threshold match when the score actually
 * unlocks. `perSource` is bucketed to the trailing 7 calendar days because
 * a 28-day-wide "X of 28 nights logged" reads as useless to a user.
 */
export const calibrationProgress = query({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const userId = await optionalUserId(ctx);
    if (!userId) return null;
    const targetDate = date ?? todayInUtc();
    const end = new Date(targetDate + "T00:00:00Z");

    const sevenStart = new Date(end);
    sevenStart.setUTCDate(sevenStart.getUTCDate() - 6);
    const sevenStartIso = sevenStart.toISOString().slice(0, 10);

    // Match the lookback window in `fightFormScore_internal.fetchScoringInputs`
    // so `daysWithAnyLog` lines up with the engine's `countDistinctDaysOfData`.
    const lookback = new Date(end);
    lookback.setUTCDate(lookback.getUTCDate() - 28);
    const lookbackIso = lookback.toISOString().slice(0, 10);

    const [weights, sleep, sessions, wellness, meals] = await Promise.all([
      ctx.db
        .query("weight_logs")
        .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", lookbackIso))
        .collect(),
      ctx.db
        .query("sleep_logs")
        .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", lookbackIso))
        .collect(),
      ctx.db
        .query("gym_sessions")
        .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", lookbackIso))
        .collect(),
      ctx.db
        .query("daily_wellness_checkins")
        .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", lookbackIso))
        .collect(),
      ctx.db
        .query("meals")
        .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", lookbackIso))
        .collect(),
    ]);

    const completedSessions = sessions.filter((s) => s.status === "completed");

    const inWindow7 = (d: string) => d >= sevenStartIso && d <= targetDate;
    const distinctIn7 = (rows: ReadonlyArray<{ date: string }>) =>
      new Set(rows.filter((r) => inWindow7(r.date)).map((r) => r.date)).size;

    const perSource = {
      sleep: distinctIn7(sleep),
      weight: distinctIn7(weights),
      training: distinctIn7(completedSessions),
      wellness: distinctIn7(wellness),
      nutrition: distinctIn7(meals),
    };

    // Union of distinct logged dates across all five sources within the
    // engine's lookback window — drives `unlocked` so it flips at the same
    // moment compose.ts stops returning `state: "calibrating"`.
    const unionDays = new Set<string>();
    for (const r of weights) unionDays.add(r.date);
    for (const r of sleep) unionDays.add(r.date);
    for (const r of completedSessions) unionDays.add(r.date);
    for (const r of wellness) unionDays.add(r.date);
    for (const r of meals) unionDays.add(r.date);
    const daysWithAnyLog = unionDays.size;
    const daysNeeded = CURRENT_CONFIG.coldStart.minDaysOfDataIn7d;

    return {
      daysWithAnyLog,
      daysNeeded,
      unlocked: daysWithAnyLog >= daysNeeded,
      perSource,
    };
  },
});

/**
 * Day-over-day delta for the dashboard's proactive callout. Returns `null`
 * for the unauthenticated case and a stable shape otherwise so the client
 * can decide whether to render the banner without a second round-trip.
 *
 * `yesterdayScore` may be null even for active users when the daily cron
 * hasn't yet written a row for the prior date or when the score was still
 * calibrating yesterday — both cases collapse to "no banner".
 */
export const getDeltaInfo = query({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const userId = await optionalUserId(ctx);
    if (!userId) return null;
    const targetDate = date ?? todayInUtc();

    const today = await ctx.db
      .query("fight_form_scores")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", targetDate))
      .first();
    if (!today || today.state !== "ok") {
      return { yesterdayScore: null, todayScore: null, delta: null };
    }

    const y = new Date(targetDate + "T00:00:00Z");
    y.setUTCDate(y.getUTCDate() - 1);
    const yesterdayIso = y.toISOString().slice(0, 10);

    const yesterday = await ctx.db
      .query("fight_form_scores")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", yesterdayIso))
      .first();

    if (!yesterday || yesterday.state !== "ok") {
      return { yesterdayScore: null, todayScore: today.displayedScore, delta: null };
    }

    return {
      yesterdayScore: yesterday.displayedScore,
      todayScore: today.displayedScore,
      delta: today.displayedScore - yesterday.displayedScore,
    };
  },
});

/**
 * Last 14 days of computed Fight Form scores for the dashboard's mini-trend
 * sparkline. Unlike `getHistory` (which requires a `campId`), this is keyed
 * by user + date range so it works with the camp-less flow where the score
 * is derived from `profiles.targetDate` rather than a `fight_camps` row.
 * Returns rows ascending by date so callers can render directly into an SVG
 * path without re-sorting.
 */
export const getRecentScores = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const userId = await optionalUserId(ctx);
    if (!userId) return [];
    const span = days ?? 14;
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (span - 1));
    const startIso = start.toISOString().slice(0, 10);
    const endIso = end.toISOString().slice(0, 10);

    const rows = await ctx.db
      .query("fight_form_scores")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", startIso).lte("date", endIso),
      )
      .collect();

    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows.map((r) => ({
      date: r.date,
      score: r.displayedScore,
      state: r.state,
    }));
  },
});

export const getHistory = query({
  args: { campId: v.id("fight_camps"), limit: v.optional(v.number()) },
  handler: async (ctx, { campId, limit }) => {
    const userId = await optionalUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("fight_form_scores")
      .withIndex("by_user_camp", (q) => q.eq("userId", userId).eq("campId", campId))
      .order("desc")
      .take(limit ?? 60);
    return rows;
  },
});

export const recomputeForUserDate = internalAction({
  args: { userId: v.id("users"), date: v.string() },
  handler: async (ctx, { userId, date }) => {
    const inputs = await ctx.runQuery(internal.fightFormScore_internal.fetchScoringInputs, { userId, date });

    // The fight camp is derived from the user's profile rather than a
    // separate fight_camps row: `profile.targetDate` is the fight date,
    // `profile.goalWeightKg` is the goal, and the earliest weight log is
    // both the starting weight and the camp start date. When the user
    // edits their target date in the Goals page, the next debounced
    // recompute picks it up automatically (Convex queries are reactive).
    const sortedWeights = [...inputs.weights].sort((a, b) => a.date.localeCompare(b.date));
    const earliestWeight = sortedWeights[0] ?? null;
    const latestWeight = sortedWeights[sortedWeights.length - 1] ?? null;

    const fightDate = inputs.profile?.targetDate ?? null;
    const goalWeightKg = inputs.profile?.goalWeightKg ?? null;
    const startingWeightKg = earliestWeight?.weightKg ?? inputs.profile?.currentWeightKg ?? null;
    // Camp starts at the first logged weight. If the user hasn't logged a
    // weight yet, treat today as the camp start so we don't block scoring
    // on the very first day.
    const campStartDate = earliestWeight?.date ?? date;
    const currentWeightKg = latestWeight?.weightKg ?? inputs.profile?.currentWeightKg ?? null;

    const scoringInputs = {
      date,
      fightDate,
      campStartDate,
      startingWeightKg,
      goalWeightKg,
      currentWeightKg,
      isCampPaused: false,
      isCampCompleted: false,
      sessions: inputs.sessions,
      sleepHours: inputs.sleepHours,
      assumedSleepDates: inputs.assumedSleepDates,
      weights: inputs.weights,
      hooperByDate: inputs.hooperByDate,
      meals: inputs.meals,
      targets: {
        calories: inputs.profile?.aiRecommendedCalories ?? null,
        proteinG: inputs.profile?.aiRecommendedProteinG ?? null,
      },
      priorRawScores: inputs.priorRawScores,
      // HealthKit-derived signals (HRV, RHR, sleep, wrist temp, VO2max)
      // assembled by `fetchScoringInputs`; drives the `recovery` sub-score.
      healthSignals: inputs.healthSignals,
      // Morning check-in soreness/energy — augments recovery.
      selfReportRecovery: inputs.selfReportRecovery,
      // Per-input provenance — recorded by `fetchScoringInputs` based on
      // which table (HealthKit `daily_health_summary` vs. manual
      // `sleep_logs` / `weight_logs`) won the merge for each date.
      sources: inputs.sources,
    };
    const score = computeFightFormScore(scoringInputs, CURRENT_CONFIG);
    await ctx.runMutation(internal.fightFormScore_internal.upsertScore, {
      userId,
      date,
      campId: undefined,
      score,
    });
    return score;
  },
});

export const recomputeNow = mutation({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const userId = await requireUserId(ctx);
    const target = date ?? new Date().toISOString().slice(0, 10);
    await ctx.scheduler.runAfter(0, internal.fightFormScore.recomputeForUserDate, {
      userId,
      date: target,
    });
  },
});

export const scheduleDailyRecomputeAcrossUsers = internalAction({
  args: {},
  handler: async (ctx) => {
    // Hourly fan-out: v1 simplification, only actually run at UTC 04:00.
    // A proper timezone-aware fan-out is a follow-up.
    const nowUtcHour = new Date().getUTCHours();
    if (nowUtcHour !== 4) return;
    const userIds = await ctx.runQuery(internal.fightFormScore_internal.listActiveCampUserIds, {});
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const date = yesterday.toISOString().slice(0, 10);
    for (const userId of userIds) {
      await ctx.runAction(internal.fightFormScore.recomputeForUserDate, { userId, date });
    }
  },
});

export const backfillLast30Days = internalAction({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, { userId }) => {
    const ids: any[] = userId
      ? [userId]
      : await ctx.runQuery(internal.fightFormScore_internal.listActiveCampUserIds, {});
    for (const id of ids) {
      for (let i = 0; i < 30; i++) {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - i);
        const date = d.toISOString().slice(0, 10);
        await ctx.runAction(internal.fightFormScore.recomputeForUserDate, { userId: id, date });
      }
    }
  },
});
