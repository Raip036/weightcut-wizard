/**
 * Public `weekly` query for the per-gym training-volume leaderboard.
 *
 * Live aggregate: no cron, no materialised table. Range-scans
 * `fight_camp_calendar` via the `by_gym_date` index for the rolling 7-day
 * window, then defers minute-sum + tie-preserving ranking to the pure
 * helpers in `./lib/leaderboardAggregation`. Convex reactivity propagates
 * updates to subscribers automatically whenever any matching row changes.
 *
 * Privacy + auth (server-side, mirrors what RLS would have done):
 *   1. Caller must be an active `gym_members` row for the requested gym.
 *   2. If the caller has opted out (`shareData=false`) we return `null` so
 *      the host page can render the "enable sharing" disclaimer.
 *   3. We aggregate only over active members whose `shareData=true`.
 */
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireUserId } from "./lib/auth";
import {
  aggregateLeaderboard,
  assignRanks,
  type AggregatedLeaderboardEntry,
  type LeaderboardSourceRow,
  type RankedLeaderboardEntry,
} from "./lib/leaderboardAggregation";

const WINDOW_DAYS = 7;
const MAX_RANKED_ROWS = 50;
// How long a materialised cache row stays servable before we fall back to a
// live recompute. Mirrors the ~15-minute recompute cron with headroom.
const CACHE_FRESH_MS = 20 * 60 * 1000;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Map materialised cache rows into the `AggregatedLeaderboardEntry` shape the
 * ranking helper expects, applying the same live filters the read path needs:
 *   - keep only users still in the LIVE active+shareData set (so opt-out is
 *     honoured instantly on read, never trusted from the cache),
 *   - when a `discipline` is given, use that discipline's minutes as the
 *     ranking total and drop users with zero minutes in it (mirroring the live
 *     per-discipline aggregation, where `topDiscipline` collapses to the
 *     filtered discipline).
 */
function aggregatedFromCache(
  rows: {
    userId: Id<"users">;
    totalMinutes: number;
    sessionCount: number;
    topDiscipline: string;
    minutesByDiscipline: Record<string, number>;
  }[],
  shareDataUserIds: Set<string>,
  discipline?: string,
): AggregatedLeaderboardEntry[] {
  const result: AggregatedLeaderboardEntry[] = [];
  for (const row of rows) {
    if (!shareDataUserIds.has(row.userId as string)) continue;
    if (discipline) {
      const minutes = row.minutesByDiscipline[discipline] ?? 0;
      if (minutes <= 0) continue;
      result.push({
        userId: row.userId as string,
        totalMinutes: minutes,
        sessionCount: row.sessionCount,
        topDiscipline: discipline,
      });
    } else {
      result.push({
        userId: row.userId as string,
        totalMinutes: row.totalMinutes,
        sessionCount: row.sessionCount,
        topDiscipline: row.topDiscipline,
      });
    }
  }
  return result;
}

/**
 * Shared finalisation for both the cached and live paths: hydrate the top rows
 * with profile data, split podium/ranks, compute the caller's own rank, and
 * return the public response shape. Both paths feed in already-ranked entries
 * plus the window they were computed over, so the returned shape is identical.
 */
async function shapeLeaderboardResponse(
  ctx: QueryCtx,
  ranked: RankedLeaderboardEntry[],
  userId: Id<"users">,
  windowStart: string,
  windowEnd: string,
) {
  // Hydrate top MAX_RANKED_ROWS with profile data. The `profiles` table stores
  // `displayName` and `avatarStorageId` (a Convex Storage id), NOT a
  // precomputed URL — mirrors the pattern used in `coach.ts`.
  const top = ranked.slice(0, MAX_RANKED_ROWS);
  const hydrated = await Promise.all(
    top.map(async (entry) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) =>
          q.eq("userId", entry.userId as Id<"users">),
        )
        .first();
      const avatarUrl = profile?.avatarStorageId
        ? await ctx.storage.getUrl(profile.avatarStorageId)
        : null;
      return {
        ...entry,
        name: profile?.displayName ?? "Athlete",
        avatarUrl,
      };
    }),
  );

  // Split into podium + ranks-4+.
  const podium = hydrated.filter((e) => e.rank <= 3);
  const ranks = hydrated.filter((e) => e.rank > 3);

  // Compute caller's own rank entry (may be outside top 50). Zero-state: if the
  // caller is entitled to see the board (active + shareData=true) but logged no
  // qualifying sessions this week, return `{ rank: null, totalMinutes: 0,
  // topDiscipline: null }` so the UI can distinguish "haven't trained yet" from
  // "can't see leaderboard" (the latter is signalled by a top-level `null`).
  const callerRanked = ranked.find((e) => e.userId === userId);
  const myRank: {
    rank: number | null;
    totalMinutes: number;
    topDiscipline: string | null;
  } = callerRanked
    ? {
        rank: callerRanked.rank,
        totalMinutes: callerRanked.totalMinutes,
        topDiscipline: callerRanked.topDiscipline,
      }
    : { rank: null, totalMinutes: 0, topDiscipline: null };

  return {
    podium,
    ranks,
    myRank,
    asOf: Date.now(),
    windowStart,
    windowEnd,
    // Privacy: counts only fighters who are active + shareData=true AND have
    // >=1 qualifying session in the window. Opt-out + inactive members are
    // excluded. UI must NOT pair this with a published gym roster size
    // (subtraction would leak opt-out status as a side channel).
    totalRankedFighters: ranked.length,
  };
}

export const weekly = query({
  args: {
    gymId: v.id("gyms"),
    discipline: v.optional(v.string()),
  },
  handler: async (ctx, { gymId, discipline }) => {
    const userId = await requireUserId(ctx);

    // 1. Auth: caller must have an active membership in this gym.
    const callerMembership = await ctx.db
      .query("gym_members")
      .withIndex("by_gym_user", (q) =>
        q.eq("gymId", gymId).eq("userId", userId),
      )
      .first();
    if (!callerMembership || callerMembership.status !== "active") {
      throw new Error("Not a member of this gym");
    }

    // 2. Caller opt-out → return null so host page can render the disclaimer.
    if (!callerMembership.shareData) {
      return null;
    }

    // 3. Build shareData set for the gym (active + shareData=true only). This
    //    is read LIVE on every request so opt-out takes effect instantly — we
    //    never trust the cache for the eligible-member set.
    const members = await ctx.db
      .query("gym_members")
      .withIndex("by_gym", (q) => q.eq("gymId", gymId))
      .collect();
    const shareDataUserIds = new Set<string>(
      members
        .filter((m) => m.status === "active" && m.shareData)
        .map((m) => m.userId as string),
    );

    // 4. Fast path: serve from the materialised cache when it exists, is fresh,
    //    and covers today's window. We still re-filter by the LIVE shareData
    //    set above, so a member who just opted out drops off immediately.
    const cached = await ctx.db
      .query("gym_leaderboard_cache")
      .withIndex("by_gym", (q) => q.eq("gymId", gymId))
      .first();
    if (
      cached &&
      Date.now() - cached.computedAt <= CACHE_FRESH_MS &&
      cached.windowEnd === todayIso()
    ) {
      const aggregated = aggregatedFromCache(
        cached.rows,
        shareDataUserIds,
        discipline,
      );
      const ranked = assignRanks(aggregated);
      return shapeLeaderboardResponse(
        ctx,
        ranked,
        userId,
        cached.windowStart,
        cached.windowEnd,
      );
    }

    // 5. Live fallback (no cache / stale / different window): range-scan the
    //    last 7 days of calendar rows for this gym and aggregate + rank live.
    const windowStart = isoDaysAgo(WINDOW_DAYS - 1);
    const windowEnd = todayIso();
    const rows = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_gym_date", (q) =>
        q.eq("gymId", gymId).gte("date", windowStart).lte("date", windowEnd),
      )
      .collect();

    const sourceRows: LeaderboardSourceRow[] = rows.map((r) => ({
      userId: r.userId as string,
      durationMinutes: r.durationMinutes,
      sessionType: r.sessionType,
    }));
    const aggregated = aggregateLeaderboard({
      rows: sourceRows,
      shareDataUserIds,
      discipline,
    });
    const ranked = assignRanks(aggregated);

    return shapeLeaderboardResponse(
      ctx,
      ranked,
      userId,
      windowStart,
      windowEnd,
    );
  },
});
