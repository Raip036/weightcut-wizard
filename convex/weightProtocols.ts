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

    // 2. Both protocol kinds + feel checks + supporting data in parallel.
    //    The profile + latest weight log are used to derive raw values
    //    (cut depth, weigh-in gap) so the "Tuned to you" stat grid + the
    //    header cut-depth pill render even before the AI plan is generated.
    const [
      fightPlan,
      rehydration,
      feelChecks,
      fightWeekPlans,
      profile,
      latestWeightLog,
    ] = await Promise.all([
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
        // Profile + latest weight log — used for raw stat fallback when
        // the AI plan hasn't been generated yet.
        ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .unique(),
        ctx.db
          .query("weight_logs")
          .withIndex("by_user_date", (q) => q.eq("userId", userId))
          .order("desc")
          .first(),
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

    // 5. Derived raw values — let the page render the "Tuned to you"
    //    stat grid + header cut-depth pill BEFORE the AI plan exists.
    //    Mirrors the resolution order in
    //    `weight_protocols_internal.gatherInputs → computeDerived`.
    const currentWeightKg =
      latestWeightLog?.weightKg ?? profile?.currentWeightKg ?? null;
    const targetWeightKg =
      matchedPlan?.targetWeightKg ?? profile?.goalWeightKg ?? null;
    const cutDepthKg =
      currentWeightKg != null && targetWeightKg != null
        ? Math.max(0, currentWeightKg - targetWeightKg)
        : null;
    const cutDepthPct =
      currentWeightKg != null && cutDepthKg != null && currentWeightKg > 0
        ? (cutDepthKg / currentWeightKg) * 100
        : null;
    // Weigh-in clock defaults to 11:00 local (the standard pro weigh-in
    // window) when the camp doesn't carry an explicit time.
    const weighInToFightGapHours =
      Number.isFinite(weighInDateMs) && Number.isFinite(fightDateMs)
        ? Math.max(
            0,
            Math.round((fightDateMs - weighInDateMs) / HOUR_MS),
          )
        : null;

    // Weigh-in timing — read from the profile (set during onboarding),
    // falling back to the camp's free-form `weighInTiming` strategy string.
    // Canonical "day_before" means weigh-in is the day before the fight;
    // ANY other value (including "same_day" / "morning_of") means weigh-in
    // is the SAME DAY as the fight. Legacy rows with neither field default
    // to day-before. Mirrors the derivation in
    // `actions/generateFightPlan.ts → runCore`.
    const weighInTimingRaw =
      profile?.weighInTiming ?? activeCamp.weighInTiming ?? "day_before";
    const weighInSameDay = weighInTimingRaw !== "day_before";

    return {
      campId: activeCamp._id,
      phase,
      today,
      daysToFight,
      daysToWeighIn,
      // True when weigh-in is the same day as the fight (no carb cut path).
      weighInSameDay,
      // Raw derived values — present whether or not the AI plan exists.
      currentWeightKg,
      targetWeightKg,
      cutDepthKg,
      cutDepthPct,
      weighInToFightGapHours,
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
        tier: c.tier,
        aiFeedback: c.aiFeedback,
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
/**
 * Deterministic tier computation from a raw value. Pure helper — keeps the
 * AI feedback action lean and gives the UI an immediate green/amber/red
 * indicator while the AI feedback is still in flight.
 */
function computeTier(
  metric: "urine_colour" | "weigh_back_kg" | "energy_1to10" | "headache" | "no_cramps",
  value: string,
): "green" | "amber" | "red" {
  switch (metric) {
    case "urine_colour": {
      const n = parseInt(value, 10);
      if (Number.isNaN(n)) return "amber";
      if (n <= 3) return "green";
      if (n <= 5) return "amber";
      return "red";
    }
    case "energy_1to10": {
      const n = parseInt(value, 10);
      if (Number.isNaN(n)) return "amber";
      if (n >= 7) return "green";
      if (n >= 5) return "amber";
      return "red";
    }
    case "headache":
      return value === "no" ? "green" : value === "mild" ? "amber" : "red";
    case "no_cramps":
      return value === "none" ? "green" : "amber";
    case "weigh_back_kg":
      // Without knowing the target, default amber; UI can layer tier
      // based on comparison to cut depth.
      return "amber";
    default:
      return "amber";
  }
}

export const recordFeelCheck = mutation({
  args: {
    campId: v.id("fight_camps"),
    metric: feelCheckMetric,
    value: v.optional(v.string()),
  },
  handler: async (ctx, { campId, metric, value }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("NOT_AUTHENTICATED");

    const tier = value ? computeTier(metric, value) : undefined;

    const existing = await ctx.db
      .query("protocol_feel_checks")
      .withIndex("by_user_camp_metric", (q) =>
        q.eq("userId", userId).eq("campId", campId).eq("metric", metric),
      )
      .unique();

    if (existing) {
      // Clear stale AI feedback on value change — the new value invalidates
      // the prior advice.
      await ctx.db.patch(existing._id, {
        checkedAt: Date.now(),
        value,
        tier,
        aiFeedback: undefined,
      });
      return existing._id;
    }
    return await ctx.db.insert("protocol_feel_checks", {
      userId,
      campId,
      metric,
      checkedAt: Date.now(),
      value,
      tier,
    });
  },
});

/**
 * Internal mutation used by the AI feedback action to write the
 * generated 1-line response back to the row.
 */
export const setFeelCheckFeedback = mutation({
  args: {
    campId: v.id("fight_camps"),
    metric: feelCheckMetric,
    aiFeedback: v.string(),
  },
  handler: async (ctx, { campId, metric, aiFeedback }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;
    const existing = await ctx.db
      .query("protocol_feel_checks")
      .withIndex("by_user_camp_metric", (q) =>
        q.eq("userId", userId).eq("campId", campId).eq("metric", metric),
      )
      .unique();
    if (existing) await ctx.db.patch(existing._id, { aiFeedback });
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

// ───────────────────────────────────────────────────────────────────────
// Mutation — reset the whole protocol back to Chapter 1
// ───────────────────────────────────────────────────────────────────────

/**
 * Clear the current Weight Protocol for the authenticated user's active
 * (non-completed) fight camp so the page falls back to Chapter 1 and the
 * user can generate again from scratch.
 *
 * Deletes, for the active camp:
 *   • the `fight_plan` `weight_protocols` row
 *   • the `rehydration` `weight_protocols` row
 *   • every `protocol_feel_checks` row for (userId, campId)
 *
 * After this runs, `getCurrentForUser` returns `fightPlan: null` +
 * `rehydration: null` (and an empty `feelChecks[]`), which is the exact
 * signal the page uses to render the Chapter 1 / generate state.
 *
 * Active-camp resolution mirrors `getCurrentForUser` above (same `by_user`
 * index + `isCompleted != true` filter + `.first()`), so this clears the
 * SAME camp the page is reading.
 *
 * Idempotent: a no-op when there's no active camp or nothing to clear
 * (returns a small summary of what was removed so the client can decide
 * whether to toast). Deletion convention matches the rest of this file
 * (`.unique()` / `.collect()` then `ctx.db.delete(_id)`).
 *
 * Auth: throws `NOT_AUTHENTICATED` (mirrors `recordFeelCheck`) so the
 * client can surface an error rather than silently appearing to succeed.
 * Rehydration generation is manual (sweat-loss entry) — clearing the row
 * here simply lets the user regenerate it; it does not re-trigger anything.
 */
export const clearProtocol = mutation({
  args: {},
  returns: v.object({
    cleared: v.boolean(),
    deletedFightPlan: v.boolean(),
    deletedRehydration: v.boolean(),
    deletedFeelChecks: v.number(),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("NOT_AUTHENTICATED");

    // Resolve the active camp the page is bound to (same shape as
    // getCurrentForUser). No active camp → nothing to clear.
    const activeCamp = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.neq(q.field("isCompleted"), true))
      .first();
    if (!activeCamp) {
      return {
        cleared: false,
        deletedFightPlan: false,
        deletedRehydration: false,
        deletedFeelChecks: 0,
      };
    }

    // Both protocol rows + the feel-check ledger, fetched in parallel.
    const [fightPlan, rehydration, feelChecks] = await Promise.all([
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
    ]);

    if (fightPlan) await ctx.db.delete(fightPlan._id);
    if (rehydration) await ctx.db.delete(rehydration._id);
    for (const fc of feelChecks) await ctx.db.delete(fc._id);

    return {
      cleared:
        fightPlan != null || rehydration != null || feelChecks.length > 0,
      deletedFightPlan: fightPlan != null,
      deletedRehydration: rehydration != null,
      deletedFeelChecks: feelChecks.length,
    };
  },
});
