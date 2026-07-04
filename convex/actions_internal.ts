/**
 * Internal queries shared by Phase 4 actions.
 *
 * Each function below fetches a slice of user data the action layer needs to
 * build prompts and run deterministic math. Actions reach these via
 * `ctx.runQuery(internal.actions_internal.<name>, ...)`.
 *
 * All queries are user-scoped via an explicit `userId` arg (the action has
 * already resolved it through `internal["lib/auth"].getMyUserId`).
 */
import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import { normalizeLegacySession } from "./lib/sessionTypes";

const isoDaysAgo = (days: number) =>
  new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);

// ───────────────────────────────────────────────────────────────────────
// Athlete snapshot data — used by daily-wisdom, meal-planner, analyse-diet,
// recovery-coach, rehydration-protocol, training-insights, etc.
// One round-trip fetches all the slices the snapshot needs.
// ───────────────────────────────────────────────────────────────────────

export const fetchSnapshotData = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const today = todayIso();
    const sevenDaysAgo = isoDaysAgo(7);
    const fourteenDaysAgo = isoDaysAgo(14);
    const threeDaysAgo = isoDaysAgo(3);

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const weight14d = await ctx.db
      .query("weight_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", fourteenDaysAgo),
      )
      .order("desc")
      .take(60);

    const meals7d = await ctx.db
      .query("meals")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", sevenDaysAgo),
      )
      .take(60);

    // Sum meal_items to produce the meals_with_totals shape.
    const mealTotals7d: Array<{
      date: string;
      total_calories: number;
      total_protein_g: number;
      total_carbs_g: number;
      total_fats_g: number;
    }> = [];
    for (const m of meals7d) {
      const items = await ctx.db
        .query("meal_items")
        .withIndex("by_meal", (q) => q.eq("mealId", m._id))
        .collect();
      const totals = items.reduce(
        (acc, i) => ({
          c: acc.c + i.calories,
          p: acc.p + i.proteinG,
          cb: acc.cb + i.carbsG,
          f: acc.f + i.fatsG,
        }),
        { c: 0, p: 0, cb: 0, f: 0 },
      );
      mealTotals7d.push({
        date: m.date,
        total_calories: totals.c,
        total_protein_g: totals.p,
        total_carbs_g: totals.cb,
        total_fats_g: totals.f,
      });
    }

    const sessions7d = await ctx.db
      .query("gym_sessions")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", sevenDaysAgo),
      )
      .take(30);

    // Sets are session-scoped; collect for all 7d sessions.
    const sets7d: Array<{
      session_id: string;
      weight_kg: number | null;
      reps: number;
      rpe: number | null;
      is_warmup: boolean;
    }> = [];
    const sets3d: Array<{
      weight_kg: number | null;
      reps: number;
      is_warmup: boolean;
    }> = [];
    const threeDaysAgoMs = new Date(threeDaysAgo).getTime();
    for (const s of sessions7d) {
      const rows = await ctx.db
        .query("gym_sets")
        .withIndex("by_session", (q) => q.eq("sessionId", s._id))
        .collect();
      for (const r of rows) {
        sets7d.push({
          session_id: s._id,
          weight_kg: r.weightKg ?? null,
          reps: r.reps,
          rpe: r.rpe ?? null,
          is_warmup: r.isWarmup,
        });
        if (new Date(s.date).getTime() >= threeDaysAgoMs) {
          sets3d.push({
            weight_kg: r.weightKg ?? null,
            reps: r.reps,
            is_warmup: r.isWarmup,
          });
        }
      }
    }

    const sleep7d = await ctx.db
      .query("sleep_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", sevenDaysAgo),
      )
      .take(60);

    const hydration7d = await ctx.db
      .query("hydration_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", sevenDaysAgo),
      )
      .take(60);

    const wellness7d = await ctx.db
      .query("daily_wellness_checkins")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", sevenDaysAgo),
      )
      .take(30);

    const upcomingCamps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const upcomingCamp =
      upcomingCamps
        .filter((c) => !c.isCompleted && c.fightDate >= today)
        .sort((a, b) => a.fightDate.localeCompare(b.fightDate))[0] ?? null;

    const todayWellness =
      wellness7d.find((w) => w.date === today) ?? null;

    return {
      profile: profile
        ? {
            age: profile.age,
            sex: profile.sex,
            height_cm: profile.heightCm,
            current_weight_kg: profile.currentWeightKg,
            goal_weight_kg: profile.goalWeightKg,
            target_date: profile.targetDate,
            activity_level: profile.activityLevel,
            bmr: profile.bmr ?? null,
            tdee: profile.tdee ?? null,
            athlete_type: profile.athleteType ?? null,
            experience_level: profile.experienceLevel ?? null,
            training_frequency: profile.trainingFrequency ?? null,
            ai_recommended_calories: profile.aiRecommendedCalories ?? null,
            ai_recommended_protein_g: profile.aiRecommendedProteinG ?? null,
            ai_recommended_carbs_g: profile.aiRecommendedCarbsG ?? null,
            ai_recommended_fats_g: profile.aiRecommendedFatsG ?? null,
            manual_nutrition_override: profile.manualNutritionOverride ?? null,
            cut_plan_json: profile.cutPlanJson ?? null,
            weigh_in_timing: profile.weighInTiming ?? null,
          }
        : null,
      weight14d: weight14d.map((w) => ({ date: w.date, weight_kg: w.weightKg })),
      mealTotals7d,
      sessions7d: sessions7d.map((s) => ({
        id: s._id,
        date: s.date,
        perceived_fatigue: s.perceivedFatigue ?? null,
      })),
      sets7d,
      sets3d,
      sleep7d: sleep7d.map((s) => ({ date: s.date, hours: s.hours })),
      hydration7d: hydration7d.map((h) => ({ date: h.date, amount_ml: h.amountMl })),
      wellness7d: wellness7d.map((w) => ({
        date: w.date,
        hooper_index: w.hooperIndex ?? null,
        readiness_score: w.readinessScore ?? null,
        sleep_quality: w.sleepQuality,
        sleep_hours: w.sleepHours ?? null,
        stress_level: w.stressLevel,
        fatigue_level: w.fatigueLevel,
        soreness_level: w.sorenessLevel,
        energy_level: w.energyLevel ?? null,
        motivation_level: w.motivationLevel ?? null,
      })),
      todayWellness: todayWellness
        ? {
            soreness_level: todayWellness.sorenessLevel,
            fatigue_level: todayWellness.fatigueLevel,
            sleep_hours: todayWellness.sleepHours ?? null,
            hooper_index: todayWellness.hooperIndex ?? null,
            readiness_score: todayWellness.readinessScore ?? null,
            sleep_quality: todayWellness.sleepQuality,
            stress_level: todayWellness.stressLevel,
            energy_level: todayWellness.energyLevel ?? null,
            motivation_level: todayWellness.motivationLevel ?? null,
          }
        : null,
      fightCamp: upcomingCamp
        ? {
            name: upcomingCamp.name,
            fight_date: upcomingCamp.fightDate,
            starting_weight_kg: upcomingCamp.startingWeightKg ?? null,
            end_weight_kg: upcomingCamp.endWeightKg ?? null,
          }
        : null,
    };
  },
});

// ───────────────────────────────────────────────────────────────────────
// Recovery-coach specific: fight_camp_calendar sessions + personal baselines.
// ───────────────────────────────────────────────────────────────────────

export const fetchRecoveryData = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const today = todayIso();
    const sevenDaysAgo = isoDaysAgo(7);
    const fourteenDaysAgo = isoDaysAgo(14);

    const sessions = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", fourteenDaysAgo),
      )
      .order("desc")
      .take(60);

    const wellness = await ctx.db
      .query("daily_wellness_checkins")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", sevenDaysAgo),
      )
      .order("desc")
      .take(7);

    const baseline = await ctx.db
      .query("personal_baselines")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .first();

    const upcomingCamps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const upcomingCamp =
      upcomingCamps
        .filter((c) => !c.isCompleted && c.fightDate >= today)
        .sort((a, b) => a.fightDate.localeCompare(b.fightDate))[0] ?? null;

    const todayWellness = wellness.find((w) => w.date === today) ?? null;

    return {
      sessions: sessions.map((s) => {
        const { primary, tag } = normalizeLegacySession(s.sessionType, s.sessionTag);
        return {
          date: s.date,
          session_type: primary,
          session_tag: tag,
          duration_minutes: s.durationMinutes,
          rpe: s.rpe,
          intensity: s.intensity,
          intensity_level: s.intensityLevel ?? null,
          soreness_level: s.sorenessLevel ?? null,
          sleep_hours: s.sleepHours ?? null,
          fatigue_level: s.fatigueLevel ?? null,
          sleep_quality: s.sleepQuality ?? null,
          mobility_done: s.mobilityDone ?? null,
          notes: s.notes ?? null,
        };
      }),
      wellness7d: wellness.map((w) => ({
        date: w.date,
        hooper_index: w.hooperIndex ?? null,
        readiness_score: w.readinessScore ?? null,
        sleep_quality: w.sleepQuality,
        sleep_hours: w.sleepHours ?? null,
        stress_level: w.stressLevel,
        fatigue_level: w.fatigueLevel,
        soreness_level: w.sorenessLevel,
        energy_level: w.energyLevel ?? null,
        motivation_level: w.motivationLevel ?? null,
      })),
      todayWellness: todayWellness
        ? {
            date: todayWellness.date,
            hooper_index: todayWellness.hooperIndex ?? null,
            readiness_score: todayWellness.readinessScore ?? null,
            sleep_quality: todayWellness.sleepQuality,
            sleep_hours: todayWellness.sleepHours ?? null,
            stress_level: todayWellness.stressLevel,
            fatigue_level: todayWellness.fatigueLevel,
            soreness_level: todayWellness.sorenessLevel,
            energy_level: todayWellness.energyLevel ?? null,
            motivation_level: todayWellness.motivationLevel ?? null,
          }
        : null,
      baseline: baseline
        ? {
            hooper_mean_60d: baseline.hooperMean60d ?? null,
            sleep_hours_mean_60d: baseline.sleepHoursMean60d ?? null,
            daily_load_mean_14d: baseline.dailyLoadMean14d ?? null,
            hooper_cv_14d: baseline.hooperCv14d ?? null,
            avg_deficit_7d: baseline.avgDeficit7d ?? null,
          }
        : null,
      upcomingCamp: upcomingCamp
        ? { name: upcomingCamp.name, fight_date: upcomingCamp.fightDate }
        : null,
    };
  },
});

// ───────────────────────────────────────────────────────────────────────
// Wizard chat — broad fetch for the conversational agent.
// ───────────────────────────────────────────────────────────────────────

export const fetchWizardChatData = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const today = todayIso();
    const sevenDaysAgo = isoDaysAgo(7);
    const thirtyDaysAgo = isoDaysAgo(30);

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const weightLogs = await ctx.db
      .query("weight_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", thirtyDaysAgo),
      )
      .order("desc")
      .take(15);

    const meals7d = await ctx.db
      .query("meals")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", sevenDaysAgo),
      )
      .order("desc")
      .take(50);

    const nutritionLogs: Array<{
      date: string;
      calories: number;
      protein_g: number;
      carbs_g: number;
      fats_g: number;
      meal_type: string;
      meal_name: string;
    }> = [];
    for (const m of meals7d) {
      const items = await ctx.db
        .query("meal_items")
        .withIndex("by_meal", (q) => q.eq("mealId", m._id))
        .collect();
      const totals = items.reduce(
        (acc, i) => ({
          c: acc.c + i.calories,
          p: acc.p + i.proteinG,
          cb: acc.cb + i.carbsG,
          f: acc.f + i.fatsG,
        }),
        { c: 0, p: 0, cb: 0, f: 0 },
      );
      nutritionLogs.push({
        date: m.date,
        calories: totals.c,
        protein_g: totals.p,
        carbs_g: totals.cb,
        fats_g: totals.f,
        meal_type: m.mealType,
        meal_name: m.mealName,
      });
    }

    const hydrationLogs = await ctx.db
      .query("hydration_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", sevenDaysAgo),
      )
      .order("desc")
      .take(30);

    const trainingLogs = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", sevenDaysAgo),
      )
      .order("desc")
      .take(20);

    const fightWeekPlans = await ctx.db
      .query("fight_week_plans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const fightWeekPlan =
      fightWeekPlans
        .filter((p) => p.fightDate >= today)
        .sort((a, b) => a.fightDate.localeCompare(b.fightDate))[0] ?? null;

    const dietPrefs = await ctx.db
      .query("user_dietary_preferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const wellnessLogs = await ctx.db
      .query("daily_wellness_checkins")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", sevenDaysAgo),
      )
      .order("desc")
      .take(7);

    const insights = await ctx.db
      .query("user_insights")
      .withIndex("by_user_type", (q) => q.eq("userId", userId))
      .take(10);

    const allCamps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const fightCamps = allCamps
      .sort((a, b) => b.fightDate.localeCompare(a.fightDate))
      .slice(0, 4);

    const fightWeekLogs = await ctx.db
      .query("fight_week_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("logDate", sevenDaysAgo),
      )
      .order("desc")
      .take(7);

    return {
      profile: profile
        ? {
            current_weight_kg: profile.currentWeightKg,
            goal_weight_kg: profile.goalWeightKg,
            target_date: profile.targetDate,
            sex: profile.sex,
            age: profile.age,
            height_cm: profile.heightCm,
            activity_level: profile.activityLevel,
            tdee: profile.tdee ?? null,
            ai_recommended_protein_g: profile.aiRecommendedProteinG ?? null,
            ai_recommended_carbs_g: profile.aiRecommendedCarbsG ?? null,
            ai_recommended_fats_g: profile.aiRecommendedFatsG ?? null,
          }
        : null,
      weightLogs: weightLogs.map((w) => ({ date: w.date, weight_kg: w.weightKg })),
      nutritionLogs,
      hydrationLogs: hydrationLogs.map((h) => ({
        date: h.date,
        amount_ml: h.amountMl,
        sodium_mg: h.sodiumMg ?? null,
      })),
      trainingLogs: trainingLogs.map((t) => {
        const { primary, tag } = normalizeLegacySession(t.sessionType, t.sessionTag);
        return {
          date: t.date,
          session_type: primary,
          session_tag: tag,
          duration_minutes: t.durationMinutes,
          rpe: t.rpe,
          soreness_level: t.sorenessLevel ?? null,
          sleep_hours: t.sleepHours ?? null,
        };
      }),
      fightWeekPlan: fightWeekPlan
        ? {
            fight_date: fightWeekPlan.fightDate,
            starting_weight_kg: fightWeekPlan.startingWeightKg,
            target_weight_kg: fightWeekPlan.targetWeightKg,
          }
        : null,
      dietPrefs: dietPrefs
        ? {
            dietary_restrictions: dietPrefs.dietaryRestrictions ?? [],
            disliked_foods: dietPrefs.dislikedFoods ?? [],
            favorite_cuisines: dietPrefs.favoriteCuisines ?? [],
          }
        : null,
      wellnessLogs: wellnessLogs.map((w) => ({
        date: w.date,
        sleep_quality: w.sleepQuality,
        stress_level: w.stressLevel,
        fatigue_level: w.fatigueLevel,
        soreness_level: w.sorenessLevel,
        energy_level: w.energyLevel ?? null,
        motivation_level: w.motivationLevel ?? null,
        sleep_hours: w.sleepHours ?? null,
        hooper_index: w.hooperIndex ?? null,
        readiness_score: w.readinessScore ?? null,
      })),
      insights: insights.map((i) => ({
        insight_type: i.insightType,
        insight_data: i.insightData,
        confidence_score: i.confidenceScore ?? null,
      })),
      fightCamps: fightCamps.map((c) => ({
        name: c.name,
        event_name: c.eventName ?? null,
        fight_date: c.fightDate,
        starting_weight_kg: c.startingWeightKg ?? null,
        end_weight_kg: c.endWeightKg ?? null,
        is_completed: c.isCompleted ?? null,
        performance_feeling: c.performanceFeeling ?? null,
      })),
      fightWeekLogs: fightWeekLogs.map((l) => ({
        log_date: l.logDate,
        weight_kg: l.weightKg ?? null,
        carbs_g: l.carbsG ?? null,
        fluid_intake_ml: l.fluidIntakeMl ?? null,
        sweat_session_min: l.sweatSessionMin ?? null,
        notes: l.notes ?? null,
      })),
    };
  },
});

// ───────────────────────────────────────────────────────────────────────
// Plan history for prior-decisions context block.
// ───────────────────────────────────────────────────────────────────────

export const fetchRecentDecisions = internalQuery({
  args: {
    userId: v.id("users"),
    feature: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, feature, limit }) => {
    return await ctx.db
      .query("ai_decisions")
      .withIndex("by_user_feature_recent", (q) =>
        q.eq("userId", userId).eq("feature", feature),
      )
      .order("desc")
      .take(limit ?? 3);
  },
});

// ───────────────────────────────────────────────────────────────────────
// Reconcile cron support — list pending ai_decisions + per-user data slices.
// ───────────────────────────────────────────────────────────────────────

export const listPendingDecisions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * 86400000;
    const rows = await ctx.db
      .query("ai_decisions")
      .filter((q) =>
        q.and(
          q.eq(q.field("outcomeLoggedAt"), undefined),
          q.gt(q.field("_creationTime"), cutoff),
        ),
      )
      .take(500);
    return rows
      .filter((r) => r.predictionFacts != null)
      .map((r) => ({
        id: r._id,
        userId: r.userId,
        feature: r.feature,
        predictionFacts: r.predictionFacts,
        createdAt: r._creationTime,
      }));
  },
});

export const fetchUserReconcileData = internalQuery({
  args: { userId: v.id("users"), fromDate: v.string() },
  handler: async (ctx, { userId, fromDate }) => {
    const weights = await ctx.db
      .query("weight_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", fromDate),
      )
      .collect();
    const meals = await ctx.db
      .query("meals")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", fromDate),
      )
      .collect();
    const mealTotals: Array<{
      date: string;
      total_calories: number;
      total_protein_g: number;
    }> = [];
    for (const m of meals) {
      const items = await ctx.db
        .query("meal_items")
        .withIndex("by_meal", (q) => q.eq("mealId", m._id))
        .collect();
      const totals = items.reduce(
        (acc, i) => ({
          c: acc.c + i.calories,
          p: acc.p + i.proteinG,
        }),
        { c: 0, p: 0 },
      );
      mealTotals.push({
        date: m.date,
        total_calories: totals.c,
        total_protein_g: totals.p,
      });
    }
    return {
      weightLogs: weights.map((w) => ({ date: w.date, weight_kg: w.weightKg })),
      meals: mealTotals,
    };
  },
});

export const writeReconcileOutcome = internalMutation({
  args: {
    id: v.id("ai_decisions"),
    actualOutcome: v.any(),
    errorPct: v.optional(v.number()),
  },
  handler: async (ctx, { id, actualOutcome, errorPct }) => {
    const row = await ctx.db.get(id);
    if (!row) return false;
    if (row.outcomeLoggedAt != null) return false; // idempotency
    await ctx.db.patch(id, {
      actualOutcome,
      errorPct,
      outcomeLoggedAt: Date.now(),
    });
    return true;
  },
});

export const sweepOldDecisions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 90 * 86400000;
    const old = await ctx.db
      .query("ai_decisions")
      .filter((q) => q.lt(q.field("_creationTime"), cutoff))
      .take(500);
    for (const r of old) {
      await ctx.db.delete(r._id);
    }
    return old.length;
  },
});

// ───────────────────────────────────────────────────────────────────────
// Fight-week feed — used by fight-camp-coach and fight-week-analysis.
// ───────────────────────────────────────────────────────────────────────

export const fetchFightWeekData = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const sevenDaysAgo = isoDaysAgo(7);
    const fourteenDaysAgo = isoDaysAgo(14);

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const allCamps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const today = todayIso();
    const upcomingCamp =
      allCamps
        .filter((c) => !c.isCompleted && c.fightDate >= today)
        .sort((a, b) => a.fightDate.localeCompare(b.fightDate))[0] ?? null;

    const fightWeekLogs = await ctx.db
      .query("fight_week_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("logDate", fourteenDaysAgo),
      )
      .order("desc")
      .take(20);

    const weight14d = await ctx.db
      .query("weight_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", fourteenDaysAgo),
      )
      .order("desc")
      .take(30);

    const hydration7d = await ctx.db
      .query("hydration_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", sevenDaysAgo),
      )
      .take(30);

    return {
      profile: profile
        ? {
            current_weight_kg: profile.currentWeightKg,
            goal_weight_kg: profile.goalWeightKg,
            fight_week_target_kg: profile.fightWeekTargetKg ?? null,
            sex: profile.sex,
            age: profile.age,
            height_cm: profile.heightCm,
            athlete_type: profile.athleteType ?? null,
            target_date: profile.targetDate ?? null,
            cut_plan_json: profile.cutPlanJson ?? null,
          }
        : null,
      upcomingCamp: upcomingCamp
        ? {
            id: upcomingCamp._id,
            name: upcomingCamp.name,
            fight_date: upcomingCamp.fightDate,
            starting_weight_kg: upcomingCamp.startingWeightKg ?? null,
            weigh_in_timing: upcomingCamp.weighInTiming ?? null,
          }
        : null,
      fightWeekLogs: fightWeekLogs.map((l) => ({
        log_date: l.logDate,
        weight_kg: l.weightKg ?? null,
        fluid_intake_ml: l.fluidIntakeMl ?? null,
        carbs_g: l.carbsG ?? null,
        sweat_session_min: l.sweatSessionMin ?? null,
        notes: l.notes ?? null,
      })),
      weight14d: weight14d.map((w) => ({ date: w.date, weight_kg: w.weightKg })),
      hydration7d: hydration7d.map((h) => ({
        date: h.date,
        amount_ml: h.amountMl,
        sodium_mg: h.sodiumMg ?? null,
      })),
    };
  },
});

// ───────────────────────────────────────────────────────────────────────
// Training-summary data (gym sessions + sets for a week).
// ───────────────────────────────────────────────────────────────────────

export const fetchTrainingWeek = internalQuery({
  args: { userId: v.id("users"), weekStart: v.string() },
  handler: async (ctx, { userId, weekStart }) => {
    const weekEnd = new Date(new Date(weekStart).getTime() + 7 * 86400000)
      .toISOString()
      .slice(0, 10);
    const calendarSessions = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", weekStart).lt("date", weekEnd),
      )
      .collect();
    return {
      weekStart,
      weekEnd,
      sessions: calendarSessions.map((s) => {
        const { primary, tag } = normalizeLegacySession(s.sessionType, s.sessionTag);
        return {
          id: s._id,
          date: s.date,
          session_type: primary,
          session_tag: tag,
          intensity: s.intensity,
          intensity_level: s.intensityLevel ?? null,
          duration_minutes: s.durationMinutes,
          rpe: s.rpe,
          bodyweight: s.bodyweight ?? null,
          fatigue_level: s.fatigueLevel ?? null,
          soreness_level: s.sorenessLevel ?? null,
          sleep_hours: s.sleepHours ?? null,
          notes: s.notes ?? null,
          techniques_notes: s.techniquesNotes ?? null,
        };
      }),
    };
  },
});

// Prior recap state for a week: the server-only per-session cache + the last
// summary snapshot (for headline/watch-out carry-over). Used by the incremental
// training-summary action to reuse unchanged sessions.
export const fetchWeekRecapCache = internalQuery({
  args: { userId: v.id("users"), weekStart: v.string() },
  handler: async (ctx, { userId, weekStart }) => {
    const row = await ctx.db
      .query("training_summaries")
      .withIndex("by_user_week", (q) =>
        q.eq("userId", userId).eq("weekStart", weekStart),
      )
      .first();
    if (!row) return null;
    return {
      sessionCache: row.sessionCache ?? [],
      summaryData: row.summaryData ?? null,
    };
  },
});
