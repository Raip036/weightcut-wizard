/* ------------------------------------------------------------------ */
/* Fight Camp Coach redesign — Phase 3: Fight-week cornerman loader.    */
/* Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md */
/*                                                                     */
/* Reconciles the stored fight-week plan (weight_protocols.payload, a  */
/* FightPlan) against TODAY's actual fight_week_logs and produces a     */
/* FightWeekCornermanData snapshot: which plan day is "today", that     */
/* day's prescribed targets, and how the athlete's logged actuals       */
/* measure up step-by-step.                                             */
/*                                                                     */
/* Query runtime only — pure DB reads, no IO. Defensive throughout:     */
/* missing data degrades to `hasPlan: false` / empty steps, never       */
/* throws. The action layer only renders cornerman cards when           */
/* `hasPlan` is true, so returning false outside fight week (or with    */
/* no plan) is the correct "show nothing" signal — while still          */
/* surfacing `daysToWeighIn` when we can compute it.                    */
/* ------------------------------------------------------------------ */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { FightWeekCornermanData } from "./_shared/coachDomains/fightWeekCornerman";

/** Only surface cornerman cards inside this window before weigh-in. */
const FIGHT_WEEK_WINDOW_DAYS = 7;

/** Tolerance applied to "met" checks so a near-miss still counts.
 *  Fluid/sodium are noisy self-reports; 5% slack avoids false negatives. */
const MET_TOLERANCE = 0.05;

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Midnight epoch-ms for a YYYY-MM-DD string; NaN if unparseable. */
function isoMidnightMs(iso: string | null | undefined): number {
  if (!iso || iso.length < 10) return NaN;
  const ms = Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : NaN;
}

/** Ceil whole days from `today` to `target` (positive = future). */
function ceilDaysBetween(targetMs: number, todayMs: number): number | null {
  if (!Number.isFinite(targetMs) || !Number.isFinite(todayMs)) return null;
  return Math.ceil((targetMs - todayMs) / 86_400_000);
}

/** Round to a finite number, else 0. */
function num(n: unknown): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

/** Format litres compactly: "6 L" / "5.5 L". */
function fmtLitres(l: number): string {
  const v = Math.round(l * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)} L`;
}

/** Format grams: "120 g". */
function fmtGrams(g: number): string {
  return `${Math.round(g)} g`;
}

/** Format millilitres as litres for readability: "3 L". */
function fmtMlAsLitres(ml: number): string {
  return fmtLitres(ml / 1000);
}

/** Format sodium milligrams: "2,300 mg". */
function fmtSodium(mg: number): string {
  return `${Math.round(mg).toLocaleString("en-US")} mg`;
}

/** Format minutes: "30 min". */
function fmtMinutes(min: number): string {
  return `${Math.round(min)} min`;
}

/** A single day entry inside the stored FightPlan payload. */
interface PlanDay {
  dayIso?: unknown;
  dayLabel?: unknown;
  daysToWeighIn?: unknown;
  carbsGrams?: unknown;
  waterLitres?: unknown;
  sodiumMg?: unknown;
  fibreNote?: unknown;
  fibreCopy?: unknown;
  keyAction?: unknown;
  // Some plan generations carry a per-day sweat / training prescription;
  // read defensively so we surface a sweat step only when present.
  sweatSessionMin?: unknown;
  trainingRecommendation?: unknown;
}

/**
 * Load the fight-week cornerman snapshot for `userId`.
 *
 * Returns `hasPlan: false` (with `daysToWeighIn` when derivable) when:
 *  - there is no upcoming camp,
 *  - there is no stored `fight_plan` protocol for that camp,
 *  - the plan has no day matching today, or
 *  - we are outside the fight-week window.
 * Otherwise returns the matched day's label, days-to-weigh-in, and a
 * reconciled list of steps comparing prescribed targets vs today's logs.
 */
export const getFightWeekCornerman = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<FightWeekCornermanData> => {
    const empty: FightWeekCornermanData = {
      hasPlan: false,
      dayLabel: null,
      daysToWeighIn: null,
      steps: [],
    };

    const today = todayIso();
    const todayMs = isoMidnightMs(today);

    // 1. Active (upcoming, soonest) fight camp for this user.
    const camps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const camp =
      camps
        .filter((c) => typeof c.fightDate === "string" && c.fightDate >= today)
        .sort((a, b) => a.fightDate.localeCompare(b.fightDate))[0] ?? null;

    if (!camp) return empty;

    // Best-effort days-to-weigh-in even when there's no usable plan.
    // No explicit weigh-in date on the camp; weigh-in defaults to the day
    // before the fight (matches weightProtocolMath's fallback).
    const fightIso = (camp.fightDate || "").slice(0, 10);
    const fallbackWeighInMs = (() => {
      const fightMs = isoMidnightMs(fightIso);
      return Number.isFinite(fightMs) ? fightMs - 86_400_000 : NaN;
    })();
    const fallbackDaysToWeighIn = ceilDaysBetween(fallbackWeighInMs, todayMs);

    // 2. Stored fight_plan protocol for (user, camp).
    const protocol = await ctx.db
      .query("weight_protocols")
      .withIndex("by_user_camp_kind", (q) =>
        q.eq("userId", userId).eq("campId", camp._id).eq("kind", "fight_plan"),
      )
      .order("desc")
      .first();

    const payload = protocol?.payload as
      | { days?: unknown }
      | null
      | undefined;
    const planDays: PlanDay[] = Array.isArray(payload?.days)
      ? (payload!.days as PlanDay[])
      : [];

    if (planDays.length === 0) {
      // We know the camp but have no plan to reconcile against.
      return { ...empty, daysToWeighIn: fallbackDaysToWeighIn };
    }

    // 3. Pick today's plan day.
    //    Primary: exact dayIso === today (skeleton stamps a real ISO when
    //    the weigh-in date is known). Fallback: the day whose daysToWeighIn
    //    matches our computed value (handles plans generated with a blank
    //    dayIso, where weighInIso was unset at generation time).
    const byIso = planDays.find(
      (d) => typeof d.dayIso === "string" && (d.dayIso as string).slice(0, 10) === today,
    );
    let dayToWeighInFromIso: number | null = null;
    if (byIso && typeof byIso.daysToWeighIn === "number") {
      dayToWeighInFromIso = byIso.daysToWeighIn;
    }
    const byDtw =
      !byIso && fallbackDaysToWeighIn != null
        ? planDays.find((d) => num(d.daysToWeighIn) === fallbackDaysToWeighIn)
        : undefined;

    const planDay = byIso ?? byDtw ?? null;

    // Authoritative days-to-weigh-in: prefer the matched plan day's own
    // value, else the iso-derived fallback.
    const daysToWeighIn =
      planDay && typeof planDay.daysToWeighIn === "number"
        ? planDay.daysToWeighIn
        : (dayToWeighInFromIso ?? fallbackDaysToWeighIn);

    // 4. Fight-week gating. Only meaningful in the final week. Outside the
    //    window we return hasPlan: false (action hides cards) but keep
    //    daysToWeighIn so the caller can still reason about timing.
    if (
      daysToWeighIn == null ||
      daysToWeighIn < 0 ||
      daysToWeighIn > FIGHT_WEEK_WINDOW_DAYS
    ) {
      return { ...empty, daysToWeighIn };
    }

    if (!planDay) {
      // In-window but no plan day lines up with today.
      return { ...empty, daysToWeighIn };
    }

    const dayLabel =
      typeof planDay.dayLabel === "string" && planDay.dayLabel.length > 0
        ? planDay.dayLabel
        : `T-${daysToWeighIn}`;

    // 5. Today's actuals from fight_week_logs.
    const log = await ctx.db
      .query("fight_week_logs")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).eq("logDate", today),
      )
      .first();

    const steps = buildSteps(planDay, log ?? null);

    const note =
      typeof planDay.keyAction === "string" && planDay.keyAction.length > 0
        ? planDay.keyAction
        : typeof planDay.fibreCopy === "string" && planDay.fibreCopy.length > 0
          ? planDay.fibreCopy
          : undefined;

    return {
      hasPlan: true,
      dayLabel,
      daysToWeighIn,
      steps,
      ...(note ? { note } : {}),
    };
  },
});

/** Today's logged actuals (subset we reconcile against). */
interface DayLog {
  fluidIntakeMl?: number | null;
  carbsG?: number | null;
  sweatSessionMin?: number | null;
  weightKg?: number | null;
}

/**
 * Reconcile each prescribed target on `planDay` against today's `log`.
 * A step is emitted only when the plan specifies that metric. `met` is
 * computed once an actual exists; until then it's left undefined so the UI
 * renders a neutral "not yet" state rather than a red miss.
 *
 * Direction of "met":
 *  - fluid / carbs / sweat → higher is better; met when actual >= target
 *    (within tolerance).
 *  - sodium → the plan prescribes a ceiling near the cut, so met when
 *    actual <= target (within tolerance). Early water-load days the
 *    target is high and the same <= rule still reads sensibly.
 */
function buildSteps(
  planDay: PlanDay,
  log: DayLog | null,
): FightWeekCornermanData["steps"] {
  const steps: FightWeekCornermanData["steps"] = [];

  const waterLitres = Number(planDay.waterLitres);
  if (Number.isFinite(waterLitres) && waterLitres > 0) {
    const actualMl = log?.fluidIntakeMl;
    const hasActual = actualMl != null && Number.isFinite(Number(actualMl));
    const actualL = hasActual ? num(actualMl) / 1000 : null;
    steps.push({
      label: "Fluid",
      target: fmtLitres(waterLitres),
      ...(hasActual ? { actual: fmtMlAsLitres(num(actualMl)) } : {}),
      ...(actualL != null
        ? { met: actualL >= waterLitres * (1 - MET_TOLERANCE) }
        : {}),
    });
  }

  const carbsGrams = Number(planDay.carbsGrams);
  if (Number.isFinite(carbsGrams) && carbsGrams > 0) {
    const actualG = log?.carbsG;
    const hasActual = actualG != null && Number.isFinite(Number(actualG));
    steps.push({
      label: "Carbs",
      target: fmtGrams(carbsGrams),
      ...(hasActual ? { actual: fmtGrams(num(actualG)) } : {}),
      ...(hasActual
        ? { met: num(actualG) >= carbsGrams * (1 - MET_TOLERANCE) }
        : {}),
    });
  }

  const sodiumMg = Number(planDay.sodiumMg);
  if (Number.isFinite(sodiumMg) && sodiumMg > 0) {
    // No dedicated sodium column on fight_week_logs, so we can only show
    // the prescribed ceiling — no actual / met until that data exists.
    steps.push({
      label: "Sodium",
      target: fmtSodium(sodiumMg),
    });
  }

  // Sweat session is prescribed by some plan generations (cut days).
  const sweatTarget = Number(planDay.sweatSessionMin);
  if (Number.isFinite(sweatTarget) && sweatTarget > 0) {
    const actualMin = log?.sweatSessionMin;
    const hasActual = actualMin != null && Number.isFinite(Number(actualMin));
    steps.push({
      label: "Sweat session",
      target: fmtMinutes(sweatTarget),
      ...(hasActual ? { actual: fmtMinutes(num(actualMin)) } : {}),
      ...(hasActual
        ? { met: num(actualMin) >= sweatTarget * (1 - MET_TOLERANCE) }
        : {}),
    });
  }

  return steps;
}
