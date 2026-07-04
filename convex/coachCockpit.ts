/**
 * Coach cockpit header query (Phase 2).
 *
 * Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md
 *       §5 Phase 2 ("Pinned cockpit header") and §3.2 (frontend).
 *
 * A lightweight, authed, READ-ONLY query that powers the proactive cockpit
 * header inside the floating coach sheet WITHOUT sending a chat message. It
 * returns just enough to render the greeting, weigh-in countdown, phase pill
 * and weight-target callout the moment the sheet opens.
 *
 * Determinism note: every number here is computed server-side from the same
 * data + math the Phase-1 chat action uses, so the header and the chat cards
 * never disagree:
 *   - weight target / delta / on-track  → reuse `computeDeterministicBundle`
 *     from `_shared/coachBlocks.ts` (the exact Phase-1 logic).
 *   - phase (build/peak/fightWeek)       → reuse `resolvePhase` + the live
 *     scoring config (same source as `fightFormScore`).
 *
 * NO Pro gate: this is read-only header data and degrades gracefully (all
 * fields null) when unauthenticated or when there is no profile. The Pro gate
 * stays on the chat action (`fightCampCoach.run`).
 */
import { query } from "./_generated/server";
import { optionalUserId } from "./lib/auth";
import {
  computeDeterministicBundle,
  type CoachFightWeekData,
} from "./_shared/coachBlocks";
import { resolvePhase } from "../src/scoring/phaseWeights";
import { CURRENT_CONFIG } from "../src/scoring/config";
import { resolveWeighInIso } from "./_shared/weighInTiming";

// ── Public return shape (client imports this with `import type`) ──────────

export interface CoachCockpitData {
  phase: "build" | "peak" | "fightWeek" | null;
  daysToWeighIn: number | null;
  weighInDateISO: string | null; // ISO date of weigh-in / fight
  currentKg: number | null; // latest known weight
  targetKg: number | null; // weigh-in/fight-week target
  deltaKg: number | null; // currentKg - targetKg (positive = over target)
  onTrack: boolean | null;
  fightName: string | null;
  athleteName: string | null; // first name if available
}

const EMPTY_COCKPIT: CoachCockpitData = {
  phase: null,
  daysToWeighIn: null,
  weighInDateISO: null,
  currentKg: null,
  targetKg: null,
  deltaKg: null,
  onTrack: null,
  fightName: null,
  athleteName: null,
};

// ── Small pure helpers ───────────────────────────────────────────────────

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** First name from a display name ("Pratik Rai" → "Pratik"), or null. */
function firstName(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const first = displayName.trim().split(/\s+/)[0];
  return first.length > 0 ? first : null;
}

// ── Query ────────────────────────────────────────────────────────────────

/**
 * `api.coachCockpit.getCockpit` — the proactive header read.
 *
 * Mirrors the data access of `actions_internal.fetchFightWeekData` but stays
 * a query (db reads only, no fetch/node), and only loads the slices the
 * header needs (profile + upcoming camp + recent weight/fight-week logs).
 */
export const getCockpit = query({
  args: {},
  handler: async (ctx): Promise<CoachCockpitData> => {
    const userId = await optionalUserId(ctx);
    if (!userId) return EMPTY_COCKPIT;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return EMPTY_COCKPIT;

    const today = todayIso();
    const fourteenDaysAgo = isoDaysAgo(14);
    const sevenDaysAgo = isoDaysAgo(7);

    // Next upcoming (or today's) camp — same selection rule as
    // fetchFightWeekData: fight date >= today, earliest first.
    const allCamps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const upcomingCamp =
      allCamps
        .filter((c) => !c.isCompleted && c.fightDate >= today)
        .sort((a, b) => a.fightDate.localeCompare(b.fightDate))[0] ?? null;

    // Recent fight-week logs (live cut weight wins in latestWeight()).
    const fightWeekLogsRaw = await ctx.db
      .query("fight_week_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("logDate", fourteenDaysAgo),
      )
      .order("desc")
      .take(20);

    // 14-day weight series (desc) — drives current weight + chart-less math.
    const weight14dRaw = await ctx.db
      .query("weight_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", fourteenDaysAgo),
      )
      .order("desc")
      .take(30);

    const hydration7dRaw = await ctx.db
      .query("hydration_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", sevenDaysAgo),
      )
      .take(30);

    // Assemble the exact shape coachBlocks expects so we reuse the Phase-1
    // weight-target / on-track math verbatim (header matches the chat cards).
    const data: CoachFightWeekData = {
      profile: {
        current_weight_kg: profile.currentWeightKg,
        goal_weight_kg: profile.goalWeightKg,
        fight_week_target_kg: profile.fightWeekTargetKg ?? null,
        sex: profile.sex,
        age: profile.age,
        height_cm: profile.heightCm,
        athlete_type: profile.athleteType ?? null,
        target_date: profile.targetDate ?? null,
        cut_plan_json: profile.cutPlanJson ?? null,
      },
      upcomingCamp: upcomingCamp
        ? {
            id: upcomingCamp._id,
            name: upcomingCamp.name,
            fight_date: upcomingCamp.fightDate,
            starting_weight_kg: upcomingCamp.startingWeightKg ?? null,
            weigh_in_timing: upcomingCamp.weighInTiming ?? null,
          }
        : null,
      fightWeekLogs: fightWeekLogsRaw.map((l) => ({
        log_date: l.logDate,
        weight_kg: l.weightKg ?? null,
        fluid_intake_ml: l.fluidIntakeMl ?? null,
        carbs_g: l.carbsG ?? null,
        sweat_session_min: l.sweatSessionMin ?? null,
        notes: l.notes ?? null,
      })),
      weight14d: weight14dRaw.map((w) => ({
        date: w.date,
        weight_kg: w.weightKg,
      })),
      hydration7d: hydration7dRaw.map((h) => ({
        date: h.date,
        amount_ml: h.amountMl,
        sodium_mg: h.sodiumMg ?? null,
      })),
    };

    // Reuse the Phase-1 deterministic weight math (currentKg / targetKg /
    // deltaKg / onTrack / daysOut). Numbers here MUST match the chat cards.
    const { derived } = computeDeterministicBundle(data);

    // Phase: derive from days-to-fight via the same scoring config the
    // Fight Form Score uses, so the pill matches the dashboard ring.
    let phase: CoachCockpitData["phase"] = null;
    if (upcomingCamp) {
      phase = resolvePhase(today, upcomingCamp.fightDate, CURRENT_CONFIG);
    }

    return {
      phase,
      daysToWeighIn: derived.daysOut,
      weighInDateISO: upcomingCamp
        ? resolveWeighInIso(upcomingCamp.fightDate, upcomingCamp.weighInTiming)
        : null,
      currentKg: derived.currentKg,
      targetKg: derived.targetKg,
      deltaKg: derived.deltaKg,
      onTrack: derived.onTrack,
      fightName: upcomingCamp ? upcomingCamp.name : null,
      athleteName: firstName(profile.displayName),
    };
  },
});
