/**
 * Domain-aware coach cards (2026-06-04): the DATA LOADER.
 *
 * `getDomainData` is the single internal query the Fight Camp Coach action
 * calls per turn. The arbiter picks up to 3 relevant domains; this loader
 * hydrates ONLY those slices (every other field on the returned
 * `DomainBundle` stays `undefined`) so we never over-fetch.
 *
 * Contract: `convex/_shared/coachDomains/types.ts` (DomainBundle + slices).
 *
 * It's a query — indexed reads only, no node/fetch. Every slice degrades
 * gracefully: missing data → omitted optional fields / empty arrays, never
 * a throw. Numbers are rounded; series points are kept compact (x = "MM-DD").
 *
 * Tables read per domain:
 *   training_load → fight_camp_calendar (by_user_date)
 *   nutrition     → meals + meal_items (by_user_date / by_meal), profiles (targets)
 *   fight_score   → fight_form_scores (by_user_date, latest)
 *   recovery      → daily_wellness_checkins (readiness)
 *   sleep         → sleep_logs
 */
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { normalizeLegacySession } from "./lib/sessionTypes";
import { sanitizeUserText } from "./_shared/sanitizeUserText";
import type {
  DomainBundle,
  TrainingLoadSlice,
  NutritionSlice,
  FightScoreSlice,
  RecoverySlice,
  SleepSlice,
} from "./_shared/coachDomains/types";

// ───────────────────────────────────────────────────────────────────────
// Date helpers — match the ISO YYYY-MM-DD convention used everywhere else
// (actions_internal.ts). All `date` columns are local-naive ISO strings, so
// indexed range scans (`gte("date", …)`) work lexicographically.
// ───────────────────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;
const isoDaysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);
/** "2026-06-04" → "06-04" for compact chart x-axis labels. */
const toMmDd = (iso: string) => (iso.length >= 10 ? iso.slice(5, 10) : iso);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round0 = (n: number) => Math.round(n);

// ───────────────────────────────────────────────────────────────────────
// getDomainData — the loader. Resolves userId from args (the action passes
// the already-resolved id) and fills exactly the requested slices.
// ───────────────────────────────────────────────────────────────────────
export const getDomainData = internalQuery({
  args: {
    userId: v.id("users"),
    domains: v.array(v.string()),
  },
  handler: async (ctx, { userId, domains }): Promise<DomainBundle> => {
    const want = new Set(domains);
    const bundle: DomainBundle = {};

    if (want.has("training_load")) {
      bundle.trainingLoad = await buildTrainingLoad(ctx, userId);
    }
    if (want.has("nutrition")) {
      bundle.nutrition = await buildNutrition(ctx, userId);
    }
    if (want.has("fight_score")) {
      const slice = await buildFightScore(ctx, userId);
      if (slice) bundle.fightScore = slice;
    }
    if (want.has("recovery")) {
      bundle.recovery = await buildRecovery(ctx, userId);
    }
    if (want.has("sleep")) {
      bundle.sleep = await buildSleep(ctx, userId);
    }

    return bundle;
  },
});

// ───────────────────────────────────────────────────────────────────────
// training_load — last ~7d sessions + this-week vs last-week hours +
// ~6-week weekly-hours series. Source: fight_camp_calendar (the canonical
// training log; carries durationMinutes + intensity + sessionType/Tag).
// ───────────────────────────────────────────────────────────────────────
async function buildTrainingLoad(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<TrainingLoadSlice> {
  // Pull ~6 weeks so we can build the weekly series AND the two week totals
  // from one indexed scan.
  const since = isoDaysAgo(42);
  const rows = await ctx.db
    .query("fight_camp_calendar")
    .withIndex("by_user_date", (q) =>
      q.eq("userId", userId).gte("date", since),
    )
    .order("desc")
    .take(200);

  const today = todayIso();
  const weekStart = isoDaysAgo(7); // [weekStart, today] → "this week"
  const lastWeekStart = isoDaysAgo(14); // [lastWeekStart, weekStart) → "last week"

  let weekMin = 0;
  let lastWeekMin = 0;
  // weekIndex 0 = most recent 7d, 1 = 7-14d ago, … up to 5 (6 buckets).
  const weeklyMin: number[] = [0, 0, 0, 0, 0, 0];

  for (const r of rows) {
    const mins = r.durationMinutes ?? 0;
    if (mins <= 0) continue;
    if (r.date >= weekStart && r.date <= today) weekMin += mins;
    else if (r.date >= lastWeekStart && r.date < weekStart) lastWeekMin += mins;

    const ageDays = Math.floor(
      (new Date(today).getTime() - new Date(r.date).getTime()) / DAY_MS,
    );
    const bucket = Math.floor(ageDays / 7);
    if (bucket >= 0 && bucket < weeklyMin.length) weeklyMin[bucket] += mins;
  }

  // Recent sessions list — newest first, skip Rest days, cap at ~7 entries.
  // Notes (techniques + reflection) are attached ONLY to the most-recent 3
  // sessions: that's enough for the coach to reference what was drilled / what
  // the athlete is working on without bloating the prompt. User free-text is
  // sanitized + length-capped here so the slice carries clean strings.
  const sessions: TrainingLoadSlice["sessions"] = [];
  for (const r of rows) {
    if (sessions.length >= 7) break;
    const { primary } = normalizeLegacySession(r.sessionType, r.sessionTag);
    // Rest days carry 0 load and would otherwise inflate the session count and
    // surface a "0m Rest" line as the athlete's latest training to the coach.
    if (primary === "Rest") continue;
    const entry: TrainingLoadSlice["sessions"][number] = {
      date: r.date,
      type: r.sessionTag ?? primary,
      durationMin: r.durationMinutes ?? 0,
      ...(r.intensity ? { intensity: r.intensity } : {}),
    };
    if (sessions.length < 3) {
      const tech = sanitizeUserText(r.techniquesNotes ?? "", {
        maxLength: 160,
        raw: true,
      }).trim();
      // Reflection notes can carry a leading [RUN_META]{…}[/RUN_META] tag on
      // run sessions — strip it so only human-readable prose reaches the LLM.
      const refl = sanitizeUserText(
        (r.notes ?? "").replace(/^\[RUN_META\][\s\S]*?\[\/RUN_META\]/, ""),
        { maxLength: 160, raw: true },
      ).trim();
      if (tech) entry.techniques = tech;
      if (refl) entry.reflection = refl;
    }
    sessions.push(entry);
  }

  // Oldest → newest so the chart reads left-to-right. Each bucket's label is
  // the start date of that 7-day window.
  const weeklySeries: TrainingLoadSlice["weeklySeries"] = [];
  for (let i = weeklyMin.length - 1; i >= 0; i--) {
    weeklySeries.push({
      x: toMmDd(isoDaysAgo((i + 1) * 7)),
      y: round1(weeklyMin[i] / 60),
    });
  }

  return {
    weekHours: round1(weekMin / 60),
    lastWeekHours: round1(lastWeekMin / 60),
    sessions,
    weeklySeries,
  };
}

// ───────────────────────────────────────────────────────────────────────
// nutrition — today's summed macros, target (profile, if available),
// last ~5 meals, ~7-day kcal series. Source: meals + meal_items, profiles.
// ───────────────────────────────────────────────────────────────────────
async function buildNutrition(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<NutritionSlice> {
  const today = todayIso();
  const sevenDaysAgo = isoDaysAgo(7);

  const meals = await ctx.db
    .query("meals")
    .withIndex("by_user_date", (q) =>
      q.eq("userId", userId).gte("date", sevenDaysAgo),
    )
    .order("desc")
    .take(80);

  // Sum items per meal → per-meal totals. One pass also feeds the day series
  // and today's macro totals.
  const today_ = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const kcalByDate = new Map<string, number>();
  type MealTotal = { name: string; kcal: number; when: string; date: string };
  const mealTotals: MealTotal[] = [];

  for (const m of meals) {
    const items = await ctx.db
      .query("meal_items")
      .withIndex("by_meal", (q) => q.eq("mealId", m._id))
      .collect();
    const t = items.reduce(
      (acc, i) => ({
        c: acc.c + i.calories,
        p: acc.p + i.proteinG,
        cb: acc.cb + i.carbsG,
        f: acc.f + i.fatsG,
      }),
      { c: 0, p: 0, cb: 0, f: 0 },
    );

    kcalByDate.set(m.date, (kcalByDate.get(m.date) ?? 0) + t.c);
    if (m.date === today) {
      today_.kcal += t.c;
      today_.protein += t.p;
      today_.carbs += t.cb;
      today_.fat += t.f;
    }
    mealTotals.push({
      name: m.mealName,
      kcal: round0(t.c),
      when: m.mealType,
      date: m.date,
    });
  }

  // recentMeals — newest first (meals already came desc, but _creationTime
  // within a day isn't guaranteed by the date index, so keep insertion order
  // which is desc-by-date). Cap at 5.
  const recentMeals: NutritionSlice["recentMeals"] = mealTotals
    .slice(0, 5)
    .map(({ name, kcal, when }) => ({ name, kcal, when }));

  // 7-day kcal series, oldest → newest, one point per day (0 when no meals).
  const kcalSeries: NutritionSlice["kcalSeries"] = [];
  for (let i = 6; i >= 0; i--) {
    const d = isoDaysAgo(i);
    kcalSeries.push({ x: toMmDd(d), y: round0(kcalByDate.get(d) ?? 0) });
  }

  // Target macros — prefer AI-recommended (last applied), else fall back to
  // tdee for kcal. All optional; omit when not present.
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

  let target: NutritionSlice["target"] | undefined;
  if (profile) {
    const t: NonNullable<NutritionSlice["target"]> = {};
    const kcal = profile.aiRecommendedCalories ?? profile.tdee;
    if (kcal != null) t.kcal = round0(kcal);
    if (profile.aiRecommendedProteinG != null)
      t.protein = round0(profile.aiRecommendedProteinG);
    if (profile.aiRecommendedCarbsG != null)
      t.carbs = round0(profile.aiRecommendedCarbsG);
    if (profile.aiRecommendedFatsG != null)
      t.fat = round0(profile.aiRecommendedFatsG);
    if (Object.keys(t).length > 0) target = t;
  }

  return {
    today: {
      kcal: round0(today_.kcal),
      protein: round0(today_.protein),
      carbs: round0(today_.carbs),
      fat: round0(today_.fat),
    },
    ...(target ? { target } : {}),
    recentMeals,
    kcalSeries,
  };
}

// ───────────────────────────────────────────────────────────────────────
// fight_score — latest fight_form_scores row. subScores are mapped to
// label/value pairs (value scaled to 0-100 for display consistency with
// the headline displayedScore). Returns undefined when no score exists yet.
// ───────────────────────────────────────────────────────────────────────
async function buildFightScore(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<FightScoreSlice | undefined> {
  const latest = await ctx.db
    .query("fight_form_scores")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .order("desc")
    .first();
  if (!latest) return undefined;

  // sub-score values are stored 0-1; surface as 0-100 to match the headline.
  const SUB_LABELS: Record<string, string> = {
    trainingLoad: "Training Load",
    sleep: "Sleep",
    weightCut: "Weight Cut",
    wellness: "Wellness",
    nutritionAdherence: "Nutrition",
    recovery: "Recovery",
  };
  const subScores: FightScoreSlice["subScores"] = [];
  const ss = latest.subScores as Record<string, { value?: number } | undefined>;
  for (const key of Object.keys(SUB_LABELS)) {
    const entry = ss[key];
    if (!entry || typeof entry.value !== "number") continue;
    subScores.push({ label: SUB_LABELS[key], value: round0(entry.value * 100) });
  }

  // Calibrating: not enough logged data yet, so displayedScore is 0 and `label`
  // is just a default placeholder ("off_pace"). Flag it so downstream reframes
  // this as "still building a baseline" instead of reporting a low score.
  const calibrating = latest.state === "calibrating";

  return {
    score: round0(latest.displayedScore),
    status: latest.label,
    ...(latest.phase ? { phase: latest.phase } : {}),
    ...(latest.topLimiter ? { topLimiter: latest.topLimiter } : {}),
    subScores,
    ...(calibrating ? { calibrating: true } : {}),
  };
}

// ───────────────────────────────────────────────────────────────────────
// recovery — latest self-reported readiness.
// Sourced solely from the wellness check-in (Apple HealthKit was removed —
// App Store Guideline 2.5.1), so HRV/RHR/HRV-series are no longer surfaced.
// ───────────────────────────────────────────────────────────────────────
async function buildRecovery(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<RecoverySlice> {
  const slice: RecoverySlice = {};

  // Readiness — latest self-reported readinessScore in the last ~14d.
  const checkins = await ctx.db
    .query("daily_wellness_checkins")
    .withIndex("by_user_date", (q) =>
      q.eq("userId", userId).gte("date", isoDaysAgo(14)),
    )
    .order("desc")
    .take(14);
  const latestReadiness = checkins.find((c) => c.readinessScore != null);
  if (latestReadiness?.readinessScore != null)
    slice.readiness = round0(latestReadiness.readinessScore);

  return slice;
}

// ───────────────────────────────────────────────────────────────────────
// sleep — last-night hours, ~7-day avg + series.
// Sourced solely from the self-reported sleep_logs (Apple HealthKit was
// removed — App Store Guideline 2.5.1). All optional.
// ───────────────────────────────────────────────────────────────────────
async function buildSleep(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<SleepSlice> {
  // hours-by-date over the last 7 days.
  const sevenDaysAgo = isoDaysAgo(7);
  const hoursByDate = new Map<string, number>();

  const logs = await ctx.db
    .query("sleep_logs")
    .withIndex("by_user_date", (q) =>
      q.eq("userId", userId).gte("date", sevenDaysAgo),
    )
    .take(14);
  for (const l of logs) {
    if (!hoursByDate.has(l.date) && l.hours > 0) hoursByDate.set(l.date, l.hours);
  }

  const slice: SleepSlice = {};

  // Series — oldest → newest, only days with a value.
  const series = [...hoursByDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, hours]) => ({ x: toMmDd(date), y: round1(hours) }));
  if (series.length > 0) slice.series = series;

  // Last night = most recent dated value.
  if (series.length > 0) slice.lastNightHours = series[series.length - 1].y;

  // 7-day average over the days we have data for.
  if (hoursByDate.size > 0) {
    const sum = [...hoursByDate.values()].reduce((a, b) => a + b, 0);
    slice.avgHours = round1(sum / hoursByDate.size);
  }

  return slice;
}
