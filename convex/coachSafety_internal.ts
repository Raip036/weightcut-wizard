import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { SafetyInput } from "./_shared/coachSafety";
import { computeFightWeekProjection } from "./_shared/fightWeekMath";

/**
 * Phase 3 — Fight Camp Coach redesign: the safety data loader.
 *
 * Assembles the `SafetyInput` consumed by the safety evaluator
 * (`convex/_shared/coachSafety.ts`). Pure indexed query-runtime reads — no
 * Node/fetch. Every field degrades to `null` on missing data so the evaluator
 * can reason about partial signals without this loader ever throwing.
 *
 * Metric-string constants for `health_baselines` mirror those written by
 * `internal.health.computeBaselines` (see `fightFormScore_internal.ts`).
 */
const HEALTH_METRIC = {
  hrv: "hrv_sdnn",
  restingHr: "resting_hr",
} as const;

/** Local YYYY-MM-DD for "today" (UTC; matches the date strings stored in DB). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days between today and an ISO (YYYY-MM-DD) date; null on bad input. */
function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const target = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const today = Date.parse(`${todayIso()}T00:00:00Z`);
  return Math.round((target - today) / 86_400_000);
}

/**
 * Map the deterministic fight-week risk (`green`/`orange`/`red`) onto the
 * coach-safety vocabulary (`low`/`moderate`/`high`).
 */
function mapRisk(
  risk: "green" | "orange" | "red",
): "low" | "moderate" | "high" {
  if (risk === "red") return "high";
  if (risk === "orange") return "moderate";
  return "low";
}

export const getSafetyInput = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<SafetyInput> => {
    // ── Active camp (earliest upcoming fight) ──────────────────────────────
    // Same selection convention as actions_internal.ts: among the user's
    // camps, the nearest fight on/after today is the "active" one.
    const today = todayIso();
    const camps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const activeCamp =
      camps
        .filter((c) => c.fightDate >= today)
        .sort((a, b) => a.fightDate.localeCompare(b.fightDate))[0] ?? null;

    const daysToWeighIn = daysUntil(activeCamp?.fightDate);

    // ── Rate of loss over the last ~7 days of weight logs ──────────────────
    // %BW/week = (earliest - latest)/bodyweight, normalised to a 7-day span.
    // null when fewer than 2 data points exist.
    let rateOfLossPct7d: number | null = null;
    {
      const sevenDaysAgo = (() => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - 7);
        return d.toISOString().slice(0, 10);
      })();
      const logs = await ctx.db
        .query("weight_logs")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).gte("date", sevenDaysAgo),
        )
        .collect();
      // by_user_date is ascending by date → first is earliest, last is latest.
      if (logs.length >= 2) {
        const earliest = logs[0];
        const latest = logs[logs.length - 1];
        const spanDays =
          (Date.parse(`${latest.date}T00:00:00Z`) -
            Date.parse(`${earliest.date}T00:00:00Z`)) /
          86_400_000;
        if (
          spanDays > 0 &&
          earliest.weightKg > 0 &&
          latest.weightKg > 0
        ) {
          const lossKg = earliest.weightKg - latest.weightKg;
          const lossPct = (lossKg / earliest.weightKg) * 100;
          // Scale the observed span up/down to a weekly rate.
          rateOfLossPct7d = parseFloat(
            ((lossPct / spanDays) * 7).toFixed(2),
          );
        }
      }
    }

    // ── Latest feel-check tier (active camp only) ──────────────────────────
    // protocol_feel_checks are per-camp; without an active camp there is no
    // relevant feel-check. Pick the most recent by `checkedAt`; a tier may be
    // absent on a row (e.g. a plain tick with no measurement) → skip those.
    let feelCheckTier: "green" | "amber" | "red" | null = null;
    if (activeCamp) {
      const checks = await ctx.db
        .query("protocol_feel_checks")
        .withIndex("by_user_camp", (q) =>
          q.eq("userId", userId).eq("campId", activeCamp._id),
        )
        .collect();
      const latestWithTier = checks
        .filter((c) => c.tier !== undefined && c.tier !== null)
        .sort((a, b) => b.checkedAt - a.checkedAt)[0];
      feelCheckTier = latestWithTier?.tier ?? null;
    }

    // ── Latest HRV / RHR values from the daily roll-up ─────────────────────
    // Scan recent summaries newest-first and take the first non-null per
    // metric (a day may carry HRV but not RHR, or vice-versa).
    let hrv: number | null = null;
    let rhr: number | null = null;
    {
      const summaries = await ctx.db
        .query("daily_health_summary")
        .withIndex("by_user_date", (q) => q.eq("userId", userId))
        .order("desc")
        .take(30);
      for (const s of summaries) {
        if (hrv === null && s.hrvAvgMs !== undefined && s.hrvAvgMs !== null) {
          hrv = s.hrvAvgMs;
        }
        if (
          rhr === null &&
          s.restingHrBpm !== undefined &&
          s.restingHrBpm !== null
        ) {
          rhr = s.restingHrBpm;
        }
        if (hrv !== null && rhr !== null) break;
      }
    }

    // ── HRV / RHR baselines (14d rolling means) ────────────────────────────
    const hrvBaselineRow = await ctx.db
      .query("health_baselines")
      .withIndex("by_user_metric", (q) =>
        q.eq("userId", userId).eq("metric", HEALTH_METRIC.hrv),
      )
      .unique();
    const rhrBaselineRow = await ctx.db
      .query("health_baselines")
      .withIndex("by_user_metric", (q) =>
        q.eq("userId", userId).eq("metric", HEALTH_METRIC.restingHr),
      )
      .unique();
    const hrvBaseline = hrvBaselineRow?.rolling14dMean ?? null;
    const rhrBaseline = rhrBaselineRow?.rolling14dMean ?? null;

    // ── Fight-week risk level ──────────────────────────────────────────────
    // Derived from the deterministic fight-week math (same engine the cut
    // plan uses): feed current weight, the camp's target weigh-in weight and
    // days remaining, then map green/orange/red → low/moderate/high.
    //
    // Requires an active camp, a current weight (latest weight log) and a
    // target weigh-in weight (camp.endWeightKg). Missing any input → null.
    let fightWeekRiskLevel: "low" | "moderate" | "high" | null = null;
    if (
      activeCamp &&
      daysToWeighIn !== null &&
      daysToWeighIn >= 0 &&
      activeCamp.endWeightKg !== undefined &&
      activeCamp.endWeightKg !== null
    ) {
      const latestWeight = await ctx.db
        .query("weight_logs")
        .withIndex("by_user_date", (q) => q.eq("userId", userId))
        .order("desc")
        .first();
      const currentWeight =
        latestWeight?.weightKg ?? activeCamp.startingWeightKg ?? null;
      if (currentWeight !== null && currentWeight > 0) {
        const projection = computeFightWeekProjection({
          currentWeight,
          targetWeighIn: activeCamp.endWeightKg,
          daysUntilWeighIn: Math.max(1, daysToWeighIn),
        });
        fightWeekRiskLevel = mapRisk(projection.riskLevel);
      }
    }

    return {
      rateOfLossPct7d,
      feelCheckTier,
      hrv,
      hrvBaseline,
      rhr,
      rhrBaseline,
      daysToWeighIn,
      fightWeekRiskLevel,
    };
  },
});
