import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { CURRENT_CONFIG } from "../src/scoring/config";

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

    // Sleep + weight come solely from the manual `sleep_logs` / `weight_logs`
    // tables (Apple HealthKit was removed — App Store Guideline 2.5.1).
    const mergedSleep: Array<{ date: string; hours: number }> = sleep.map((s) => ({
      date: s.date,
      hours: s.hours,
    }));
    const mergedWeights: Array<{ date: string; weightKg: number }> = weights.map((w) => ({
      date: w.date,
      weightKg: w.weightKg,
    }));

    // "Forgot to log sleep" rescue: if the user has no sleep entry for
    // the target date but logged a meaningful training session that day
    // (≥ N minutes, where N is tunable in ScoringConfig), inject a default
    // sleep entry so the score isn't penalised for a missing log. The
    // assumption is NOT written to `sleep_logs` — when the user later
    // enters their real hours, the standard upsert + scheduled recompute
    // (see convex/sleep_logs.ts) overrides the assumption cleanly.
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
    }

    // Explicitly-marked rest days within the lookback window. Reuses the
    // `calendarEntries` fetch above (also used by the assumed-sleep rescue)
    // to avoid a second round-trip to `fight_camp_calendar`. Rest days don't
    // contribute load (so ACWR math is untouched) but they let the engine
    // distinguish planned 0-load days from missing data — see
    // `computeTrainingLoad`'s cold-start gate.
    const restDays = calendarEntries
      .filter((c) => (c.sessionType ?? "").toLowerCase() === "rest")
      .map((c) => c.date);

    // Marked skips within the lookback window. Map user-facing pillar names to
    // the engine's SubScoreKey so a skip pauses the right pillar's staleness.
    const skipRows = await ctx.db
      .query("marked_skips")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", lookbackStartIso))
      .collect();
    const SKIP_PILLAR_TO_KEY: Record<string, "sleep" | "weightCut" | "nutritionAdherence" | "wellness"> = {
      sleep: "sleep",
      weight: "weightCut",
      nutrition: "nutritionAdherence",
      wellness: "wellness",
    };
    const markedSkips = skipRows
      .map((r) => ({ date: r.date, pillar: SKIP_PILLAR_TO_KEY[r.pillar] }))
      .filter((s): s is { date: string; pillar: "sleep" | "weightCut" | "nutritionAdherence" | "wellness" } => s.pillar != null);

    return {
      date,
      profile,
      weights: mergedWeights,
      sleepHours: sleepLogsForScoring,
      assumedSleepDates,
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
      markedSkips,
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
