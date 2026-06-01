/**
 * Weight protocol — public reactive query surface (WP-T9).
 *
 * The Weight Protocol page is the single user-facing surface that subsumes
 * the old "Fight Week" + "Hydration" pages. This module exposes the auth-
 * scoped reactive reads + tick-mutation surface the page binds to:
 *
 *   • `getCurrentForUser`  – one-shot page-load query. Returns the active
 *                            fight camp, both protocol rows (fight_plan +
 *                            rehydration), the per-(user, camp) feel-check
 *                            ledger, and pre-computed phase/countdown
 *                            context so the page can render without
 *                            additional round-trips.
 *
 *   • `recordFeelCheck`    – idempotent (userId, campId, metric) upsert
 *                            used by `FeelChecksList` when a user ticks a
 *                            checklist item. Optimistic on the client.
 *
 *   • `clearFeelCheck`     – delete-by-(userId, campId, metric); safe to
 *                            call when no row exists (used when the user
 *                            unticks a feel check).
 *
 * Auth pattern: mirrors `convex/recoveryReports.ts → getCurrentForUser`
 * (the T13 reference from the recovery redesign) — `getAuthUserId(ctx)`
 * with a graceful `null` return when no identity is present.
 *
 * Schema notes:
 *   - `fight_camps` does NOT carry an explicit `weighInDate` column; the
 *     authoritative weigh-in date lives on the matching `fight_week_plans`
 *     row (joined by `fightCampId`). When no plan row exists yet we fall
 *     back to `fightDate − 24h` (the standard day-before-fight weigh-in).
 *   - `fight_camps.weighInTiming` is a free-form strategy string
 *     (e.g. "morning_of" / "day_before") — NOT a date — so it is NOT used
 *     as a `weighInDate` source.
 *
 * Spec: docs/superpowers/specs/2026-06-01-weight-protocol-redesign-design.md
 *       §7.5 (page-render context shape).
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ───────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// Reused by both `recordFeelCheck` and `clearFeelCheck` — keeping the
// union in one place ensures the two mutations stay in lock-step with
// the schema enum.
const feelCheckMetric = v.union(
  v.literal("urine_colour"),
  v.literal("weigh_back_kg"),
  v.literal("energy_1to10"),
  v.literal("headache"),
  v.literal("no_cramps"),
);

// ───────────────────────────────────────────────────────────────────────
// Reads
// ───────────────────────────────────────────────────────────────────────

/**
 * Page-load query for the Weight Protocol page. Returns `null` when the
 * user has no identity or no active (non-completed) fight camp — the page
 * uses that signal to render `NoFightCampEmptyState` (§7.5).
 *
 * Active-camp resolution mirrors the post-write trigger in
 * `convex/weight_logs.ts`: same `by_user` index + `isCompleted != true`
 * filter + `.first()`. If multiple active camps exist (the data model
 * doesn't enforce uniqueness) the same camp is deterministically chosen
 * across both surfaces.
 *
 * Phase determination is a simple time-window heuristic — it's only used
 * for cosmetic page state (header copy, accent colour); the actual
 * day-by-day plan comes from `fightPlan.payload.days[]`.
 */
export const getCurrentForUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // 1. Active fight camp — same shape as the weight_logs trigger.
    const activeCamp = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.neq(q.field("isCompleted"), true))
      .first();
    if (!activeCamp) return null;

    // 2. Both protocol kinds + feel checks in parallel.
    const [fightPlan, rehydration, feelChecks, fightWeekPlans] =
      await Promise.all([
        ctx.db
          .query("weight_protocols")
          .withIndex("by_user_camp_kind", (q) =>
            q
              .eq("userId", userId)
              .eq("campId", activeCamp._id)
              .eq("kind", "fight_plan"),
          )
          .unique(),
        ctx.db
          .query("weight_protocols")
          .withIndex("by_user_camp_kind", (q) =>
            q
              .eq("userId", userId)
              .eq("campId", activeCamp._id)
              .eq("kind", "rehydration"),
          )
          .unique(),
        ctx.db
          .query("protocol_feel_checks")
          .withIndex("by_user_camp", (q) =>
            q.eq("userId", userId).eq("campId", activeCamp._id),
          )
          .collect(),
        // Weigh-in date lives on `fight_week_plans` — pull all for this
        // user (one-row-per-camp is the dominant shape) and match in
        // memory. Mirrors `weight_protocols_internal.gatherInputs`.
        ctx.db
          .query("fight_week_plans")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect(),
      ]);

    // 3. Resolve weigh-in date.
    //    Priority order:
    //      a. matching fight_week_plans row (joined by fightCampId)
    //      b. fight_week_plans row whose `fightDate` matches camp.fightDate
    //         (covers plans created before the camp-linkage existed)
    //      c. `fight_camps.fightDate − 24h` (standard day-before fallback;
    //         worst-case morning-of when the user weighs in the same day,
    //         a tolerable error for cosmetic countdown copy)
    const matchedPlan =
      fightWeekPlans.find((p) => p.fightCampId === activeCamp._id) ??
      fightWeekPlans.find((p) => p.fightDate === activeCamp.fightDate) ??
      null;

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const fightDateMs = Date.parse(activeCamp.fightDate);
    const weighInDateMs = matchedPlan?.fightDate
      ? Date.parse(matchedPlan.fightDate)
      : Number.isFinite(fightDateMs)
        ? fightDateMs - DAY_MS
        : NaN;

    // Countdown numbers — clamped to 0 so the page never shows negatives.
    // `Number.isFinite` guards keep us safe if either date string failed
    // to parse (would otherwise produce `NaN` propagation).
    const daysToFight = Number.isFinite(fightDateMs)
      ? Math.max(0, Math.ceil((fightDateMs - now.getTime()) / DAY_MS))
      : 0;
    const daysToWeighIn = Number.isFinite(weighInDateMs)
      ? Math.max(0, Math.ceil((weighInDateMs - now.getTime()) / DAY_MS))
      : 0;

    // 4. Phase determination — cosmetic only.
    //    > 4d to weigh-in   → "prep"     (still in normal training)
    //    1–4d to weigh-in   → "cut"      (active dehydration window)
    //    weigh-in day, <3h  → "weigh-in" (the day itself, pre-rehydrate)
    //    weigh-in → fight−4h → "refeed"  (rehydrate window)
    //    fight−4h → fight    → "pre-fight"
    let phase: "prep" | "cut" | "weigh-in" | "refeed" | "pre-fight" = "prep";
    if (!Number.isFinite(weighInDateMs) || !Number.isFinite(fightDateMs)) {
      phase = "prep";
    } else if (daysToWeighIn > 4) {
      phase = "prep";
    } else if (daysToWeighIn > 0) {
      phase = "cut";
    } else if (now.getTime() < weighInDateMs + 3 * HOUR_MS) {
      phase = "weigh-in";
    } else if (now.getTime() < fightDateMs - 4 * HOUR_MS) {
      phase = "refeed";
    } else {
      phase = "pre-fight";
    }

    return {
      campId: activeCamp._id,
      phase,
      today,
      daysToFight,
      daysToWeighIn,
      fightPlan: fightPlan
        ? {
            _id: fightPlan._id,
            payload: fightPlan.payload,
            approach: fightPlan.approach,
            createdAt: fightPlan.createdAt,
            model: fightPlan.model,
          }
        : null,
      rehydration: rehydration
        ? {
            _id: rehydration._id,
            payload: rehydration.payload,
            createdAt: rehydration.createdAt,
            model: rehydration.model,
          }
        : null,
      feelChecks: feelChecks.map((c) => ({
        _id: c._id,
        metric: c.metric,
        checkedAt: c.checkedAt,
        value: c.value,
      })),
    };
  },
});

// ───────────────────────────────────────────────────────────────────────
// Mutations — feel-check ledger
// ───────────────────────────────────────────────────────────────────────

/**
 * Idempotent upsert keyed by (userId, campId, metric). Re-ticking the
 * same check refreshes `checkedAt` and overwrites `value` rather than
 * appending a duplicate row — keeps the ledger one-row-per-metric so the
 * `FeelChecksList` UI doesn't have to dedupe.
 *
 * Auth: throws `NOT_AUTHENTICATED` instead of returning `null` because
 * the UI optimistically marks the row as ticked before the mutation
 * resolves; surfacing the error lets the page roll the optimistic state
 * back rather than silently swallow.
 */
export const recordFeelCheck = mutation({
  args: {
    campId: v.id("fight_camps"),
    metric: feelCheckMetric,
    value: v.optional(v.string()),
  },
  handler: async (ctx, { campId, metric, value }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("NOT_AUTHENTICATED");

    const existing = await ctx.db
      .query("protocol_feel_checks")
      .withIndex("by_user_camp_metric", (q) =>
        q.eq("userId", userId).eq("campId", campId).eq("metric", metric),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { checkedAt: Date.now(), value });
      return existing._id;
    }
    return await ctx.db.insert("protocol_feel_checks", {
      userId,
      campId,
      metric,
      checkedAt: Date.now(),
      value,
    });
  },
});

/**
 * Delete the ledger row for (userId, campId, metric). Safe to call when
 * no row exists — the page may fire-and-forget this on every untick
 * without first checking server state.
 *
 * Auth: silent `return` on missing identity (matches the optimistic-UI
 * untick path; the page already updated locally and won't observe an
 * error). If a row exists for a different user we still bail because the
 * by_user_camp_metric index scope is auth-bound.
 */
export const clearFeelCheck = mutation({
  args: {
    campId: v.id("fight_camps"),
    metric: feelCheckMetric,
  },
  handler: async (ctx, { campId, metric }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;

    const existing = await ctx.db
      .query("protocol_feel_checks")
      .withIndex("by_user_camp_metric", (q) =>
        q.eq("userId", userId).eq("campId", campId).eq("metric", metric),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});
