/**
 * Coach-mode aggregation queries.
 *
 * Replaces the Postgres SECURITY DEFINER RPCs that powered the coach
 * dashboard:
 *   - my_gyms_overview     → (lives in gyms.ts as `listMine`)
 *   - coach_athletes_overview  → `athletesOverview`
 *   - coach_athlete_detail     → `athleteDetail`
 *
 * Realtime fan-out (the SQL `coach_realtime_events` table + triggers) is
 * GONE. Convex re-runs `athletesOverview` and `athleteDetail`
 * automatically whenever any athlete writes to `weight_logs`, `meals`,
 * `fight_camp_calendar`, etc. The reactivity is free; the coach UI just
 * calls `useQuery(api.coach.athletesOverview)` and gets live updates.
 *
 * Performance note: these are read-heavy fan-out queries (one coach can
 * have N athletes × 7-14 days × multiple log tables). Every read uses
 * an index, and per-athlete reads are issued in parallel via Promise.all.
 * If `athletesOverview` becomes a bottleneck on a coach with 50+
 * athletes, consider:
 *   1. Caching the 7-day strain summary into a denormalised column.
 *   2. Splitting into `athletesOverviewLite` (just names + last weight)
 *      for the dashboard list, with the heavy strain calc lazy-loaded
 *      per row on tap.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUserId } from "./lib/auth";

// ─────────────────────────────────────────────────────────────────────────
// Date helpers — coach queries are date-window heavy.
// ─────────────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoNDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Resolve a Convex Storage id to a long-lived URL, or null. Small helper
 *  used by every coach query that returns avatars / gym logos. */
async function resolveStorageUrl(
  ctx: QueryCtx,
  id: Id<"_storage"> | undefined | null,
): Promise<string | null> {
  if (!id) return null;
  return await ctx.storage.getUrl(id);
}

/** Builds a 7-element array of RPE-hours (oldest -> newest), one bucket
 *  per day. Used for the StrainSparkline in CoachDashboard. */
function strain7d(
  sessions: { date: string; rpe: number; durationMinutes?: number }[],
): number[] {
  const buckets = new Array(7).fill(0) as number[];
  const todayMs = new Date(todayISO()).getTime();
  for (const s of sessions) {
    const sMs = new Date(s.date).getTime();
    const dayDelta = Math.floor((todayMs - sMs) / 86_400_000);
    if (dayDelta < 0 || dayDelta > 6) continue;
    // oldest -> newest: index 6 = today, 0 = 6 days ago.
    const idx = 6 - dayDelta;
    const hours = (s.durationMinutes ?? 0) / 60;
    buckets[idx] += (s.rpe || 0) * hours;
  }
  return buckets.map((v) => +v.toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────
// Access-check helper. Inline in every cross-user read.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Asserts that the calling user is a coach (gym owner OR
 * `member_role: "coach"`) in at least one gym that contains the given
 * athlete as an active athlete-member with shareData = true.
 *
 * Replaces the SQL `coach_can_view_athlete` SECURITY DEFINER function.
 *
 * Returns the membership rows so callers can introspect the gym name etc.
 */
async function assertCoachCanViewAthlete(
  ctx: QueryCtx,
  coachUserId: Id<"users">,
  athleteUserId: Id<"users">,
): Promise<{ gym: Doc<"gyms">; athleteMember: Doc<"gym_members"> }> {
  // 1. Every gym this user is coach-of (either owner or coach-role member).
  const ownedGyms = await ctx.db
    .query("gyms")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", coachUserId))
    .collect();
  const coachMemberships = await ctx.db
    .query("gym_members")
    .withIndex("by_user", (q) => q.eq("userId", coachUserId))
    .filter((q) => q.eq(q.field("memberRole"), "coach"))
    .collect();

  const gymIds = new Set<string>();
  for (const g of ownedGyms) gymIds.add(g._id);
  for (const m of coachMemberships) gymIds.add(m.gymId);

  if (gymIds.size === 0) throw new Error("Not a coach");

  // 2. For each gym, look for the athlete as an active sharing member.
  for (const gid of gymIds) {
    const athleteRow = await ctx.db
      .query("gym_members")
      .withIndex("by_gym_user", (q) =>
        q.eq("gymId", gid as Id<"gyms">).eq("userId", athleteUserId),
      )
      .unique();
    if (
      athleteRow &&
      athleteRow.memberRole === "athlete" &&
      athleteRow.status === "active" &&
      athleteRow.shareData
    ) {
      const gym = await ctx.db.get(gid as Id<"gyms">);
      if (!gym) continue;
      return { gym, athleteMember: athleteRow };
    }
  }
  throw new Error("Coach cannot view this athlete");
}

// ─────────────────────────────────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────────────────────────────────

/**
 * Coach dashboard — one row per athlete across every gym this coach owns,
 * with summary data for the dashboard list view.
 *
 * Privacy: only athletes with `shareData: true` are included. This is the
 * coach-side enforcement of the athlete's per-gym privacy gate.
 *
 * Replicates the SQL `coach_athletes_overview` RPC. The shape returned
 * mirrors `AthleteOverviewRow` in `useCoachData.ts` (snake_case fields)
 * so the React layer compiles unchanged.
 */
export const athletesOverview = query({
  args: {},
  handler: async (ctx) => {
    const coachUserId = await requireUserId(ctx);

    // 1. Every gym the coach owns. (We don't fan-out to gyms where the
    //    coach is just a coach-role member; the dashboard is for gym
    //    owners. If you need that, extend with `coachMemberships` like
    //    `assertCoachCanViewAthlete` does.)
    const gyms = await ctx.db
      .query("gyms")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", coachUserId))
      .collect();
    if (gyms.length === 0) return [];

    // 2. For each gym, list its active sharing athletes.
    const sevenDaysAgo = isoNDaysAgo(7);
    const today = todayISO();

    const allRows = await Promise.all(
      gyms.map(async (gym) => {
        const members = await ctx.db
          .query("gym_members")
          .withIndex("by_gym", (q) => q.eq("gymId", gym._id))
          .collect();
        const athletes = members.filter(
          (m) =>
            m.memberRole === "athlete" &&
            m.status === "active" &&
            m.shareData,
        );

        // Per-athlete fan-out: read profile + latest weight + today's
        // meals total + 7d sessions in parallel.
        // Resolve the gym's logo URL once per gym (shared across all athletes).
        const gymLogoUrl = await resolveStorageUrl(ctx, gym.logoStorageId);

        return Promise.all(
          athletes.map(async (m) => {
            const [profile, latestWeight, todayMeals, recent7dSessions, latestFightForm] =
              await Promise.all([
                ctx.db
                  .query("profiles")
                  .withIndex("by_user", (q) => q.eq("userId", m.userId))
                  .unique(),
                ctx.db
                  .query("weight_logs")
                  .withIndex("by_user_date", (q) => q.eq("userId", m.userId))
                  .order("desc")
                  .first(),
                ctx.db
                  .query("meals")
                  .withIndex("by_user_date", (q) =>
                    q.eq("userId", m.userId).eq("date", today),
                  )
                  .collect(),
                ctx.db
                  .query("fight_camp_calendar")
                  .withIndex("by_user_date", (q) =>
                    q.eq("userId", m.userId).gte("date", sevenDaysAgo),
                  )
                  .collect(),
                // Newest fight-form score so the coach list can show each
                // athlete's current readiness number at a glance. Indexed
                // read; cheap.
                ctx.db
                  .query("fight_form_scores")
                  .withIndex("by_user_date", (q) => q.eq("userId", m.userId))
                  .order("desc")
                  .first(),
              ]);

            // Last meal across any date — used for the "last_meal_at"
            // column. Cheap because we only need _creationTime, not items.
            const lastMeal = await ctx.db
              .query("meals")
              .withIndex("by_user_created", (q) => q.eq("userId", m.userId))
              .order("desc")
              .first();

            // Today's calories — sum across meal_items for today's meals.
            let todaysCalories = 0;
            if (todayMeals.length > 0) {
              const itemsBatches = await Promise.all(
                todayMeals.map((meal) =>
                  ctx.db
                    .query("meal_items")
                    .withIndex("by_meal", (q) => q.eq("mealId", meal._id))
                    .collect(),
                ),
              );
              for (const batch of itemsBatches) {
                for (const it of batch) todaysCalories += it.calories || 0;
              }
            }

            const avatarUrl = await resolveStorageUrl(
              ctx,
              profile?.avatarStorageId,
            );
            return {
              user_id: m.userId,
              gym_id: gym._id,
              gym_name: gym.name,
              gym_logo_url: gymLogoUrl,
              display_name: profile?.displayName ?? "Athlete",
              avatar_url: avatarUrl,
              goal_type: profile?.goalType ?? null,
              current_weight_kg: profile?.currentWeightKg ?? null,
              goal_weight_kg: profile?.goalWeightKg ?? null,
              fight_week_target_kg: profile?.fightWeekTargetKg ?? null,
              target_date: profile?.targetDate ?? null,
              last_weight_at: latestWeight
                ? new Date(latestWeight._creationTime).toISOString()
                : null,
              todays_calories: todaysCalories,
              daily_calorie_goal: profile?.aiRecommendedCalories ?? null,
              last_meal_at: lastMeal
                ? new Date(lastMeal._creationTime).toISOString()
                : null,
              share_data: m.shareData,
              joined_at: new Date(m.joinedAt).toISOString(),
              strain_7d: strain7d(
                recent7dSessions.map((s) => ({
                  date: s.date,
                  rpe: s.rpe,
                  durationMinutes: s.durationMinutes,
                })),
              ),
              fight_form: latestFightForm
                ? {
                    date: latestFightForm.date,
                    score: latestFightForm.displayedScore,
                    label: latestFightForm.label,
                    state: latestFightForm.state,
                    // Camp phase drives the coach-row phase pill (Build / Peak /
                    // Fight Week). Null when the athlete isn't in a dated camp.
                    phase: latestFightForm.phase ?? null,
                  }
                : null,
            };
          }),
        );
      }),
    );

    // Flatten gym -> athlete arrays and sort by display name for stable
    // rendering.
    return allRows
      .flat()
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
  },
});

/**
 * Coach mode — full detail for a single athlete. Requires
 * coach-can-view-athlete check.
 *
 * Returns the same shape as the SQL `coach_athlete_detail` RPC consumes
 * in `useAthleteDetail.ts` so AthleteDetail.tsx compiles unchanged.
 */
export const athleteDetail = query({
  args: { athleteUserId: v.id("users") },
  handler: async (ctx, { athleteUserId }) => {
    const coachUserId = await requireUserId(ctx);
    const { gym, athleteMember } = await assertCoachCanViewAthlete(
      ctx,
      coachUserId,
      athleteUserId,
    );

    const sevenDaysAgo = isoNDaysAgo(7);
    const fourteenDaysAgo = isoNDaysAgo(14);
    const today = todayISO();

    const [
      profile,
      weight14d,
      latestWeight,
      todayMeals,
      recentSessions,
      fightForm14d,
      camps,
    ] = await Promise.all([
      ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", athleteUserId))
        .unique(),
      ctx.db
        .query("weight_logs")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", athleteUserId).gte("date", fourteenDaysAgo),
        )
        .collect(),
      // Latest logged weight across all history — the athlete's LIVE current
      // weight. `profiles.currentWeightKg` is a denormalised onboarding/last-
      // applied snapshot that lags behind day-to-day weigh-ins, which is one
      // of the staleness sources the coach saw. Indexed `.first()` is cheap.
      ctx.db
        .query("weight_logs")
        .withIndex("by_user_date", (q) => q.eq("userId", athleteUserId))
        .order("desc")
        .first(),
      ctx.db
        .query("meals")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", athleteUserId).eq("date", today),
        )
        .collect(),
      ctx.db
        .query("fight_camp_calendar")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", athleteUserId).gte("date", sevenDaysAgo),
        )
        .collect(),
      // 14-day fight-form history powers both the latest score readout and
      // the trend sparkline on the coach's athlete-detail page.
      ctx.db
        .query("fight_form_scores")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", athleteUserId).gte("date", fourteenDaysAgo),
        )
        .collect(),
      // All fight camps so we can derive the athlete's LIVE current camp
      // (same rule as `fight_camp.getActiveCamp`) instead of reading the
      // stale denormalised `profiles.targetDate`. Bounded slice — typical
      // athletes have < 50 camps.
      ctx.db
        .query("fight_camps")
        .withIndex("by_user", (q) => q.eq("userId", athleteUserId))
        .order("desc")
        .take(50),
    ]);

    // Derive the athlete's CURRENT fight camp using the canonical project
    // rule (mirrors `fight_camp.getActiveCamp`): the nearest upcoming
    // NON-completed camp (`!isCompleted && fightDate >= today`), soonest
    // first. When nothing is upcoming, fall back to the most-recent camp by
    // fightDate so a just-passed fight still surfaces. This is the live
    // source of truth for the fight date — `profiles.targetDate` is only
    // patched as a side-effect of plan generation and goes stale whenever
    // the athlete edits a camp date, completes a camp, or starts a new one
    // without regenerating their plan.
    const upcomingCamps = camps
      .filter((c) => !c.isCompleted && c.fightDate >= today)
      .sort((a, b) => a.fightDate.localeCompare(b.fightDate));
    const currentCamp =
      upcomingCamps[0] ??
      [...camps].sort((a, b) => b.fightDate.localeCompare(a.fightDate))[0] ??
      null;

    // Today's macros — sum items across today's meals.
    let calories = 0;
    let proteinG = 0;
    let carbsG = 0;
    let fatsG = 0;
    if (todayMeals.length > 0) {
      const itemBatches = await Promise.all(
        todayMeals.map((meal) =>
          ctx.db
            .query("meal_items")
            .withIndex("by_meal", (q) => q.eq("mealId", meal._id))
            .collect(),
        ),
      );
      for (const batch of itemBatches) {
        for (const it of batch) {
          calories += it.calories || 0;
          proteinG += it.proteinG || 0;
          carbsG += it.carbsG || 0;
          fatsG += it.fatsG || 0;
        }
      }
    }

    // Recent sessions w/ optional soreness join from daily_wellness_checkins.
    const sortedSessions = [...recentSessions].sort((a, b) =>
      a.date < b.date ? 1 : -1,
    );
    const topSessions = sortedSessions.slice(0, 10);
    // Batch the wellness join: ONE indexed range read over these sessions' date
    // window, joined by date in memory. Replaces a per-session N+1 (one
    // `.unique()` call per session). At most one checkin exists per
    // (user, date), so a Map keyed by date reproduces the old `.unique()`
    // result exactly.
    const sorenessByDate = new Map<string, number>();
    if (topSessions.length > 0) {
      let minDate = topSessions[0].date;
      let maxDate = topSessions[0].date;
      for (const s of topSessions) {
        if (s.date < minDate) minDate = s.date;
        if (s.date > maxDate) maxDate = s.date;
      }
      const checkins = await ctx.db
        .query("daily_wellness_checkins")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", athleteUserId).gte("date", minDate).lte("date", maxDate),
        )
        .collect();
      for (const c of checkins) sorenessByDate.set(c.date, c.sorenessLevel);
    }
    const recentWithSoreness = topSessions.map((s) => ({
      date: s.date,
      session_type: s.sessionType,
      rpe: s.rpe,
      soreness_level: sorenessByDate.get(s.date) ?? null,
      duration_minutes: s.durationMinutes,
    }));

    const profileAvatarUrl = await resolveStorageUrl(
      ctx,
      profile?.avatarStorageId,
    );

    // Sort the fight-form rows ascending so the trend sparkline renders
    // oldest → newest without re-sorting on the client; pluck the latest
    // row for the hero readout.
    const sortedFightForm = [...fightForm14d].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const latestFightForm = sortedFightForm[sortedFightForm.length - 1] ?? null;

    return {
      profile: profile
        ? {
            id: profile.userId,
            display_name: profile.displayName ?? "Athlete",
            athlete_type: profile.athleteType ?? null,
            avatar_url: profileAvatarUrl,
            goal_type: profile.goalType ?? null,
            // LIVE current weight = latest weigh-in, not the lagging
            // `profiles.currentWeightKg` snapshot.
            current_weight_kg:
              latestWeight?.weightKg ?? profile.currentWeightKg ?? null,
            goal_weight_kg: profile.goalWeightKg ?? null,
            fight_week_target_kg: profile.fightWeekTargetKg ?? null,
            // LIVE fight date = current camp's fightDate (canonical
            // nearest-upcoming-non-completed rule). Falls back to the
            // profile snapshot only when the athlete has no camps at all.
            target_date:
              currentCamp?.fightDate ?? profile.targetDate ?? null,
            ai_recommended_calories: profile.aiRecommendedCalories ?? null,
            ai_recommended_protein_g: profile.aiRecommendedProteinG ?? null,
            ai_recommended_carbs_g: profile.aiRecommendedCarbsG ?? null,
            ai_recommended_fats_g: profile.aiRecommendedFatsG ?? null,
          }
        : null,
      weight_7d: weight14d
        .filter((w) => w.date >= sevenDaysAgo)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((w) => ({ date: w.date, weight_kg: w.weightKg })),
      strain_7d: strain7d(
        recentSessions.map((s) => ({
          date: s.date,
          rpe: s.rpe,
          durationMinutes: s.durationMinutes,
        })),
      ),
      today_macros: {
        calories,
        protein_g: proteinG,
        carbs_g: carbsG,
        fats_g: fatsG,
      },
      recent_sessions: recentWithSoreness,
      // Fight-form snapshot + trend so the coach can see how an athlete
      // is tracking against their fight readiness without leaving the
      // detail page. Mirrors the athlete's own dashboard ring.
      fight_form: latestFightForm
        ? {
            date: latestFightForm.date,
            score: latestFightForm.displayedScore,
            raw_score: latestFightForm.rawScore,
            label: latestFightForm.label,
            state: latestFightForm.state,
            phase: latestFightForm.phase ?? null,
            top_driver: latestFightForm.topDriver,
            top_limiter: latestFightForm.topLimiter,
            applied_ceiling: latestFightForm.appliedCeiling
              ? {
                  rule_id: latestFightForm.appliedCeiling.ruleId,
                  cap: latestFightForm.appliedCeiling.cap,
                }
              : null,
            sub_scores: {
              training_load: latestFightForm.subScores.trainingLoad,
              sleep: latestFightForm.subScores.sleep,
              weight_cut: latestFightForm.subScores.weightCut,
              wellness: latestFightForm.subScores.wellness,
              nutrition_adherence:
                latestFightForm.subScores.nutritionAdherence,
            },
          }
        : null,
      fight_form_trend: sortedFightForm.map((r) => ({
        date: r.date,
        score: r.displayedScore,
        state: r.state,
      })),
      membership: {
        share_data: athleteMember.shareData,
        status: athleteMember.status,
        joined_at: new Date(athleteMember.joinedAt).toISOString(),
        gym_name: gym.name,
      },
    };
  },
});

/**
 * Coach's gyms with member-count + recent-announcement-count badges.
 * Used by CoachDashboard's per-gym header. Replicates `my_gyms_overview`
 * from the coach perspective.
 */
export const myGymsOverview = query({
  args: {},
  handler: async (ctx) => {
    const coachUserId = await requireUserId(ctx);
    const gyms = await ctx.db
      .query("gyms")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", coachUserId))
      .collect();

    return Promise.all(
      gyms
        .sort((a, b) => a._creationTime - b._creationTime)
        .map(async (gym) => {
          const members = await ctx.db
            .query("gym_members")
            .withIndex("by_gym", (q) => q.eq("gymId", gym._id))
            .collect();
          const activeAthletes = members.filter(
            (m) => m.memberRole === "athlete" && m.status === "active",
          ).length;

          const sevenDaysAgoMs = Date.now() - 7 * 86_400_000;
          const recentAnnouncements = await ctx.db
            .query("gym_announcements")
            .withIndex("by_gym_created", (q) => q.eq("gymId", gym._id))
            .order("desc")
            .take(50);
          const recentAnnouncementCount = recentAnnouncements.filter(
            (a) => a._creationTime >= sevenDaysAgoMs,
          ).length;

          const logoUrl = await resolveStorageUrl(ctx, gym.logoStorageId);
          return {
            id: gym._id,
            name: gym.name,
            invite_code: gym.inviteCode,
            location: gym.location ?? null,
            logo_url: logoUrl,
            disciplines: gym.disciplines ?? null,
            fighter_count: gym.fighterCount ?? null,
            about: gym.about ?? null,
            athlete_count: activeAthletes,
            recent_announcement_count: recentAnnouncementCount,
            created_at: new Date(gym._creationTime).toISOString(),
          };
        }),
    );
  },
});
