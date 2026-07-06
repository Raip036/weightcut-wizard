// src/lib/dayType.ts
//
// Maps a single logged training session (the two-level model: primary
// discipline + optional activity tag) onto the carb-cycle training-day type
// used by the cut plan's macro math (`macroForDay` in convex/_shared/math.ts).
//
//   hard   — a high-intensity or contact session today (carbs lead + climb).
//   rest   — a Rest-primary session, or no session logged (protein led).
//   medium — anything in between (the representative day). Also the default
//            when the signal is ambiguous.
//
// Pure + unit-testable: no React, no Convex, no I/O. Reuses the shared session
// classifiers so the contact/load rules never drift from the training engine.

import {
  isContactSession,
  isRestSession,
  effectiveLoadMultiplier,
} from "@/lib/sessionTypes";
import type { TrainingDay } from "@/../convex/_shared/math";

export type { TrainingDay };

/**
 * The subset of a `fight_camp_calendar` row (as returned by
 * `api.fight_camp.listCalendar`) that the day-type derivation reads. All
 * fields are optional so a partially-populated / legacy row still classifies.
 */
export interface DayTypeSession {
  /** PRIMARY category: a martial art, "S&C", or "Rest". */
  sessionType?: string | null;
  /** Optional activity tag (Sparring, Strength, Run, …). */
  sessionTag?: string | null;
  /** "low" | "moderate" | "high" preset string. */
  intensity?: string | null;
  /** 1-5 intensity preset level. */
  intensityLevel?: number | null;
  /** 3-10 rate of perceived exertion. */
  rpe?: number | null;
}

// A session counts as "hard" when it is a contact session, a heavy-load
// activity (Sparring / Live Grappling / Hard Drilling …), or the athlete
// logged it at the top of the intensity / RPE range.
const HARD_LOAD_MULTIPLIER = 1.15; // Hard Drilling and above.
const HARD_INTENSITY_LEVEL = 4; // "Battle" (4) and "Max" (5).
const HARD_RPE = 8;

/**
 * Derive the carb-cycle training-day type for today's session.
 *
 * @param session Today's logged session, or `null`/`undefined` when none.
 * @returns "hard" | "medium" | "rest" (defaults to "medium" when ambiguous).
 */
export function deriveDayType(
  session: DayTypeSession | null | undefined,
): TrainingDay {
  // No session logged for the day → treated as a rest day for fuelling.
  if (!session) return "rest";

  const primary = session.sessionType ?? null;
  const tag = session.sessionTag ?? null;

  // An explicit Rest-primary session is a rest day.
  if (isRestSession(primary)) return "rest";

  const isHard =
    isContactSession(primary, tag) ||
    effectiveLoadMultiplier(primary, tag) >= HARD_LOAD_MULTIPLIER ||
    (typeof session.intensityLevel === "number" &&
      session.intensityLevel >= HARD_INTENSITY_LEVEL) ||
    (typeof session.rpe === "number" && session.rpe >= HARD_RPE) ||
    (typeof session.intensity === "string" &&
      session.intensity.toLowerCase() === "high");

  if (isHard) return "hard";

  // A logged, non-rest, non-hard session is a medium training day. Ambiguous
  // signals also fall through to medium (the representative day).
  return "medium";
}
