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

/**
 * The context-aware action the speech bubble surfaces as its primary CTA. The
 * intent is decided here (where we already know WHY each message fires), so the
 * bubble never has to parse the text to pick a button/route.
 */
export type CoachActionKind =
  | "weighIn"
  | "nutrition"
  | "training"
  | "hydration"
  | "recovery";

export interface CoachAction {
  kind: CoachActionKind;
  label: string;
  route: string;
}

const ACTIONS: Record<CoachActionKind, CoachAction> = {
  weighIn: { kind: "weighIn", label: "Log weigh-in", route: "/weight" },
  nutrition: { kind: "nutrition", label: "Log a meal", route: "/nutrition" },
  training: {
    kind: "training",
    label: "Log session",
    route: "/training-calendar?openLogSession=true",
  },
  hydration: { kind: "hydration", label: "Open protocol", route: "/weight-protocol" },
  recovery: { kind: "recovery", label: "Check in", route: "/recovery/check-in" },
};

export interface CoachBriefing {
  greeting: string | null; // short, like the cockpit greeting (or null)
  phase: "build" | "peak" | "fightWeek" | null;
  daysToWeighIn: number | null;
  deltaKg: number | null; // current - target (positive = over)
  onTrack: boolean | null;
  priorityAction: string | null; // the ONE thing to do today (≤80 chars)
  redFlag: string | null; // a safety/urgency warning if any (≤100 chars), else null
  // The action for the winning message (redFlag → priorityAction priority).
  // null when only a greeting is available (bubble falls back to "Chat").
  action: CoachAction | null;
}

const EMPTY_BRIEFING: CoachBriefing = {
  greeting: null,
  phase: null,
  daysToWeighIn: null,
  deltaKg: null,
  onTrack: null,
  priorityAction: null,
  redFlag: null,
  action: null,
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
          ? `${round1(delta)}kg to go, a bit behind, let's tighten it`
          : `${round1(delta)}kg to go, on plan`,
      );
    }
  } else if (onTrack === true) {
    bits.push("on plan");
  }
  return bits.length > 0 ? `${lead}. ${bits.join(", ")}` : lead;
}

/**
 * A gentle CHECK-IN for today (≤80 chars), derived deterministically from the
 * read. This is a soft status read plus a nudge to LOG something, never a
 * prescription (no calorie targets, no "eat less / train harder"). Priority:
 *   1. Fight week → the day's protocol step framed as a calm check-in.
 *   2. Stale logs → a soft weigh-in nudge (we can't coach blind).
 *   3. On track → always a POSITIVE check-in, never a cut suggestion.
 *   4. Over plan AND off the trajectory → a gentle awareness check-in that
 *      nudges logging meals, never a kcal prescription.
 */
function derivePriorityAction(opts: {
  phase: CoachBriefing["phase"];
  days: number | null;
  delta: number | null;
  onTrack: boolean | null;
  hasRecentWeightLog: boolean;
}): { text: string; action: CoachAction } | null {
  const { phase, days, delta, onTrack, hasRecentWeightLog } = opts;

  // 1. Fight week — the day's protocol step, framed as a calm check-in.
  if (phase === "fightWeek") {
    if (days != null) {
      if (days <= 0)
        return { text: "Weigh-in day. One last check when you're ready, then rehydrate", action: ACTIONS.weighIn };
      if (days === 1)
        return { text: "Last sweat-out tonight if needed. Sip only, keep meals light", action: ACTIONS.hydration };
      if (days === 2)
        return { text: "Water-load day. Maybe start with 1L now, then keep it steady", action: ACTIONS.hydration };
      if (days === 3)
        return { text: "Good day to ease into water-loading. ~6-8L, lighter on salt", action: ACTIONS.hydration };
    }
    return { text: "Want to log your weight? Then water-loading can begin", action: ACTIONS.weighIn };
  }

  // 2. Coaching blind — a soft weigh-in nudge first.
  if (!hasRecentWeightLog)
    return { text: "A quick weigh-in helps me keep you on plan, whenever suits", action: ACTIONS.weighIn };

  // 3. On track / at target — always a positive check-in, never a cut nudge.
  if (onTrack === true || (delta != null && delta <= 0.2)) {
    return { text: "Looking on plan. A quick weigh-in keeps it locked in", action: ACTIONS.weighIn };
  }

  // 4. Over plan AND behind the trajectory — a gentle awareness check-in.
  if (delta != null && delta > 0.2 && onTrack === false) {
    return {
      text: `${round1(delta)}kg over with ${days ?? "a few"} days. Log today's meals to keep it tight?`,
      action: ACTIONS.nutrition,
    };
  }

  return { text: "A quick weigh-in helps me keep you on plan, whenever suits", action: ACTIONS.weighIn };
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
}): { text: string; action: CoachAction } | null {
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
          return {
            text: `Heads up: ~${pct}%/wk is past the safe pace. Worth easing off and rehydrating`,
            action: ACTIONS.hydration,
          };
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
      return {
        text: `It's been ${sinceDays} days since a weigh-in. A quick log keeps your plan honest`,
        action: ACTIONS.weighIn,
      };
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
        .filter((c) => !c.isCompleted && c.fightDate >= today)
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

    // The bubble shows redFlag → priorityAction → greeting; its CTA follows the
    // same priority. A greeting carries no action (falls back to "Chat").
    const action = redFlag?.action ?? priorityAction?.action ?? null;

    return {
      greeting,
      phase,
      daysToWeighIn: derived.daysOut,
      deltaKg: derived.deltaKg,
      onTrack: derived.onTrack,
      priorityAction: priorityAction ? priorityAction.text.slice(0, 80) : null,
      redFlag: redFlag ? redFlag.text.slice(0, 100) : null,
      action,
    };
  },
});
