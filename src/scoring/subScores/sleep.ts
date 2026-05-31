import type { ScoringConfig, SubScore } from "../types";

export function computeSleep(
  sleepHours: Array<{ date: string; hours: number }>,
  asOfDate: string,
  cfg: ScoringConfig,
  assumedSleepDates: ReadonlyArray<string> = [],
): SubScore {
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
  // Linear curve over avg hours per logged night:
  //   >=7.5h => 100, <=5.5h => 0, linear in between.
  const avgHoursPerLoggedNight = total / nights;
  let value: number;
  if (avgHoursPerLoggedNight >= 7.5) {
    value = 100;
  } else if (avgHoursPerLoggedNight <= 5.5) {
    value = 0;
  } else {
    value = 100 * (avgHoursPerLoggedNight - 5.5) / 2.0;
  }
  const avgStr = avgHoursPerLoggedNight.toFixed(1);
  let baseReason: string;
  if (avgHoursPerLoggedNight >= 7.5) {
    baseReason = `Sleep on track (avg ${avgStr}h)`;
  } else if (avgHoursPerLoggedNight <= 5.5) {
    baseReason = `Significant sleep debt (avg ${avgStr}h)`;
  } else {
    baseReason = `Building sleep debt (avg ${avgStr}h)`;
  }
  const reason = assumedNights > 0
    ? `${baseReason} (assumed ${cfg.sleep.defaultAssumedHours}h on ${assumedNights} day${assumedNights === 1 ? "" : "s"} — log to refine)`
    : baseReason;
  return {
    value: Math.round(value),
    weight: 0,
    reason,
  };
}
