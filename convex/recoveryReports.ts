/**
 * Recovery reports — the weekly Camp Compass digest.
 *
 * Stores AI-generated weekly recovery recaps in `recoveryReports`. The
 * writes happen exclusively from `convex/actions/recovery/campCompass.ts`
 * via `upsertByWeek` (internal). Reads are exposed to the client via
 * `listRecent` and `getCurrentForUser`.
 *
 * `gatherCampCompassInputs` is the single-shot internalQuery the action
 * uses to fetch every slice it needs (sessions, sleep, wellness, baseline,
 * prior reports, active camp) in one DB round-trip — mirrors the pattern
 * established by `actions_internal.fetchRecoveryData`.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ───────────────────────────────────────────────────────────────────────
// Writes
// ───────────────────────────────────────────────────────────────────────

/**
 * Upsert by (userId, weekStartIso). The action calls this after a
 * successful Groq generation. Idempotent — re-runs overwrite the prior
 * row for the same week instead of creating duplicates so the cron and
 * a user-triggered "regenerate" can both run safely.
 */
export const upsertByWeek = internalMutation({
  args: {
    userId: v.id("users"),
    weekStartIso: v.string(),
    verdict: v.string(),
    breakdown: v.string(),
    nextWeekActions: v.array(
      v.object({ dayIso: v.string(), action: v.string() }),
    ),
    campArc: v.optional(v.string()),
    rawMetrics: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("recoveryReports")
      .withIndex("by_user_week", (q) =>
        q.eq("userId", args.userId).eq("weekStartIso", args.weekStartIso),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        verdict: args.verdict,
        breakdown: args.breakdown,
        nextWeekActions: args.nextWeekActions,
        campArc: args.campArc,
        rawMetrics: args.rawMetrics,
        // We deliberately do NOT update `createdAt` on patch so the
        // by_user_created index keeps original chronological ordering
        // even when the same week is regenerated.
      });
      return existing._id;
    }
    return await ctx.db.insert("recoveryReports", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// ───────────────────────────────────────────────────────────────────────
// Reads (auth-scoped)
// ───────────────────────────────────────────────────────────────────────

/**
 * Most recent reports for the calling user (newest first). Used by the
 * Recovery page history strip and by the action itself (via the
 * internal variant below) to seed the "prior weeks" prompt block.
 */
export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("recoveryReports")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit ?? 10);
  },
});

/**
 * The single most recent Camp Compass report for the calling user, or
 * `null` when none exist yet. Powers the headline card on the Recovery
 * page. Auth resolution mirrors the pattern used elsewhere in the
 * codebase (see `convex/wellness.ts` — auth-scoped queries call
 * `requireUserId` or `getAuthUserId`).
 */
export const getCurrentForUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("recoveryReports")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
  },
});

// ───────────────────────────────────────────────────────────────────────
// Internal queries — for the campCompass action
// ───────────────────────────────────────────────────────────────────────

/**
 * Internal variant of `listRecent` keyed by an explicit userId so the
 * Camp Compass action (which has no auth identity when triggered by the
 * Sunday cron) can pull the prior weeks' reports for context.
 */
export const listRecentForUser = internalQuery({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, limit }) => {
    return await ctx.db
      .query("recoveryReports")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit ?? 3);
  },
});

/**
 * One-shot fetch of every slice the Camp Compass prompt needs. Lives
 * here (next to the writer) because the inputs are only ever used by
 * the Camp Compass pipeline. Returning shapes are compacted to the
 * fields the prompt actually cites — keeps the input token budget
 * comfortably under the ~6k cap the spec calls for.
 *
 * Lookback windows:
 *   - sessions      : 28 days (covers the report week + 3 weeks of
 *                     surrounding trend so the model can spot
 *                     deviations).
 *   - sleep         : 28 days
 *   - wellness      : 14 days
 *   - baseline      : most recent personal_baselines row
 *   - priorReports  : last 3 recoveryReports rows
 *   - activeCamp    : earliest non-completed camp with fightDate >=
 *                     today, else most recent camp (mirrors
 *                     `fight_camp.getActiveCamp`).
 */
export const gatherCampCompassInputs = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const isoDaysAgo = (days: number) =>
      new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const fourteenDaysAgo = isoDaysAgo(14);
    const twentyEightDaysAgo = isoDaysAgo(28);

    const sessions = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", twentyEightDaysAgo),
      )
      .order("desc")
      .take(60);

    const sleepLogs = await ctx.db
      .query("sleep_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", twentyEightDaysAgo),
      )
      .order("desc")
      .take(40);

    const wellness = await ctx.db
      .query("daily_wellness_checkins")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", fourteenDaysAgo),
      )
      .order("desc")
      .take(20);

    const baseline = await ctx.db
      .query("personal_baselines")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .first();

    const priorReports = await ctx.db
      .query("recoveryReports")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(3);

    // Active camp — same heuristic as `fight_camp.getActiveCamp` (earliest
    // upcoming non-completed camp, else most recent camp).
    const camps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    let activeCamp: (typeof camps)[number] | null = null;
    if (camps.length > 0) {
      const upcoming = camps
        .filter((c) => !c.isCompleted && c.fightDate >= todayIso)
        .sort((a, b) => a.fightDate.localeCompare(b.fightDate));
      activeCamp =
        upcoming[0] ??
        [...camps].sort((a, b) => b.fightDate.localeCompare(a.fightDate))[0] ??
        null;
    }

    return {
      sessions: sessions.map((s) => ({
        date: s.date,
        sessionType: s.sessionType,
        durationMinutes: s.durationMinutes,
        rpe: s.rpe,
        intensity: s.intensity,
        rounds: s.rounds ?? null,
      })),
      sleepLogs: sleepLogs.map((l) => ({ date: l.date, hours: l.hours })),
      checkins: wellness.map((c) => ({
        date: c.date,
        hooperIndex: c.hooperIndex ?? null,
        sorenessLevel: c.sorenessLevel,
        fatigueLevel: c.fatigueLevel,
        stressLevel: c.stressLevel,
        sleepHours: c.sleepHours ?? null,
      })),
      baseline: baseline
        ? {
            sleepHoursMean60d: baseline.sleepHoursMean60d ?? null,
            hooperMean60d: baseline.hooperMean60d ?? null,
            dailyLoadMean14d: baseline.dailyLoadMean14d ?? null,
            hooperCv14d: baseline.hooperCv14d ?? null,
          }
        : null,
      priorReports: priorReports.map((r) => ({
        weekStartIso: r.weekStartIso,
        verdict: r.verdict,
      })),
      activeCamp: activeCamp
        ? {
            name: activeCamp.name,
            fightDate: activeCamp.fightDate,
            eventName: activeCamp.eventName ?? null,
          }
        : null,
    };
  },
});

/**
 * Focused one-shot fetch for the Pre-Session Green Light action (T15).
 *
 * Pulls only what the verdict prompt needs to make a Go / Modify / Bail
 * call about a planned session opening within the next ~2h:
 *   - today's wellness check-in (soreness, fatigue, Hooper, readiness)
 *   - last night's sleep (most recent sleep_logs row)
 *   - last 7 days of training sessions, compacted to a small summary
 *     (count, average RPE, average soreness reported per-session)
 *
 * Kept intentionally lean — the Green Light prompt is short and runs on
 * the fast Groq model, so we don't ship every baseline / camp slice that
 * Camp Compass needs.
 */
export const gatherGreenLightInputs = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 86400000)
      .toISOString()
      .slice(0, 10);

    const [todayWellness, recentSleep, sessions7d] = await Promise.all([
      // Today's wellness check-in (single row by composite index).
      ctx.db
        .query("daily_wellness_checkins")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).eq("date", todayIso),
        )
        .unique(),
      // Most recent sleep_logs row — represents last night's sleep when
      // logged this morning. Range-scan + take(1) keeps it cheap.
      ctx.db
        .query("sleep_logs")
        .withIndex("by_user_date", (q) => q.eq("userId", userId))
        .order("desc")
        .first(),
      // Last 7d of training sessions for the load summary.
      ctx.db
        .query("fight_camp_calendar")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).gte("date", sevenDaysAgoIso),
        )
        .order("desc")
        .take(30),
    ]);

    const sessions = sessions7d.map((s) => ({
      rpe: s.rpe ?? 0,
      sorenessLevel: s.sorenessLevel ?? 0,
    }));

    return {
      wellness: todayWellness
        ? {
            hooperIndex: todayWellness.hooperIndex ?? null,
            sorenessLevel: todayWellness.sorenessLevel,
            fatigueLevel: todayWellness.fatigueLevel,
            stressLevel: todayWellness.stressLevel,
            sleepHours: todayWellness.sleepHours ?? null,
            readinessScore: todayWellness.readinessScore ?? null,
          }
        : null,
      lastSleepHours: recentSleep?.hours ?? null,
      last7dLoadSummary: summarize7dLoad(sessions),
      readinessScore: todayWellness?.readinessScore ?? null,
    };
  },
});

function summarize7dLoad(
  sessions: Array<{ rpe: number; sorenessLevel: number }>,
): { sessions: number; avgRPE: number; sorenessAvg: number } {
  const n = sessions.length;
  if (n === 0) return { sessions: 0, avgRPE: 0, sorenessAvg: 0 };
  const avgRPE = sessions.reduce((s, r) => s + (r.rpe ?? 0), 0) / n;
  const sorenessVals = sessions
    .map((s) => s.sorenessLevel ?? 0)
    .filter((val) => val > 0);
  const sorenessAvg = sorenessVals.length
    ? sorenessVals.reduce((a, b) => a + b, 0) / sorenessVals.length
    : 0;
  return { sessions: n, avgRPE, sorenessAvg };
}
