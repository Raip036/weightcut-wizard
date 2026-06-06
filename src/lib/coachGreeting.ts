/**
 * coachGreeting.ts
 *
 * Pure utility for the Fight Camp Coach cockpit. Builds the proactive
 * greeting line shown at the top of the coach view from real cockpit data.
 *
 * No UI, no side effects. Deterministic given (data, now).
 */

/**
 * The cockpit data shape.
 *
 * NOTE: The canonical copy of this interface lives in `convex/coachCockpit.ts`
 * (defined by the backend query). It is re-declared here so this module stays
 * dependency-free; keep fields identical. The integration layer passes the
 * query result, which is structurally compatible.
 */
export interface CoachCockpitData {
  phase: "build" | "peak" | "fightWeek" | null;
  daysToWeighIn: number | null;
  weighInDateISO: string | null;
  currentKg: number | null;
  targetKg: number | null;
  deltaKg: number | null; // currentKg - targetKg (positive = over target)
  onTrack: boolean | null;
  fightName: string | null;
  athleteName: string | null;
}

/** Maps the hour of day to a human greeting word. */
function timeOfDay(now: Date): "Morning" | "Afternoon" | "Evening" {
  const hour = now.getHours();
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

/** Rounds to 1 decimal place, returning a clean string (e.g. 6.4, 0.4, 12). */
function kg1(value: number): string {
  return Math.abs(Math.round(value * 10) / 10).toFixed(1);
}

/** "1 day" vs "3 days". */
function daysLabel(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * Builds the weight-status clause from days-to-weigh-in and delta/onTrack.
 * Returns null when there isn't enough data to say anything useful.
 *
 * Examples:
 *   3 days out, onTrack=true,  delta=-0.4 -> "3 days out, 0.4kg ahead of plan"
 *   30 days out, onTrack=false, delta=6.4 -> "30 days out, 6.4kg over target"
 *   0 days out (weigh-in today)           -> "weigh-in today"
 */
function buildStatusClause(data: CoachCockpitData): string | null {
  const { daysToWeighIn, deltaKg, onTrack } = data;

  if (daysToWeighIn == null) return null;

  if (daysToWeighIn <= 0) {
    // Weigh-in today (or past); keep it tight.
    if (deltaKg != null && deltaKg > 0.05) {
      return `weigh-in today, ${kg1(deltaKg)}kg to go`;
    }
    return "weigh-in today";
  }

  const out = `${daysLabel(daysToWeighIn)} out`;

  if (deltaKg == null) {
    return out;
  }

  // Within rounding of target -> on weight.
  if (Math.abs(deltaKg) < 0.05) {
    return `${out}, on weight`;
  }

  if (deltaKg > 0) {
    // Over target. onTrack tempers the wording.
    if (onTrack) {
      return `${out}, ${kg1(deltaKg)}kg to go and right on pace`;
    }
    return `${out}, ${kg1(deltaKg)}kg to go, a touch to claw back`;
  }

  // Under target (deltaKg < 0) -> ahead.
  return `${out}, ${kg1(deltaKg)}kg ahead of plan`;
}

/**
 * Builds the proactive cockpit greeting line.
 *
 * One punchy line (<= ~90 chars), no em-dashes, no markdown, kg to 1 decimal.
 *
 * Examples:
 *   buildCoachGreeting(null, morning)
 *     -> "Morning, no fight scheduled - let's plan your next camp"
 *
 *   buildCoachGreeting({ ...over,  athleteName: "Pratik", daysToWeighIn: 30,
 *                        deltaKg: 6.4, onTrack: false, phase: "build" }, morning)
 *     -> "Morning Pratik. 30 days out, 6.4kg over target"
 *
 *   buildCoachGreeting({ ...ahead, athleteName: "Pratik", daysToWeighIn: 3,
 *                        deltaKg: -0.4, onTrack: true, phase: "fightWeek" }, evening)
 *     -> "Evening Pratik. 3 days out, 0.4kg ahead of plan"
 */
export function buildCoachGreeting(
  data: CoachCockpitData | null,
  now: Date,
): string {
  const greeting = timeOfDay(now);
  const name = data?.athleteName?.trim() || null;

  // No camp scheduled (or no data at all).
  const noCamp =
    !data ||
    (data.phase == null && data.daysToWeighIn == null && !data.fightName);

  if (noCamp) {
    const lead = name ? `${greeting} ${name}` : greeting;
    return `${lead}, no fight booked yet. Want to plan your next camp?`;
  }

  const lead = name ? `${greeting} ${name}` : greeting;
  const status = buildStatusClause(data);

  if (!status) {
    // We have a camp but no actionable weight status yet.
    if (data.fightName) {
      return `${lead}. ${data.fightName} camp is live`;
    }
    return lead;
  }

  return `${lead}. ${status}`;
}
