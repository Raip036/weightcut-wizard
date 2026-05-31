import type { ScoringConfig, SubScore } from "../types";

type Session = { date: string; rpe: number; durationMinutes: number };

/**
 * Standard EWMA: `ema_t = α * x_t + (1-α) * ema_{t-1}`, iterated
 * chronologically (oldest → newest) from a seed of `values[0]`.
 *
 * `loadByDay` returns values in chronological order, so `values[0]` is the
 * OLDEST day and `values[values.length-1]` is today. After the loop, today
 * (x_t) contributes weight α directly while older values get α(1-α)^k decay.
 * That's the correct "today weighs heaviest" smoother — no direction fix
 * needed. (The Fix-5 audit suggested reversing iteration; that would have
 * been wrong. Verified by inspection of `loadByDay` ordering.)
 */
function ewma(values: number[], days: number): number {
  if (values.length === 0) return 0;
  const alpha = 2 / (days + 1);
  let v = values[0];
  for (let i = 1; i < values.length; i++) {
    v = alpha * values[i] + (1 - alpha) * v;
  }
  return v;
}

function loadByDay(sessions: Session[], asOfDate: string, windowDays: number): number[] {
  const end = new Date(asOfDate + "T00:00:00Z");
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (windowDays - 1));
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    const t = new Date(s.date + "T00:00:00Z").getTime();
    if (t < start.getTime() || t > end.getTime()) continue;
    const load = (s.rpe || 0) * (s.durationMinutes || 0);
    byDay.set(s.date, (byDay.get(s.date) ?? 0) + load);
  }
  const out: number[] = [];
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? 0);
  }
  return out;
}

export function computeTrainingLoad(
  sessions: Session[],
  asOfDate: string,
  cfg: ScoringConfig,
  restDays: ReadonlyArray<string> = [],
): SubScore {
  const c = cfg.trainingLoad;
  const acuteDaily = loadByDay(sessions, asOfDate, c.acuteWindowDays);
  const chronicDaily = loadByDay(sessions, asOfDate, c.chronicWindowDays);
  const acute = ewma(acuteDaily, c.acuteWindowDays);
  const chronic = ewma(chronicDaily, c.chronicWindowDays);

  const haveData = sessions.length > 0;
  if (!haveData) {
    return { value: 50, weight: 0, reason: "Cold start — no training data yet" };
  }
  // Count training days AND explicit rest days inside the chronic window
  // — both are "the user is engaged with the system" signals. Rest days
  // don't add load (so ACWR is unchanged) but they tell us we're not
  // just looking at missing data. We unblock the cold-start gate when
  // training+rest combined hits the threshold AND there are at least 2
  // actual training days to anchor ACWR.
  const chronicTrainingDays = chronicDaily.filter((v) => v > 0).length;
  const chronicWindowStart = (() => {
    const end = new Date(asOfDate + "T00:00:00Z");
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (c.chronicWindowDays - 1));
    return start.toISOString().slice(0, 10);
  })();
  const restDaysInChronic = restDays.filter(
    (d) => d >= chronicWindowStart && d <= asOfDate,
  ).length;
  const engagedDaysInChronic = chronicTrainingDays + restDaysInChronic;
  if (chronicTrainingDays < 2 || engagedDaysInChronic < 3) {
    return {
      value: 50,
      weight: 0,
      reason:
        chronicTrainingDays === 0
          ? "Cold start — no training data yet"
          : "Cold start — limited training history, ACWR not yet reliable",
    };
  }
  if (chronic === 0) {
    // huge acute load, no chronic baseline → assume spike
    const value = acute > 0 ? c.acwrFloor : 50;
    return {
      value,
      weight: 0,
      reason: "Limited training history — cannot compute ACWR reliably",
    };
  }

  const acwr = acute / chronic;
  // Widen the score-100 band to [0.7, 1.4] locally (calibration override)
  // while preserving the configured penalty edges and floor behaviour.
  const lo = 0.7;
  const hi = 1.4;
  const [loEdge, hiEdge] = c.acwrPenaltyEdges;
  let value: number;
  if (acwr >= lo && acwr <= hi) {
    value = 100;
  } else if (acwr < lo) {
    if (acwr <= loEdge) value = c.acwrFloor;
    else value = 40 + ((acwr - loEdge) / (lo - loEdge)) * 60;
  } else {
    if (acwr >= hiEdge) value = c.acwrFloor;
    else value = 40 + ((hiEdge - acwr) / (hiEdge - hi)) * 60;
  }
  value = Math.max(0, Math.min(100, value));
  const restNote =
    restDaysInChronic > 0
      ? ` · ${restDaysInChronic} rest day${restDaysInChronic === 1 ? "" : "s"} logged`
      : "";
  return {
    value: Math.round(value),
    weight: 0,
    reason: `ACWR ${acwr.toFixed(2)} (sweet spot ${lo}–${hi})${restNote}`,
  };
}
