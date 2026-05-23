import type { ScoringConfig, SubScore } from "../types";

export function computeSleep(
  sleepHours: Array<{ date: string; hours: number }>,
  asOfDate: string,
  cfg: ScoringConfig,
  assumedSleepDates: ReadonlyArray<string> = [],
): SubScore {
  const target = cfg.sleep.targetHoursPerNight;
  const perHourPenalty = cfg.sleep.perHourPenalty;
  const end = new Date(asOfDate + "T00:00:00Z");
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  let total = 0;
  let nights = 0;
  let assumedNights = 0;
  const assumedSet = new Set(assumedSleepDates);
  for (const log of sleepHours) {
    const t = new Date(log.date + "T00:00:00Z").getTime();
    if (t < start.getTime() || t > end.getTime()) continue;
    total += log.hours;
    nights++;
    if (assumedSet.has(log.date)) assumedNights++;
  }
  // Missing-data guard: < 3 logged nights means the sub-score is unreliable.
  // Returning weight:0 hands the slot back to compose.ts so the composite
  // redistributes across sub-scores that actually have signal.
  if (nights < 3) {
    return {
      value: 50,
      weight: 0,
      reason: nights === 0
        ? "No sleep logs in last 7 days"
        : `Only ${nights} night(s) logged in last 7 — need 3+`,
    };
  }
  // Per-night debt avoids penalising users who log only some nights of the
  // week. Compare the AVERAGE of logged nights to the per-night target;
  // a user who logs 4 nights at 7h is "1h short" per night, NOT "28h short"
  // versus a phantom 7×8h target.
  const avgHoursPerLoggedNight = total / nights;
  const debt = Math.max(0, target - avgHoursPerLoggedNight);
  const value = Math.max(0, Math.min(100, 100 - debt * perHourPenalty));
  const baseReason = debt > 0
    ? `${debt.toFixed(1)}h/night sleep debt vs ${target}h target (${nights} night${nights === 1 ? "" : "s"} logged)`
    : `On target (${nights} night${nights === 1 ? "" : "s"} logged)`;
  const reason = assumedNights > 0
    ? `${baseReason} (assumed ${cfg.sleep.defaultAssumedHours}h on ${assumedNights} day${assumedNights === 1 ? "" : "s"} — log to refine)`
    : baseReason;
  return {
    value: Math.round(value),
    weight: 0,
    reason,
  };
}
