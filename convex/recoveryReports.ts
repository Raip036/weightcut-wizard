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
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { normalizeLegacySession } from "./lib/sessionTypes";

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
// DEV / MOCK SEED — local development only
// ───────────────────────────────────────────────────────────────────────

/**
 * DEV-ONLY mock seed. Inserts (or upserts by userId+weekStartIso, mirroring
 * `upsertByWeek`) a realistic Camp Compass "Sunday report" so the /recovery
 * page UI can be exercised on localhost without waiting for the Sunday 8pm
 * cron or paying for a Groq generation.
 *
 * This is a `mutation` (public) purely so it can be invoked from the CLI via
 * `npx convex run` (which has no auth identity). It does NOT touch the real
 * generation pipeline. Delete this before shipping if you don't want a
 * mock-seed endpoint exposed. Run with:
 *
 *   npx convex run recoveryReports:seedMockRecoveryReport
 *   npx convex run recoveryReports:seedMockRecoveryReport '{"userEmail":"you@example.com"}'
 */
export const seedMockRecoveryReport = mutation({
  args: { userEmail: v.optional(v.string()) },
  handler: async (ctx, { userEmail }) => {
    // Resolve the user to attach the report to. CLI runs have no auth, so we
    // accept an optional email and fall back to the most-recently-created user.
    let userId: Id<"users"> | null = null;

    if (userEmail) {
      // The auth `users` table has an `email` field. Scan a bounded set and
      // match (no email index is guaranteed to exist, so we read + filter
      // a small page — fine for a dev seed).
      const candidates = await ctx.db.query("users").take(200);
      const match = candidates.find((u) => u.email === userEmail);
      if (!match) {
        throw new Error(
          `seedMockRecoveryReport: no user found with email "${userEmail}". ` +
            `Run without args to attach to the most recent user instead.`,
        );
      }
      userId = match._id;
    } else {
      // Default: most-recently-created user (highest _creationTime).
      const recent = await ctx.db.query("users").order("desc").first();
      if (!recent) {
        throw new Error(
          "seedMockRecoveryReport: no users exist in this deployment. " +
            "Sign in to the app at least once to create a user first.",
        );
      }
      userId = recent._id;
    }

    // Monday of the week just ended.
    const weekStartIso = "2026-06-01";

    const verdict =
      "Strong week — you held volume through a rough Thursday and your sleep rebounded by Friday.";

    const breakdown =
      "You logged 6 sessions for 512 total minutes at an average RPE of 7.4 — right in your build-block sweet spot. " +
      "The wobble was Thursday: sleep dropped to 5h 20m after a late hard sparring session, and your Hooper score spiked the next morning, which is why Friday's lift felt flat. " +
      "You recovered well — sleep climbed back to 7h+ over the weekend and soreness settled, so the week reads as a net positive rather than an overreach.";

    const nextWeekActions = [
      {
        dayIso: "2026-06-08",
        action:
          "Open the week with a controlled technical session (RPE ≤ 6) — bank quality reps before loading intensity midweek.",
      },
      {
        dayIso: "2026-06-10",
        action:
          "Hard sparring is fine here, but cap it at 5 rounds and keep lights-out by 10:30pm so you don't repeat last Thursday's sleep dip.",
      },
      {
        dayIso: "2026-06-12",
        action:
          "Pull strength volume back ~15% and add 10 minutes of mobility — you're carrying accumulated fatigue into the back half of camp.",
      },
    ];

    const campArc =
      "Week 4 of an 8-week camp: base is built and holding. Next two weeks shift toward sharpening — protect sleep and you'll peak on schedule.";

    // Debug snapshot of the (mock) inputs that "produced" this report.
    const rawMetrics = {
      mock: true,
      generatedBy: "seedMockRecoveryReport (dev)",
      window: { weekStartIso, weekEndIso: "2026-06-07" },
      sessions: 6,
      totalMinutes: 512,
      avgRpe: 7.4,
      sleep: {
        weekMeanHours: 6.8,
        worstNight: { dateIso: "2026-06-04", hours: 5.3 },
        rebounded: true,
      },
      hooperSpikeDateIso: "2026-06-05",
    };

    const existing = await ctx.db
      .query("recoveryReports")
      .withIndex("by_user_week", (q) =>
        q.eq("userId", userId!).eq("weekStartIso", weekStartIso),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        verdict,
        breakdown,
        nextWeekActions,
        campArc,
        rawMetrics,
      });
      return { reportId: existing._id, userId, weekStartIso, upserted: true };
    }

    const reportId = await ctx.db.insert("recoveryReports", {
      userId,
      weekStartIso,
      verdict,
      breakdown,
      nextWeekActions,
      campArc,
      rawMetrics,
      createdAt: Date.now(),
    });
    return { reportId, userId, weekStartIso, upserted: false };
  },
});

/**
 * DEV-ONLY mock seed for the LIVE week data behind the Sunday report.
 *
 * The redesigned Camp Compass report card reads live training / sleep /
 * wellness rows for the report week (Mon 2026-06-01 → Sun 2026-06-07) rather
 * than only the static prose stored in `recoveryReports`. With no rows for
 * that week the new sub-cards render empty, so this mutation seeds realistic
 * data that matches the seeded report's narrative:
 *   6 sessions · 512 total minutes · avg RPE ≈ 7.4 · Thursday sleep dip to
 *   ~5h20m after a late hard sparring session · flat Friday lift · weekend
 *   sleep rebound to 7h+.
 *
 * Like `seedMockRecoveryReport` this is a public `mutation` purely so it can
 * be invoked from the CLI (`npx convex run`) which has no auth identity. It
 * touches ONLY the three live-data tables (`fight_camp_calendar`,
 * `sleep_logs`, `daily_wellness_checkins`) — never the real generation
 * pipeline or cron. It is idempotent: every run first deletes the user's rows
 * in the 2026-06-01..2026-06-07 window for each table, then re-inserts, so
 * re-running never duplicates. Delete this before shipping if you don't want a
 * mock-seed endpoint exposed. Run with:
 *
 *   npx convex run recoveryReports:seedMockRecoveryWeek
 *   npx convex run recoveryReports:seedMockRecoveryWeek '{"userEmail":"you@example.com"}'
 */
export const seedMockRecoveryWeek = mutation({
  args: { userEmail: v.optional(v.string()) },
  handler: async (ctx, { userEmail }) => {
    // Resolve the user — identical lookup to seedMockRecoveryReport. CLI runs
    // have no auth, so accept an optional email and fall back to the
    // most-recently-created user.
    let userId: Id<"users"> | null = null;
    if (userEmail) {
      const candidates = await ctx.db.query("users").take(200);
      const match = candidates.find((u) => u.email === userEmail);
      if (!match) {
        throw new Error(
          `seedMockRecoveryWeek: no user found with email "${userEmail}". ` +
            `Run without args to attach to the most recent user instead.`,
        );
      }
      userId = match._id;
    } else {
      const recent = await ctx.db.query("users").order("desc").first();
      if (!recent) {
        throw new Error(
          "seedMockRecoveryWeek: no users exist in this deployment. " +
            "Sign in to the app at least once to create a user first.",
        );
      }
      userId = recent._id;
    }
    const uid = userId!;

    // The report week: Monday 2026-06-01 → Sunday 2026-06-07 (inclusive).
    const WEEK_START = "2026-06-01";
    const WEEK_END = "2026-06-07";
    const inWeek = (iso: string) => iso >= WEEK_START && iso <= WEEK_END;

    // ── Idempotency: delete any existing rows in the week window first ──────
    const oldSessions = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", uid).gte("date", WEEK_START).lte("date", WEEK_END),
      )
      .collect();
    const oldSleep = await ctx.db
      .query("sleep_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", uid).gte("date", WEEK_START).lte("date", WEEK_END),
      )
      .collect();
    const oldWellness = await ctx.db
      .query("daily_wellness_checkins")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", uid).gte("date", WEEK_START).lte("date", WEEK_END),
      )
      .collect();
    for (const r of [...oldSessions, ...oldSleep, ...oldWellness]) {
      await ctx.db.delete(r._id);
    }
    const deleted = {
      sessions: oldSessions.length,
      sleep: oldSleep.length,
      wellness: oldWellness.length,
    };

    // ── 6 training sessions: 75+90+60+90+67+130 = 512 min, avg RPE 7.33 ────
    // (7+8+6+9+6+8)/6 = 7.33 — right at the ~7.4 narrative. Thursday is the
    // late hard sparring session (RPE 9), Friday is the flat strength day.
    const sessions: Array<{
      date: string;
      sessionType: string;
      sessionTag?: string;
      intensity: string;
      intensityLevel?: number;
      durationMinutes: number;
      rpe: number;
      rounds?: number;
      notes?: string;
    }> = [
      {
        date: "2026-06-01",
        sessionType: "BJJ",
        sessionTag: "Live Grappling",
        intensity: "Steady",
        intensityLevel: 3,
        durationMinutes: 75,
        rpe: 7,
        rounds: 5,
        notes: "Good positional rolls — felt sharp off the back foot.",
      },
      {
        date: "2026-06-02",
        sessionType: "Boxing",
        sessionTag: "Sparring",
        intensity: "Hard",
        intensityLevel: 4,
        durationMinutes: 90,
        rpe: 8,
        rounds: 8,
      },
      {
        date: "2026-06-03",
        sessionType: "S&C",
        sessionTag: "Strength",
        intensity: "Steady",
        intensityLevel: 3,
        durationMinutes: 60,
        rpe: 6,
      },
      {
        date: "2026-06-04",
        sessionType: "Boxing",
        sessionTag: "Sparring",
        intensity: "Hard",
        intensityLevel: 5,
        durationMinutes: 90,
        rpe: 9,
        rounds: 9,
        notes: "Late hard spar — high pace, finished after 9pm.",
      },
      {
        date: "2026-06-05",
        sessionType: "S&C",
        sessionTag: "Strength",
        intensity: "Easy",
        intensityLevel: 2,
        durationMinutes: 67,
        rpe: 6,
        notes: "Lift felt flat — legs heavy after last night's sparring.",
      },
      {
        date: "2026-06-06",
        sessionType: "BJJ",
        sessionTag: "Live Grappling",
        intensity: "Hard",
        intensityLevel: 4,
        durationMinutes: 130,
        rpe: 8,
        rounds: 7,
      },
    ];
    for (const s of sessions) {
      if (!inWeek(s.date)) continue; // safety
      await ctx.db.insert("fight_camp_calendar", {
        userId: uid,
        date: s.date,
        sessionType: s.sessionType,
        sessionTag: s.sessionTag,
        intensity: s.intensity,
        intensityLevel: s.intensityLevel,
        durationMinutes: s.durationMinutes,
        rpe: s.rpe,
        rounds: s.rounds,
        notes: s.notes,
        source: "manual",
      });
    }

    // ── 7 sleep logs Mon..Sun: dip → rebound (Thu = 5.3h) ──────────────────
    const sleepByDay: Record<string, number> = {
      "2026-06-01": 7.2,
      "2026-06-02": 6.5,
      "2026-06-03": 7.0,
      "2026-06-04": 5.3, // Thursday dip after the late hard spar
      "2026-06-05": 6.2,
      "2026-06-06": 7.4,
      "2026-06-07": 7.6,
    };
    for (const [date, hours] of Object.entries(sleepByDay)) {
      await ctx.db.insert("sleep_logs", { userId: uid, date, hours });
    }

    // ── 7 daily wellness check-ins Mon..Sun ────────────────────────────────
    // Survey components are on the 1-7 scale used by WellnessCheckIn
    // (sleepQuality higher = better; fatigue/soreness/stress higher = worse).
    // hooperIndex matches the app formula exactly:
    //   sleepQuality + (8 - stress) + (8 - fatigue) + (8 - soreness)
    // → range 4..28, higher = better. readinessScore follows the narrative
    // (dips Thursday, lowest/flat Friday, rebounds over the weekend) and
    // sleepHours mirrors the sleep_logs above.
    type WellnessSeed = {
      date: string;
      sleepQuality: number;
      fatigueLevel: number;
      sorenessLevel: number;
      stressLevel: number;
      sleepHours: number;
      readinessScore: number;
    };
    const wellnessSeed: WellnessSeed[] = [
      { date: "2026-06-01", sleepQuality: 6, fatigueLevel: 3, sorenessLevel: 2, stressLevel: 3, sleepHours: 7.2, readinessScore: 78 },
      { date: "2026-06-02", sleepQuality: 5, fatigueLevel: 4, sorenessLevel: 3, stressLevel: 3, sleepHours: 6.5, readinessScore: 72 },
      { date: "2026-06-03", sleepQuality: 6, fatigueLevel: 3, sorenessLevel: 3, stressLevel: 3, sleepHours: 7.0, readinessScore: 75 },
      { date: "2026-06-04", sleepQuality: 4, fatigueLevel: 5, sorenessLevel: 4, stressLevel: 4, sleepHours: 5.3, readinessScore: 70 },
      { date: "2026-06-05", sleepQuality: 5, fatigueLevel: 5, sorenessLevel: 5, stressLevel: 5, sleepHours: 6.2, readinessScore: 62 },
      { date: "2026-06-06", sleepQuality: 6, fatigueLevel: 3, sorenessLevel: 3, stressLevel: 3, sleepHours: 7.4, readinessScore: 74 },
      { date: "2026-06-07", sleepQuality: 7, fatigueLevel: 2, sorenessLevel: 2, stressLevel: 2, sleepHours: 7.6, readinessScore: 80 },
    ];
    for (const w of wellnessSeed) {
      const hooperIndex =
        w.sleepQuality +
        (8 - w.stressLevel) +
        (8 - w.fatigueLevel) +
        (8 - w.sorenessLevel);
      await ctx.db.insert("daily_wellness_checkins", {
        userId: uid,
        date: w.date,
        sleepQuality: w.sleepQuality,
        fatigueLevel: w.fatigueLevel,
        sorenessLevel: w.sorenessLevel,
        stressLevel: w.stressLevel,
        sleepHours: w.sleepHours,
        hooperIndex,
        readinessScore: w.readinessScore,
      });
    }

    return {
      userId: uid,
      weekStartIso: WEEK_START,
      weekEndIso: WEEK_END,
      deleted,
      inserted: {
        sessions: sessions.length,
        totalMinutes: sessions.reduce((a, s) => a + s.durationMinutes, 0),
        sleep: Object.keys(sleepByDay).length,
        wellness: wellnessSeed.length,
      },
    };
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
// LIVE week breakdown — always-fresh replacement for the frozen `breakdown`
// ───────────────────────────────────────────────────────────────────────

/**
 * LIVE, deterministic breakdown of a single report week's training.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Sunday report's `breakdown` field is a FROZEN AI prose snapshot written
 * once by the Sunday cron (see `actions/recovery/campCompass.ts`). The moment a
 * user edits / deletes / adds a session for that week afterwards, that prose
 * goes stale while the top cards (computed live) stay correct.
 *
 * This query is the live, always-fresh source for the "Where you broke down"
 * section: a plain Convex `query` (so it re-runs reactively whenever any
 * `fight_camp_calendar` / `sleep_logs` row in the week changes) that computes a
 * 100% DETERMINISTIC breakdown from the actual sessions of that exact week.
 * It never calls the AI and never touches the stored `breakdown` — the UI can
 * still render the stored AI `verdict` line; we only replace the stale prose
 * paragraph with this live, card-matching payload.
 *
 * WEEK BOUNDARIES
 * ---------------
 * Weeks are UTC Monday → Sunday, identical to the cron's `computeLastMondayIsoUtc`
 * (which derives `weekStartIso`). Given the report's Monday `weekStartIso`, the
 * window is [weekStartIso, weekStartIso + 6 days] inclusive, computed in UTC so
 * it divides weeks exactly the same way the cron does (no DST drift).
 *
 * Auth: scoped to the calling user via `getAuthUserId` — the same pattern as
 * `listRecent` / `getCurrentForUser`. We deliberately do NOT accept a userId
 * arg (per Convex auth guidelines). Returns a null-safe empty-ish payload for
 * a week with no logged sessions rather than throwing, so a partial week still
 * renders.
 *
 * `totalLoad` is a simple session-load proxy: sum of `durationMinutes * rpe`
 * over non-rest sessions (minutes weighted by perceived intensity). Rest
 * sessions (sessionType === "Rest") are excluded from all "trained" stats but
 * are reported via `restOrMissedDays` / the per-day map.
 */
export const getWeekBreakdown = query({
  args: { weekStartIso: v.string() },
  handler: async (ctx, { weekStartIso }) => {
    const userId = await getAuthUserId(ctx);

    // ── Deterministic UTC Monday → Sunday window ────────────────────────────
    // Mirror `computeLastMondayIsoUtc`: treat weekStartIso as a UTC midnight
    // Monday and add 6 days for Sunday. Parsing "YYYY-MM-DD" via `Date` yields
    // UTC midnight, and `setUTCDate` keeps the math in UTC.
    const weekStartDate = new Date(`${weekStartIso}T00:00:00.000Z`);
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
    const weekEndIso = weekEndDate.toISOString().slice(0, 10);

    // Mon..Sun day labels, indexed by offset from the Monday start.
    const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
    type DayLabel = (typeof DAY_LABELS)[number];
    const isoForOffset = (offset: number): string => {
      const d = new Date(weekStartDate);
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const labelForIso = (iso: string): DayLabel | null => {
      for (let i = 0; i < 7; i++) {
        if (isoForOffset(i) === iso) return DAY_LABELS[i];
      }
      return null;
    };

    // Empty-but-valid payload (unauthed, or a week with no data) — keeps the
    // return type stable so the UI never has to special-case null.
    const emptyDayMap: Record<DayLabel, "session" | "rest" | "missed"> = {
      Mon: "missed",
      Tue: "missed",
      Wed: "missed",
      Thu: "missed",
      Fri: "missed",
      Sat: "missed",
      Sun: "missed",
    };

    if (!userId) {
      return {
        weekStartIso,
        weekEndIso,
        sessionCount: 0,
        totalMinutes: 0,
        avgRpe: null as number | null,
        totalLoad: 0,
        sessions: [] as Array<{
          date: string;
          dayLabel: DayLabel;
          type: string;
          durationMinutes: number;
          rpe: number;
        }>,
        perDay: { ...emptyDayMap },
        restOrMissedDays: [...DAY_LABELS] as DayLabel[],
        hardestDay: null as DayLabel | null,
        avgSleepH: null as number | null,
      };
    }

    // ── LIVE session fetch for the exact week (by_user_date index) ───────────
    const rawSessions = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", weekStartIso).lte("date", weekEndIso),
      )
      .order("asc")
      .take(100);

    // Normalize legacy rows (sessionType = primary), then split Rest vs trained.
    const normalized = rawSessions.map((s) => {
      const { primary } = normalizeLegacySession(s.sessionType, s.sessionTag);
      return {
        date: s.date,
        type: primary,
        durationMinutes: s.durationMinutes ?? 0,
        rpe: s.rpe ?? 0,
        isRest: primary === "Rest",
      };
    });

    const trained = normalized.filter((s) => !s.isRest);

    // ── Deterministic aggregates over non-rest sessions ─────────────────────
    const sessionCount = trained.length;
    const totalMinutes = trained.reduce((a, s) => a + s.durationMinutes, 0);
    const totalLoad = trained.reduce(
      (a, s) => a + s.durationMinutes * s.rpe,
      0,
    );
    const rpeVals = trained.map((s) => s.rpe).filter((r) => r > 0);
    const avgRpe =
      rpeVals.length > 0
        ? Math.round((rpeVals.reduce((a, r) => a + r, 0) / rpeVals.length) * 10) /
          10
        : null;

    // Per-day map: a day with ≥1 trained session is "session"; a day whose only
    // logged rows are Rest is "rest"; a day with nothing logged is "missed".
    const perDay: Record<DayLabel, "session" | "rest" | "missed"> = {
      ...emptyDayMap,
    };
    const loadByDay: Record<DayLabel, number> = {
      Mon: 0,
      Tue: 0,
      Wed: 0,
      Thu: 0,
      Fri: 0,
      Sat: 0,
      Sun: 0,
    };
    for (const s of normalized) {
      const label = labelForIso(s.date);
      if (!label) continue; // out-of-window safety
      if (s.isRest) {
        // Don't downgrade a day that already has a trained session.
        if (perDay[label] === "missed") perDay[label] = "rest";
      } else {
        perDay[label] = "session";
        loadByDay[label] += s.durationMinutes * s.rpe;
      }
    }

    // Sorted, labelled live session list — the list the UI renders.
    const sessions = trained
      .map((s) => ({
        date: s.date,
        dayLabel: labelForIso(s.date) ?? ("Mon" as DayLabel),
        type: s.type,
        durationMinutes: s.durationMinutes,
        rpe: s.rpe,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const restOrMissedDays = DAY_LABELS.filter(
      (d) => perDay[d] !== "session",
    ) as DayLabel[];

    // Hardest day = max daily training load (null if no trained sessions).
    let hardestDay: DayLabel | null = null;
    let hardestLoad = 0;
    for (const d of DAY_LABELS) {
      if (loadByDay[d] > hardestLoad) {
        hardestLoad = loadByDay[d];
        hardestDay = d;
      }
    }

    // ── Optional in-range sleep average ─────────────────────────────────────
    const sleepRows = await ctx.db
      .query("sleep_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", weekStartIso).lte("date", weekEndIso),
      )
      .take(14);
    const sleepHours = sleepRows
      .map((r) => r.hours)
      .filter((h): h is number => typeof h === "number" && h > 0);
    const avgSleepH =
      sleepHours.length > 0
        ? Math.round(
            (sleepHours.reduce((a, h) => a + h, 0) / sleepHours.length) * 10,
          ) / 10
        : null;

    return {
      weekStartIso,
      weekEndIso,
      sessionCount,
      totalMinutes,
      avgRpe,
      totalLoad,
      sessions,
      perDay,
      restOrMissedDays,
      hardestDay,
      avgSleepH,
    };
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
      sessions: sessions.map((s) => {
        const { primary, tag } = normalizeLegacySession(s.sessionType, s.sessionTag);
        return {
          date: s.date,
          sessionType: primary,
          sessionTag: tag,
          durationMinutes: s.durationMinutes,
          rpe: s.rpe,
          intensity: s.intensity,
          rounds: s.rounds ?? null,
        };
      }),
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

    const sessions = sessions7d.map((s) => {
      const { primary } = normalizeLegacySession(s.sessionType, s.sessionTag);
      return {
        rpe: s.rpe ?? 0,
        sorenessLevel: s.sorenessLevel ?? 0,
        isRest: primary === "Rest",
      };
    });

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
  sessions: Array<{ rpe: number; sorenessLevel: number; isRest: boolean }>,
): { sessions: number; avgRPE: number; sorenessAvg: number } {
  // Rest days carry 0 load: they must not inflate the training-session count
  // or drag down the average RPE that feeds the coach's green-light verdict.
  const trained = sessions.filter((s) => !s.isRest);
  const n = trained.length;
  const rpeVals = trained.map((s) => s.rpe ?? 0).filter((v) => v > 0);
  const avgRPE = rpeVals.length
    ? rpeVals.reduce((a, b) => a + b, 0) / rpeVals.length
    : 0;
  const sorenessVals = sessions
    .map((s) => s.sorenessLevel ?? 0)
    .filter((val) => val > 0);
  const sorenessAvg = sorenessVals.length
    ? sorenessVals.reduce((a, b) => a + b, 0) / sorenessVals.length
    : 0;
  return { sessions: n, avgRPE, sorenessAvg };
}
