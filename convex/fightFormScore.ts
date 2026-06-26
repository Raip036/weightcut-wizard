import { v } from "convex/values";
import { query, internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
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
      dataConfidence: 0,
      dataAgeDays: 0,
      activePillars: 0,
      totalPillars: 0,
      formMomentum: 0,
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
    // Training counts as "done" when ANY of the following exists for the
    // date:
    //   (a) a completed `gym_sessions` row,
    //   (b) any `fight_camp_calendar` entry — INCLUDING rest days. A
    //       marked rest day is a deliberate logging action ("I'm taking
    //       today off"), so it should tick the training chip the same
    //       way a workout entry does. The scoring engine still treats
    //       rest days as 0-load via the gym_sessions path; this query
    //       only governs the daily-ritual UI.
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
      calendarEntries.length > 0;

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
 *
 * Filters must match src/scoring/compose.ts countDistinctDaysOfData — this
 * is the single source of truth surfaced to the UI. The engine drops rows
 * that lack the signals it actually consumes (gym_sessions without both
 * durationMinutes + perceivedFatigue, wellness without hooperIndex); we
 * apply the same filters before counting distinct dates so the UI's
 * "Day N of N — unlocked" decision lines up with the engine's
 * `state === "ok"` decision.
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

    // Engine-aligned filters. compose.ts:countDistinctDaysOfData only counts
    // dates that survive these filters (the engine drops sessions missing
    // durationMinutes or perceivedFatigue, and wellness rows missing
    // hooperIndex, in fightFormScore_internal.fetchScoringInputs). We do NOT
    // re-apply `status === "completed"` here — match the engine, which
    // doesn't filter on status either.
    const engineSessions = sessions.filter(
      (s) => s.durationMinutes != null && s.perceivedFatigue != null,
    );
    const engineWellness = wellness.filter((w) => w.hooperIndex != null);

    const inWindow7 = (d: string) => d >= sevenStartIso && d <= targetDate;
    const distinctIn7 = (rows: ReadonlyArray<{ date: string }>) =>
      new Set(rows.filter((r) => inWindow7(r.date)).map((r) => r.date)).size;

    const perSource = {
      sleep: distinctIn7(sleep),
      weight: distinctIn7(weights),
      training: distinctIn7(engineSessions),
      wellness: distinctIn7(engineWellness),
      nutrition: distinctIn7(meals),
    };

    // Union of distinct logged dates across all five sources within the
    // engine's lookback window — drives `unlocked` so it flips at the same
    // moment compose.ts stops returning `state: "calibrating"`.
    const unionDays = new Set<string>();
    for (const r of weights) unionDays.add(r.date);
    for (const r of sleep) unionDays.add(r.date);
    for (const r of engineSessions) unionDays.add(r.date);
    for (const r of engineWellness) unionDays.add(r.date);
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
 * Trailing 7-day completeness meter for the weekly adherence strip.
 * Returns one entry per day (oldest → newest) with per-pillar logged flags,
 * a count out of 5, and a status: "full" | "partial" | "none" | "rest".
 * A lone rest entry (or marked skip) with no real logs → "rest" (count 0),
 * NOT partial.
 */
export const weeklyCompleteness = query({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const userId = await optionalUserId(ctx);
    if (!userId) return null;
    const targetDate = date ?? todayInUtc();
    const end = new Date(targetDate + "T00:00:00Z");
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    const startIso = start.toISOString().slice(0, 10);

    const [weights, sleep, wellness, sessions, calendar, meals, skips] = await Promise.all([
      ctx.db.query("weight_logs").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("sleep_logs").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("daily_wellness_checkins").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("gym_sessions").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("fight_camp_calendar").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("meals").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("marked_skips").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
    ]);

    const has = (rows: Array<{ date: string }>, d: string) => rows.some((r) => r.date === d);
    const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const dd = new Date(end);
      dd.setUTCDate(dd.getUTCDate() - i);
      const d = dd.toISOString().slice(0, 10);

      const restEntry = calendar.some((c) => c.date === d && (c.sessionType ?? "").toLowerCase() === "rest");
      const realSession =
        sessions.some((s) => s.date === d && s.status === "completed") ||
        calendar.some((c) => c.date === d && (c.sessionType ?? "").toLowerCase() !== "rest");
      const logged = {
        weight: has(weights, d),
        // A logged rest day satisfies the training pillar — resting is part of
        // the plan, so a rest day with everything else logged can reach "full".
        training: realSession || restEntry,
        sleep: has(sleep, d),
        wellness: has(wellness, d),
        meals: has(meals, d),
      };
      const count = Object.values(logged).filter(Boolean).length;
      const skipped = has(skips, d);

      let status: "full" | "partial" | "none" | "rest";
      // A rest/skip day reads as "rest" unless it's a fully-logged ritual day:
      // the whole day is rest, so it shouldn't show as a "partial" training day.
      if (count === 5) status = "full";
      else if (restEntry || skipped) status = "rest";
      else if (count > 0) status = "partial";
      else status = "none";

      days.push({ date: d, weekday: WEEKDAYS[dd.getUTCDay()], logged, count, total: 5, status });
    }
    return days;
  },
});

/**
 * Distinct dates within the last `windowDays` (default 28) where the user
 * lit up ALL FIVE of the dashboard TodayStrip ritual pills (weight, sleep,
 * training, wellness check-in, and a meal with calorie content). Used by
 * the dashboard ring to fire the "Day N completed" animation only on days
 * where the full ritual was completed — independent of the engine's
 * calibration count, which only requires ANY one signal per day.
 *
 * Trade-off (documented inline): the meals pill counts any `meals` row,
 * not "meals with calorie-bearing items". This matches the TodayStrip's
 * coarse-grained semantics elsewhere (`mealsLoggedToday = todayCalories > 0`
 * relies on `meals.listWithTotals` aggregating items per meal); doing the
 * full meal_items join here would add a per-row query and isn't worth the
 * accuracy gain for a UI counter. Empty meals are rare in practice.
 *
 * Training pill semantics mirror `loggedTodayBundle` above: a completed
 * `gym_sessions` row OR any `fight_camp_calendar` entry (rest days
 * included).
 */
export const fullRitualDaysCount = query({
  args: {
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, { from, to }) => {
    const userId = await optionalUserId(ctx);
    if (!userId) return null;

    const endIso = to ?? todayInUtc();
    let startIso = from;
    if (!startIso) {
      const end = new Date(endIso + "T00:00:00Z");
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - 27); // inclusive 28-day window
      startIso = start.toISOString().slice(0, 10);
    }

    const [weights, sleep, sessions, calendar, wellness, meals] = await Promise.all([
      ctx.db
        .query("weight_logs")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).gte("date", startIso).lte("date", endIso),
        )
        .collect(),
      ctx.db
        .query("sleep_logs")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).gte("date", startIso).lte("date", endIso),
        )
        .collect(),
      ctx.db
        .query("gym_sessions")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).gte("date", startIso).lte("date", endIso),
        )
        .collect(),
      ctx.db
        .query("fight_camp_calendar")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).gte("date", startIso).lte("date", endIso),
        )
        .collect(),
      ctx.db
        .query("daily_wellness_checkins")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).gte("date", startIso).lte("date", endIso),
        )
        .collect(),
      ctx.db
        .query("meals")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).gte("date", startIso).lte("date", endIso),
        )
        .collect(),
    ]);

    const weightDates = new Set(weights.map((w) => w.date));
    const sleepDates = new Set(sleep.map((s) => s.date));
    const trainingDates = new Set<string>();
    for (const s of sessions) if (s.status === "completed") trainingDates.add(s.date);
    // Any `fight_camp_calendar` entry counts, including rest days — see
    // `loggedTodayBundle` for the rationale. A marked rest day is a
    // deliberate logging action and should tick the training pill.
    for (const c of calendar) trainingDates.add(c.date);
    // Any wellness row counts for the pill — the Hooper-only requirement is
    // for the SCORE math, not for ritual completion.
    const wellnessDates = new Set(wellness.map((w) => w.date));
    // Any meals row counts (see trade-off note above).
    const mealDates = new Set(meals.map((m) => m.date));

    // Intersection across all five sets.
    let candidates: Set<string> = weightDates;
    for (const next of [sleepDates, trainingDates, wellnessDates, mealDates]) {
      const reduced = new Set<string>();
      for (const d of candidates) if (next.has(d)) reduced.add(d);
      candidates = reduced;
      if (candidates.size === 0) break;
    }

    const sorted = Array.from(candidates).sort();
    const latestRitualDate = sorted.length > 0 ? sorted[sorted.length - 1] : null;

    return {
      total: candidates.size,
      latestRitualDate,
    };
  },
});

/**
 * Daily-ritual streak stats for the dashboard's gamified streak ring.
 *
 * A day "qualifies" toward the streak when the user either completes the
 * FULL daily ritual (all five pillars: weight, training, sleep, wellness,
 * meals) OR marks it as a rest/skip day — resting deliberately should never
 * break a streak. Partial days and untouched days break it. This mirrors
 * `weeklyCompleteness`'s pillar resolution (training = a completed
 * `gym_sessions` row OR a non-rest `fight_camp_calendar` entry; rest = a
 * rest calendar entry or an explicit `marked_skips` row).
 *
 * Returns:
 *   - `current`: consecutive qualifying days ending today, or — if today
 *     isn't done yet — ending yesterday (so an in-progress day never shows
 *     the streak as already broken).
 *   - `best`: longest qualifying run inside the lookback window.
 *   - `total`: total qualifying days inside the window.
 *   - `todayComplete`: whether today already qualifies (full ritual or rest).
 *
 * Bounded to a 180-day lookback so reads stay cheap; streaks longer than
 * that are clamped at the window edge (acceptable for a UI counter).
 */
export const streakStats = query({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const userId = await optionalUserId(ctx);
    if (!userId) return null;

    const WINDOW_DAYS = 180;
    const targetDate = date ?? todayInUtc();
    const end = new Date(targetDate + "T00:00:00Z");
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (WINDOW_DAYS - 1));
    const startIso = start.toISOString().slice(0, 10);

    const [weights, sleep, wellness, sessions, calendar, meals, skips] = await Promise.all([
      ctx.db.query("weight_logs").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("sleep_logs").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("daily_wellness_checkins").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("gym_sessions").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("fight_camp_calendar").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("meals").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("marked_skips").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
    ]);

    const setOf = (rows: Array<{ date: string }>) => new Set(rows.map((r) => r.date));
    const weightDates = setOf(weights);
    const sleepDates = setOf(sleep);
    const wellnessDates = setOf(wellness);
    const mealDates = setOf(meals);
    const skipDates = setOf(skips);
    const restDates = new Set(
      calendar.filter((c) => (c.sessionType ?? "").toLowerCase() === "rest").map((c) => c.date),
    );
    const trainingDates = new Set<string>();
    for (const s of sessions) if (s.status === "completed") trainingDates.add(s.date);
    for (const c of calendar) if ((c.sessionType ?? "").toLowerCase() !== "rest") trainingDates.add(c.date);

    // Build oldest → newest qualifying flags.
    const qualifies: boolean[] = [];
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      const dd = new Date(end);
      dd.setUTCDate(dd.getUTCDate() - i);
      const d = dd.toISOString().slice(0, 10);
      const isRest = restDates.has(d) || skipDates.has(d);
      const isFull =
        weightDates.has(d) &&
        trainingDates.has(d) &&
        sleepDates.has(d) &&
        wellnessDates.has(d) &&
        mealDates.has(d);
      qualifies.push(isRest || isFull);
    }

    // best + total over the window
    let best = 0;
    let run = 0;
    let total = 0;
    for (const q of qualifies) {
      if (q) {
        run += 1;
        total += 1;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }

    // current streak: walk back from today; if today isn't done, start from
    // yesterday so an unfinished day doesn't read as already broken.
    const todayComplete = qualifies[qualifies.length - 1] === true;
    let current = 0;
    let idx = qualifies.length - 1;
    if (!todayComplete) idx -= 1; // skip the in-progress day
    while (idx >= 0 && qualifies[idx]) {
      current += 1;
      idx -= 1;
    }

    return { current, best, total, todayComplete };
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

/**
 * Returns yesterday's sub-score VALUES (stripped of weight/reason) keyed by
 * sub-score id, so the FightFormScoreSheet can render `+N` / `−N` deltas
 * beside each tile without re-querying the full row. Returns `null` when
 * unauthenticated or when no row exists for yesterday (calibrating, gap
 * day) — callers should treat null as "no delta to show".
 *
 * Shape: `{ date: "YYYY-MM-DD", subScores: Record<string, number> } | null`.
 */
export const getYesterdaysSubScores = query({
  args: {},
  handler: async (ctx) => {
    const userId = await optionalUserId(ctx);
    if (!userId) return null;

    const y = new Date(todayInUtc() + "T00:00:00Z");
    y.setUTCDate(y.getUTCDate() - 1);
    const yesterdayIso = y.toISOString().slice(0, 10);

    const row = await ctx.db
      .query("fight_form_scores")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", yesterdayIso))
      .first();
    if (!row || !row.subScores) return null;

    const subScores: Record<string, number> = {};
    for (const [k, v] of Object.entries(row.subScores)) {
      subScores[k] = (v as { value: number }).value;
    }
    return { date: yesterdayIso, subScores };
  },
});

/**
 * Per-sub-score time series for the last `days` days (default 7, clamped
 * 2–30), sparkline-ready. Output is pivoted by sub-score id so the UI can
 * map directly to one sparkline per tile. Dates inside each series are
 * ascending; missing days are simply omitted (no null padding) so the
 * client can decide how to render gaps.
 *
 * Shape: `Record<string, Array<{ date: "YYYY-MM-DD", value: number }>>`.
 * For an unauthenticated viewer this returns `{}` (empty pivot).
 */
export const getSubScoreTrend = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const userId = await optionalUserId(ctx);
    if (!userId) return {} as Record<string, Array<{ date: string; value: number }>>;

    const n = Math.max(2, Math.min(30, days ?? 7));
    const endIso = todayInUtc();
    const start = new Date(endIso + "T00:00:00Z");
    start.setUTCDate(start.getUTCDate() - (n - 1));
    const startIso = start.toISOString().slice(0, 10);

    const rows = await ctx.db
      .query("fight_form_scores")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", startIso).lte("date", endIso),
      )
      .collect();

    rows.sort((a, b) => a.date.localeCompare(b.date));

    const series: Record<string, Array<{ date: string; value: number }>> = {};
    for (const row of rows) {
      if (!row.subScores) continue;
      for (const [k, v] of Object.entries(row.subScores)) {
        const value = (v as { value: number }).value;
        if (!series[k]) series[k] = [];
        series[k].push({ date: row.date, value });
      }
    }
    return series;
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
      // Parsed cut plan from `profiles.cutPlanJson`. Drives the new
      // weekly-plan adherence weightCut sub-score (replaces rate-of-loss).
      cutPlanJson: inputs.profile?.cutPlanJson ?? null,
      hooperByDate: inputs.hooperByDate,
      meals: inputs.meals,
      targets: {
        calories: inputs.profile?.aiRecommendedCalories ?? null,
        proteinG: inputs.profile?.aiRecommendedProteinG ?? null,
      },
      priorRawScores: inputs.priorRawScores,
      // Recently-applied ceilings, used by the engine to latch a fired safety
      // cap while its governing pillar is stale (anti-gaming).
      priorCeilings: inputs.priorCeilings,
      markedSkips: inputs.markedSkips,
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

// ───────────────────────────────────────────────────────────────────────
// Coalescing layer
// ───────────────────────────────────────────────────────────────────────
//
// Two mutations 100ms apart used to schedule two independent 5 s
// `recomputeForUserDate` runs, both of which ended up firing because there
// was nothing checking whether a later schedule had superseded the earlier
// one. The pattern below replaces direct `ctx.scheduler.runAfter(...,
// recomputeForUserDate, ...)` calls with a single `scheduleRecompute`
// upsert that records the *intended* fire time in
// `fight_form_recompute_pending`. The scheduled wrapper action
// (`coalescedRecompute`) reads that row when it runs and no-ops if a
// later schedule has pushed the fire time further out, leaving exactly
// one recompute per coalescing window.

const DEFAULT_RECOMPUTE_DELAY_MS = 1_200;

/**
 * Idempotent coalescer entry point. Called from every mutation that
 * changes scoring-relevant data; collapses bursts of writes onto a single
 * recompute. `delayMs` defaults to 1.2s.
 */
export const scheduleRecompute = internalMutation({
  args: {
    userId: v.id("users"),
    date: v.string(),
    delayMs: v.optional(v.number()),
  },
  handler: async (ctx, { userId, date, delayMs }) => {
    const delay = delayMs ?? DEFAULT_RECOMPUTE_DELAY_MS;
    const scheduledAt = Date.now() + delay;
    const existing = await ctx.db
      .query("fight_form_recompute_pending")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).eq("date", date),
      )
      .first();
    if (existing) {
      // Always push the fire time forward — the latest writer wins. The
      // earlier scheduled wrapper will read this row, see the later
      // `scheduledAt`, and no-op.
      await ctx.db.patch(existing._id, { scheduledAt });
    } else {
      await ctx.db.insert("fight_form_recompute_pending", {
        userId,
        date,
        scheduledAt,
      });
    }
    await ctx.scheduler.runAfter(
      delay,
      internal.fightFormScore.coalescedRecompute,
      { userId, date },
    );
  },
});

/** Internal: delete the pending row after a recompute completes (or after
 *  a coalesced no-op). Separate mutation because actions can't write to
 *  the db directly. */
export const _clearRecomputePending = internalMutation({
  args: { userId: v.id("users"), date: v.string() },
  handler: async (ctx, { userId, date }) => {
    const existing = await ctx.db
      .query("fight_form_recompute_pending")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).eq("date", date),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});

/** Internal: read the current pending row (or null). */
export const _getRecomputePending = internalQuery({
  args: { userId: v.id("users"), date: v.string() },
  handler: async (ctx, { userId, date }) => {
    const row = await ctx.db
      .query("fight_form_recompute_pending")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).eq("date", date),
      )
      .first();
    return row ? { scheduledAt: row.scheduledAt } : null;
  },
});

/**
 * Wraps `recomputeForUserDate` with the coalescing check. If a later
 * `scheduleRecompute` has pushed the pending row's `scheduledAt` further
 * into the future than `Date.now()`, this execution no-ops — the later
 * schedule's own `coalescedRecompute` will run when it's due.
 */
export const coalescedRecompute = internalAction({
  args: { userId: v.id("users"), date: v.string() },
  handler: async (ctx, { userId, date }) => {
    const pending = await ctx.runQuery(
      internal.fightFormScore._getRecomputePending,
      { userId, date },
    );
    // If the pending row is gone (race with another wrapper), assume
    // someone else already handled the recompute and bail.
    if (!pending) return null;
    // A later schedule has the row — let it run. We're an earlier
    // wrapper whose fire time is now stale.
    if (pending.scheduledAt > Date.now()) return null;
    await ctx.runAction(internal.fightFormScore.recomputeForUserDate, {
      userId,
      date,
    });
    await ctx.runMutation(
      internal.fightFormScore._clearRecomputePending,
      { userId, date },
    );
    return null;
  },
});

/**
 * Median log time per pillar over the last 14 days (by `date` field).
 * Uses each row's `_creationTime` (ms epoch, auto-set by Convex) to derive
 * the UTC hour and minute. Returns `{ hour, minute }` for pillars with at
 * least one entry in the window, `null` for pillars with no entries.
 *
 * Shape: `{ weight, sleep, training, wellness, nutrition }` where each is
 * `{ hour: number; minute: number } | null`. Returns `null` when unauthenticated.
 */
export const loggingTimeStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await optionalUserId(ctx);
    if (!userId) return null;

    const since = new Date(Date.now());
    since.setUTCDate(since.getUTCDate() - 14);
    const sinceIso = since.toISOString().slice(0, 10);

    const collect = (
      table:
        | "weight_logs"
        | "sleep_logs"
        | "daily_wellness_checkins"
        | "gym_sessions"
        | "fight_camp_calendar"
        | "meals",
    ) =>
      ctx.db
        .query(table)
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).gte("date", sinceIso),
        )
        .collect();

    const [weights, sleep, wellness, sessions, calendar, meals] =
      await Promise.all([
        collect("weight_logs"),
        collect("sleep_logs"),
        collect("daily_wellness_checkins"),
        collect("gym_sessions"),
        collect("fight_camp_calendar"),
        collect("meals"),
      ]);

    const medianTime = (
      rows: Array<{ _creationTime: number }>,
    ): { hour: number; minute: number } | null => {
      if (!rows.length) return null;
      const mins = rows
        .map((r) => {
          const d = new Date(r._creationTime);
          return d.getUTCHours() * 60 + d.getUTCMinutes();
        })
        .sort((a, b) => a - b);
      const m = mins[Math.floor((mins.length - 1) / 2)];
      return { hour: Math.floor(m / 60), minute: m % 60 };
    };

    return {
      weight: medianTime(weights),
      sleep: medianTime(sleep),
      training: medianTime([...sessions, ...calendar]),
      wellness: medianTime(wellness),
      nutrition: medianTime(meals),
    };
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
