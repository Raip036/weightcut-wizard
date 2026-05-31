/**
 * Camp activity feed — mixed-source recent-activity stream for the Camp
 * page coach surface. Pulls the most recent N rows from each of the user's
 * logging surfaces (training sessions, weight, sleep, wellness, completed
 * training missions) and merges them into one timeline ordered by
 * `_creationTime` descending.
 *
 * Surfaces unified here:
 *  - `fight_camp_calendar` → "workout" (canonical training-session log;
 *    has sessionType + durationMinutes + rpe directly on the row, unlike
 *    `gym_sessions` which stores RPE per-set)
 *  - `weight_logs`         → "weight"
 *  - `sleep_logs`          → "sleep"
 *  - `daily_wellness_checkins` → "wellness" (note: the field is
 *    `hooperIndex`, not `hooper`)
 *  - `training_missions` (status = completed) → "mission"
 *
 * Index notes:
 *  - All five tables expose `by_user_date` (or `by_user_status` for
 *    missions), so each per-table take(lim) is a bounded indexed scan.
 *    Total reads ≈ 5 × lim, well under any budget.
 *  - `gym_sessions` is intentionally omitted — RPE lives on `gym_sets`
 *    in that surface, which would force an extra fan-out per session
 *    just to display the value, and the canonical training-log surface
 *    in this codebase is `fight_camp_calendar`.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import { optionalUserId } from "./lib/auth";

export type ActivityEventKind =
  | "workout"
  | "weight"
  | "sleep"
  | "wellness"
  | "mission"
  | "meal";

export interface ActivityEvent {
  kind: ActivityEventKind;
  title: string;
  value: string | null;
  timestamp: number; // epoch ms (_creationTime)
  route: string;
}

export const getRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }): Promise<ActivityEvent[]> => {
    const userId = await optionalUserId(ctx);
    if (!userId) return [];

    // Clamp to a sane range; default 7 per the component contract.
    const lim = Math.min(20, Math.max(1, limit ?? 7));

    // Fan-out the most-recent `lim` rows from each surface in parallel.
    // `by_user_date` orders by (userId, date, _creationTime); .order("desc")
    // gives us "newest first" which is exactly what we want before merge.
    const [workouts, weights, sleep, wellness, missions] = await Promise.all([
      ctx.db
        .query("fight_camp_calendar")
        .withIndex("by_user_date", (q) => q.eq("userId", userId))
        .order("desc")
        .take(lim),
      ctx.db
        .query("weight_logs")
        .withIndex("by_user_date", (q) => q.eq("userId", userId))
        .order("desc")
        .take(lim),
      ctx.db
        .query("sleep_logs")
        .withIndex("by_user_date", (q) => q.eq("userId", userId))
        .order("desc")
        .take(lim),
      ctx.db
        .query("daily_wellness_checkins")
        .withIndex("by_user_date", (q) => q.eq("userId", userId))
        .order("desc")
        .take(lim),
      ctx.db
        .query("training_missions")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", userId).eq("status", "completed"),
        )
        .order("desc")
        .take(lim),
    ]);

    const events: ActivityEvent[] = [
      ...workouts.map((w): ActivityEvent => {
        const duration = w.durationMinutes ?? 0;
        const sport = w.sessionType?.trim() || "Training";
        return {
          kind: "workout",
          title: `${sport} — ${duration} min`,
          value: typeof w.rpe === "number" ? `RPE ${w.rpe}` : null,
          timestamp: w._creationTime,
          route: "/training-calendar",
        };
      }),
      ...weights.map((w): ActivityEvent => ({
        kind: "weight",
        title: "Weight logged",
        value: `${w.weightKg.toFixed(1)} kg`,
        timestamp: w._creationTime,
        route: "/weight",
      })),
      ...sleep.map((s): ActivityEvent => ({
        kind: "sleep",
        title: "Sleep logged",
        value: `${s.hours.toFixed(1)} h`,
        timestamp: s._creationTime,
        route: "/sleep",
      })),
      ...wellness.map((w): ActivityEvent => ({
        kind: "wellness",
        title: "Wellness check-in",
        value: typeof w.hooperIndex === "number"
          ? `Hooper ${w.hooperIndex}`
          : null,
        timestamp: w._creationTime,
        route: "/recovery",
      })),
      ...missions.map((m): ActivityEvent => ({
        kind: "mission",
        title: "Mission completed",
        value: m.title,
        // `completedAt` is the user-meaningful moment; fall back to the
        // row's creation time if a historical row predates the field.
        timestamp: m.completedAt ?? m._creationTime,
        route: "/training-calendar",
      })),
    ];

    // Newest first, then trim to the requested cap.
    events.sort((a, b) => b.timestamp - a.timestamp);
    return events.slice(0, lim);
  },
});
