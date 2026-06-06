/**
 * Proactive coach briefing query (Phase 3, item 3).
 *
 * Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md
 *       §5 Phase 3 ("Proactive briefing card") and §3.2 (frontend).
 *
 * A lightweight, authed, READ-ONLY query that powers the PROACTIVE BRIEFING
 * CARD surfaced on Dashboard/Camp WITHOUT opening the chat. Most fighters
 * won't open a conversation, so the value has to be pushed into a card: the
 * current read (phase, weight-to-go, on-track), the ONE thing to do today,
 * and any safety red flag.
 *
 * Determinism note: every number here is computed server-side from the same
 * data + math the cockpit/chat use, so the card and the chat never disagree:
 *   - phase / daysToWeighIn / deltaKg / onTrack / greeting facts → reuse the
 *     exact Phase-1 logic via `computeDeterministicBundle` + `resolvePhase`
 *     (mirrors `coachCockpit.getCockpit`'s data loading).
 *   - priorityAction → derived deterministically from the read (see below).
 *   - redFlag → a small, self-contained safety check on the last 7 days of
 *     weight logs (rate-of-loss) plus a stale-weigh-in check near the fight.
 *     Kept independent of other Phase-3 files on purpose.
 *
 * NO Pro gate: read-only card data, degrades gracefully (all fields null)
 * when unauthenticated or when there is no profile/camp. The Pro gate stays
 * on the chat action (`fightCampCoach.run`).
 */
import { query } from "./_generated/server";
import { optionalUserId } from "./lib/auth";
import {
  computeDeterministicBundle,
  type CoachFightWeekData,
} from "./_shared/coachBlocks";
import { resolvePhase } from "../src/scoring/phaseWeights";
import { CURRENT_CONFIG } from "../src/scoring/config";

// ── Public return shape (the card imports this with `import type`) ─────────

export interface CoachBriefing {
  greeting: string | null; // short, like the cockpit greeting (or null)
  phase: "build" | "peak" | "fightWeek" | null;
  daysToWeighIn: number | null;
  deltaKg: number | null; // current - target (positive = over)
  onTrack: boolean | null;
  priorityAction: string | null; // the ONE thing to do today (≤80 chars)
  redFlag: string | null; // a safety/urgency warning if any (≤100 chars), else null
}

const EMPTY_BRIEFING: CoachBriefing = {
  greeting: null,
  phase: null,
  daysToWeighIn: null,
  deltaKg: null,
  onTrack: null,
  priorityAction: null,
  redFlag: null,
};

// ── Small pure helpers ────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const todayIso = (): string => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * MS_PER_DAY).toISOString().slice(0, 10);
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** First name from a display name ("Pratik Rai" → "Pratik"), or null. */
function firstName(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const first = displayName.trim().split(/\s+/)[0];
  return first.length > 0 ? first : null;
}

/** "Morning"/"Afternoon"/"Evening" from the local hour. */
function timeOfDay(): "Morning" | "Afternoon" | "Evening" {
  const h = new Date().getHours();
  if (h < 12) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
}

/**
 * Short cockpit-style greeting from the current read, e.g.
 *   "Morning Pratik — 3 days out, 0.4kg ahead of plan"
 * Falls back gracefully when name / numbers are missing.
 */
function buildGreeting(
  name: string | null,
  days: number | null,
  delta: number | null,
  onTrack: boolean | null,
): string {
  const lead = name ? `${timeOfDay()} ${name}` : timeOfDay();
  const bits: string[] = [];
  if (days != null && days >= 0) {
    bits.push(days === 0 ? "weigh-in day" : `${days} day${days === 1 ? "" : "s"} out`);
  }
  if (delta != null) {
    if (delta <= 0.2) {
      bits.push(onTrack === false ? "near target" : "at target");
    } else {
      bits.push(
        onTrack === false
          ? `${round1(delta)}kg over, behind plan`
          : `${round1(delta)}kg to go, on plan`,
      );
    }
  } else if (onTrack === true) {
    bits.push("on plan");
  }
  return bits.length > 0 ? `${lead}. ${bits.join(", ")}` : lead;
}

/**
 * The ONE thing to do today (≤80 chars), derived deterministically from the
 * read. Priority order:
 *   1. Fight week → the day's key cut step (water-load / cut / rehydrate by
 *      day-out), or a generic "log your weight + start water load".
 *   2. Stale logs → "Log today's weight" (we can't coach blind).
 *   3. Over plan → "Cut ~X kcal" when modestly over, else "You're Xkg over —
 *      tighten the plan".
 *   4. On track → a positive nudge.
 */
function derivePriorityAction(opts: {
  phase: CoachBriefing["phase"];
  days: number | null;
  delta: number | null;
  onTrack: boolean | null;
  hasRecentWeightLog: boolean;
}): string | null {
  const { phase, days, delta, onTrack, hasRecentWeightLog } = opts;

  // 1. Fight week — the day's key step keyed off days-to-weigh-in.
  if (phase === "fightWeek") {
    if (days != null) {
      if (days <= 0) return "Weigh-in today. One last check, then it's rehydrate time";
      if (days === 1) return "Last sweat-out tonight if needed. Sip only, go easy on meals";
      if (days === 2) return "Water-load day. Could start with 1L now, then keep it steady";
      if (days === 3) return "Good day to start water-loading. ~6-8L, ease off the salt";
    }
    return "Want to log your weight? Then water-loading can begin";
  }

  // 2. Coaching blind — get a weight in first.
  if (!hasRecentWeightLog) return "A quick weigh-in helps me keep you on plan, whenever suits";

  // 3. Over plan.
  if (delta != null && delta > 0.2) {
    // ~7700 kcal per kg; a 1-day nudge ≈ a fraction of the gap. Keep the
    // ask small and actionable when only modestly over.
    if (delta <= 2) {
      const kcal = Math.max(100, Math.round((delta * 200) / 50) * 50);
      return `Trimming ~${kcal} kcal today would keep you on the glide path`;
    }
    return `${round1(delta)}kg over. Worth tightening the plan a bit, your call`;
  }

  // 4. On track / positive nudge.
  if (onTrack === true || (delta != null && delta <= 0.2)) {
    return "Right on plan. Hold the line, a weight + meals log keeps it tight";
  }
  return "A quick weigh-in helps me keep you on plan, whenever suits";
}

/**
 * Self-contained safety red flag (≤100 chars), or null. Two independent,
 * cheap checks (NO dependency on other Phase-3 files):
 *   a) Rate-of-loss over the last ~7 days of weight logs > ~1.5%/week
 *      (the established unsafe sustained-loss ceiling) → "cutting too fast".
 *   b) Near the fight (≤7 days) with no weight log in 2+ days → stale weigh-in.
 * (a) wins when both fire — an unsafe pace is the louder warning.
 */
function deriveRedFlag(opts: {
  weightSeriesDesc: Array<{ date: string; weight_kg: number }>;
  days: number | null;
}): string | null {
  const { weightSeriesDesc, days } = opts;

  // (a) Rate-of-loss check — chronological window of the last 7 days.
  const series = [...weightSeriesDesc]
    .filter((w) => Number.isFinite(w.weight_kg))
    .sort((a, b) => a.date.localeCompare(b.date)); // oldest → newest
  if (series.length >= 2) {
    const newest = series[series.length - 1];
    const cutoffMs = Date.parse(newest.date) - 7 * MS_PER_DAY;
    const window = series.filter((w) => Date.parse(w.date) >= cutoffMs);
    if (window.length >= 2) {
      const first = window[0];
      const last = window[window.length - 1];
      const spanDays = Math.max(
        1,
        Math.round((Date.parse(last.date) - Date.parse(first.date)) / MS_PER_DAY),
      );
      const dropKg = first.weight_kg - last.weight_kg;
      const bw = last.weight_kg;
      if (dropKg > 0 && bw > 0) {
        const perWeek = (dropKg / spanDays) * 7;
        if (perWeek > bw * 0.015) {
          const pct = round1((perWeek / bw) * 100);
          return `Heads up: ~${pct}%/wk is past the safe pace. Worth easing off and rehydrating`;
        }
      }
    }
  }

  // (b) Stale weigh-in near the fight.
  if (days != null && days >= 0 && days <= 7 && series.length > 0) {
    const newest = series[series.length - 1];
    const sinceDays = Math.round(
      (Date.parse(todayIso()) - Date.parse(newest.date)) / MS_PER_DAY,
    );
    if (sinceDays >= 2) {
      return `It's been ${sinceDays} days since a weigh-in. A quick log keeps your plan honest`;
    }
  }

  return null;
}

// ── Query ──────────────────────────────────────────────────────────────────

/**
 * `api.coachBriefing.getBriefing` — the proactive briefing card read.
 *
 * Mirrors the data access of `coachCockpit.getCockpit` (profile + upcoming
 * camp + recent weight/fight-week logs) but returns the card-shaped briefing
 * with a derived priorityAction + redFlag. Stays a query (db reads only).
 */
export const getBriefing = query({
  args: {},
  handler: async (ctx): Promise<CoachBriefing> => {
    const userId = await optionalUserId(ctx);
    if (!userId) return EMPTY_BRIEFING;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return EMPTY_BRIEFING;

    const today = todayIso();
    const fourteenDaysAgo = isoDaysAgo(14);
    const sevenDaysAgo = isoDaysAgo(7);

    // Next upcoming (or today's) camp — same rule as getCockpit.
    const allCamps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const upcomingCamp =
      allCamps
        .filter((c) => c.fightDate >= today)
        .sort((a, b) => a.fightDate.localeCompare(b.fightDate))[0] ?? null;

    if (!upcomingCamp) return EMPTY_BRIEFING;

    // Recent fight-week logs (live cut weight wins in latestWeight()).
    const fightWeekLogsRaw = await ctx.db
      .query("fight_week_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("logDate", fourteenDaysAgo),
      )
      .order("desc")
      .take(20);

    // 14-day weight series (desc) — drives current weight + safety math.
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

    // Assemble the exact shape coachBlocks expects so the briefing reuses the
    // Phase-1 weight-target / on-track math verbatim (card matches the chat).
    const data: CoachFightWeekData = {
      profile: {
        current_weight_kg: profile.currentWeightKg,
        goal_weight_kg: profile.goalWeightKg,
        fight_week_target_kg: profile.fightWeekTargetKg ?? null,
        sex: profile.sex,
        age: profile.age,
        height_cm: profile.heightCm,
        athlete_type: profile.athleteType ?? null,
      },
      upcomingCamp: {
        id: upcomingCamp._id,
        name: upcomingCamp.name,
        fight_date: upcomingCamp.fightDate,
        starting_weight_kg: upcomingCamp.startingWeightKg ?? null,
        weigh_in_timing: upcomingCamp.weighInTiming ?? null,
      },
      fightWeekLogs: fightWeekLogsRaw.map((l) => ({
        log_date: l.logDate,
        weight_kg: l.weightKg ?? null,
        fluid_intake_ml: l.fluidIntakeMl ?? null,
        carbs_g: l.carbsG ?? null,
        sweat_session_min: l.sweatSessionMin ?? null,
        notes: l.notes ?? null,
      })),
      weight14d: weight14dRaw.map((w) => ({ date: w.date, weight_kg: w.weightKg })),
      hydration7d: hydration7dRaw.map((h) => ({
        date: h.date,
        amount_ml: h.amountMl,
        sodium_mg: h.sodiumMg ?? null,
      })),
    };

    // Reuse Phase-1 deterministic weight math (matches cockpit + chat cards).
    const { derived } = computeDeterministicBundle(data);

    // Phase via the same scoring config the Fight Form Score uses.
    const phase = resolvePhase(today, upcomingCamp.fightDate, CURRENT_CONFIG);

    // Has a weight log in the last 2 days (from either source)?
    const twoDaysAgo = isoDaysAgo(2);
    const hasRecentWeightLog =
      weight14dRaw.some((w) => w.date >= twoDaysAgo) ||
      fightWeekLogsRaw.some(
        (l) => l.logDate >= twoDaysAgo && typeof l.weightKg === "number",
      );

    const greeting = buildGreeting(
      firstName(profile.displayName),
      derived.daysOut,
      derived.deltaKg,
      derived.onTrack,
    );

    const priorityAction = derivePriorityAction({
      phase,
      days: derived.daysOut,
      delta: derived.deltaKg,
      onTrack: derived.onTrack,
      hasRecentWeightLog,
    });

    const redFlag = deriveRedFlag({
      weightSeriesDesc: data.weight14d,
      days: derived.daysOut,
    });

    return {
      greeting,
      phase,
      daysToWeighIn: derived.daysOut,
      deltaKg: derived.deltaKg,
      onTrack: derived.onTrack,
      priorityAction: priorityAction ? priorityAction.slice(0, 80) : null,
      redFlag: redFlag ? redFlag.slice(0, 100) : null,
    };
  },
});
