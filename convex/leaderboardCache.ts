/**
 * Materialised cache for the per-gym weekly training-volume leaderboard.
 *
 * `gymLeaderboard.weekly` previously range-scanned `fight_camp_calendar` live on
 * every read (and re-ran for every subscriber on every session write). This
 * cron-driven mutation precomputes each gym's rolling 7-day leaderboard into the
 * `gym_leaderboard_cache` table (one row per gym) so the public query can serve
 * a cheap cached read, falling back to live compute when the cache is missing or
 * stale (see `gymLeaderboard.weekly`).
 *
 * Resumable + bounded: paginates the `gyms` table 50 at a time and
 * self-reschedules with the page cursor while more pages remain, so a single
 * tick stays well within Convex's per-transaction limits and we never loop
 * forever (the cursor advances every tick and we stop on `page.isDone`).
 */
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// Rolling window length, mirroring gymLeaderboard.ts.
const WINDOW_DAYS = 7;
// Minimum minutes for a session to count, mirroring the constant inside
// `lib/leaderboardAggregation.ts` (not exported there). Keep these in sync.
const MIN_SESSION_MINUTES = 30;
// Gyms processed per scheduled tick.
const GYM_PAGE_SIZE = 50;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type CacheRow = {
  userId: Id<"users">;
  totalMinutes: number;
  sessionCount: number;
  topDiscipline: string;
  minutesByDiscipline: Record<string, number>;
};

export const recomputeAllGyms = internalMutation({
  // `cursor` threads the gyms-table pagination cursor across self-reschedules.
  // Defaults to null (first page) so the cron can invoke it with no args.
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const windowStart = isoDaysAgo(WINDOW_DAYS - 1);
    const windowEnd = todayIso();
    const computedAt = Date.now();

    const page = await ctx.db
      .query("gyms")
      .paginate({ cursor: cursor ?? null, numItems: GYM_PAGE_SIZE });

    for (const gym of page.page) {
      const gymId = gym._id;

      // 1. Active + shareData=true members for this gym.
      const members = await ctx.db
        .query("gym_members")
        .withIndex("by_gym", (q) => q.eq("gymId", gymId))
        .collect();
      const shareDataMemberIds = new Set<string>(
        members
          .filter((m) => m.status === "active" && m.shareData)
          .map((m) => m.userId as string),
      );

      // Existing cache row (one per gym) for upsert / cleanup.
      const existing = await ctx.db
        .query("gym_leaderboard_cache")
        .withIndex("by_gym", (q) => q.eq("gymId", gymId))
        .first();

      // 2. No eligible members → drop any stale cache row and move on.
      if (shareDataMemberIds.size === 0) {
        if (existing) await ctx.db.delete(existing._id);
        continue;
      }

      // 3. Range-scan the rolling window for this gym.
      const calendarRows = await ctx.db
        .query("fight_camp_calendar")
        .withIndex("by_gym_date", (q) =>
          q.eq("gymId", gymId).gte("date", windowStart).lte("date", windowEnd),
        )
        .collect();

      // 4. Aggregate per eligible user (>= MIN_SESSION_MINUTES sessions only).
      const perUser = new Map<
        string,
        {
          userId: Id<"users">;
          totalMinutes: number;
          sessionCount: number;
          perDiscipline: Map<string, number>;
        }
      >();
      for (const row of calendarRows) {
        if (row.durationMinutes < MIN_SESSION_MINUTES) continue;
        const key = row.userId as string;
        if (!shareDataMemberIds.has(key)) continue;

        const entry = perUser.get(key) ?? {
          userId: row.userId,
          totalMinutes: 0,
          sessionCount: 0,
          perDiscipline: new Map<string, number>(),
        };
        entry.totalMinutes += row.durationMinutes;
        entry.sessionCount += 1;
        entry.perDiscipline.set(
          row.sessionType,
          (entry.perDiscipline.get(row.sessionType) ?? 0) + row.durationMinutes,
        );
        perUser.set(key, entry);
      }

      // 5. Materialise rows (only users with >= 1 qualifying session, which is
      //    every entry that made it into the map).
      const rows: CacheRow[] = [];
      for (const entry of perUser.values()) {
        let topDiscipline = "";
        let topMinutes = -1;
        const minutesByDiscipline: Record<string, number> = {};
        for (const [discipline, minutes] of entry.perDiscipline) {
          minutesByDiscipline[discipline] = minutes;
          if (minutes > topMinutes) {
            topMinutes = minutes;
            topDiscipline = discipline;
          }
        }
        rows.push({
          userId: entry.userId,
          totalMinutes: entry.totalMinutes,
          sessionCount: entry.sessionCount,
          topDiscipline,
          minutesByDiscipline,
        });
      }

      // 6. Upsert the single cache row for this gym.
      if (existing) {
        await ctx.db.patch(existing._id, {
          computedAt,
          windowStart,
          windowEnd,
          rows,
        });
      } else {
        await ctx.db.insert("gym_leaderboard_cache", {
          gymId,
          computedAt,
          windowStart,
          windowEnd,
          rows,
        });
      }
    }

    // More gym pages remain → continue next tick with the advanced cursor.
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.leaderboardCache.recomputeAllGyms,
        { cursor: page.continueCursor },
      );
    }
  },
});
