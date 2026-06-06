/**
 * Off-season "Camp Architect" DATA LOADER (2026-06-04, Phase 4).
 *
 * Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md §5
 *       (Phase 4 — Off-season Camp Architect mode).
 *
 * `getArchitectData` is the single internal query the Fight Camp Coach action
 * calls when a fighter has NO upcoming fight, so the coach flips from cutting
 * to planning. It's a query — indexed reads only, no node/fetch — and mirrors
 * `coachCampHistory_internal.ts`: every field degrades to `null` rather than
 * throwing, numbers are rounded, and the action passes the already-resolved
 * `userId` (auth lives at the action barrier).
 *
 * Returns the pure `CampArchitectData` contract from
 * `_shared/coachDomains/campArchitect.ts`, which the matching card builders
 * consume. Computation:
 *   - hasUpcomingCamp:        any fight_camps with fightDate >= today and
 *                             NOT isCompleted.
 *   - walkAroundKg:           median of recent (~30d) weight_logs, falling
 *                             back to profile.currentWeightKg.
 *   - lastFightDate / months: most recent PAST/completed camp's fightDate.
 *   - lastCampCutKg:          that camp's totalWeightCut.
 *   - driftFromWalkAroundKg:  latest logged weight − walkAround.
 *   - suggestedNextCutWeeks:  coarse 8–10 wk band scaled by the drift.
 */
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { CampArchitectData } from "./_shared/coachDomains/campArchitect";

const round1 = (n: number): number => Math.round(n * 10) / 10;
const todayIso = (): string => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

/** Median of a numeric array. Empty → null. Filters non-finite values. */
function median(values: number[]): number | null {
  const xs = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1] + xs[mid]) / 2 : xs[mid];
}

/** Whole calendar months between an ISO date and today (>= 0, rounded). */
function monthsSince(fromIso: string): number | null {
  const from = new Date(fromIso).getTime();
  if (!Number.isFinite(from)) return null;
  const days = (Date.now() - from) / 86400000;
  if (days < 0) return 0;
  return Math.round(days / 30.44);
}

/**
 * Coarse "weeks to allow for the next cut" — deliberately a band, not a
 * precise plan (the real cut plan is generated elsewhere). Baseline 8 weeks
 * for a comfortable base; +1 wk per ~4kg drifted above walk-around, clamped
 * to a sane 8–10 wk window. Null when we can't size the drift.
 */
function suggestNextCutWeeks(driftKg: number | null): number | null {
  if (driftKg === null || !Number.isFinite(driftKg)) return null;
  const extra = Math.max(0, Math.floor(driftKg / 4));
  return Math.min(10, 8 + extra);
}

export const getArchitectData = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<CampArchitectData> => {
    const today = todayIso();

    // Camps (handful per fighter): collected then partitioned in memory.
    const camps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Architect mode is OFF if any camp is genuinely UPCOMING: a future
    // fightDate that isn't already marked completed.
    const hasUpcomingCamp = camps.some(
      (c) => c.isCompleted !== true && c.fightDate >= today,
    );

    // Most recent PAST/completed camp (completed OR fightDate in the past),
    // newest first — drives lastFightDate + lastCampCutKg.
    const pastCamps = camps
      .filter((c) => c.isCompleted === true || c.fightDate < today)
      .sort((a, b) => b.fightDate.localeCompare(a.fightDate));
    const lastCamp = pastCamps[0] ?? null;

    const lastFightDateISO = lastCamp ? lastCamp.fightDate : null;
    const monthsSinceLastFight = lastFightDateISO
      ? monthsSince(lastFightDateISO)
      : null;
    const lastCampCutKg =
      lastCamp && typeof lastCamp.totalWeightCut === "number" &&
      Number.isFinite(lastCamp.totalWeightCut)
        ? round1(lastCamp.totalWeightCut)
        : null;

    // Recent (~30d) weight logs for a stable walk-around estimate.
    const recentLogs = await ctx.db
      .query("weight_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", isoDaysAgo(30)),
      )
      .order("desc")
      .take(60);

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    // Walk-around = median of recent stable logs; fall back to the profile's
    // current weight when there isn't enough logging history.
    const recentMedian = median(recentLogs.map((l) => l.weightKg));
    const profileCurrent =
      profile && Number.isFinite(profile.currentWeightKg)
        ? profile.currentWeightKg
        : null;
    const walkAroundRaw = recentMedian ?? profileCurrent;
    const walkAroundKg = walkAroundRaw !== null ? round1(walkAroundRaw) : null;

    // Latest actual weight (logs are desc; first is newest) → drift vs base.
    const latestWeight =
      recentLogs.length > 0 && Number.isFinite(recentLogs[0].weightKg)
        ? recentLogs[0].weightKg
        : profileCurrent;
    const driftFromWalkAroundKg =
      latestWeight !== null && walkAroundKg !== null
        ? round1(latestWeight - walkAroundKg)
        : null;

    const suggestedNextCutWeeks = suggestNextCutWeeks(driftFromWalkAroundKg);

    return {
      hasUpcomingCamp,
      walkAroundKg,
      lastFightDateISO,
      monthsSinceLastFight,
      lastCampCutKg,
      suggestedNextCutWeeks,
      driftFromWalkAroundKg,
    };
  },
});
