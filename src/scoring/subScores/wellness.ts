import type { ScoringConfig, SubScore } from "../types";

export function computeWellness(
  hooperByDate: Array<{ date: string; hooper: number }>,
  asOfDate: string,
  cfg: ScoringConfig,
): SubScore {
  const end = new Date(asOfDate + "T00:00:00Z");
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const valid = hooperByDate
    .filter((d) => {
      const t = new Date(d.date + "T00:00:00Z").getTime();
      return t >= start.getTime() && t <= end.getTime();
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  if (valid.length === 0) {
    return { value: 50, weight: 0, reason: "No wellness check-ins in 7 days" };
  }

  // EMA over available days
  const alpha = 2 / (valid.length + 1);
  let ema = valid[0].hooper;
  for (let i = 1; i < valid.length; i++) ema = alpha * valid[i].hooper + (1 - alpha) * ema;

  // Linear curve over Hooper EMA (lower is better):
  //   <=5 => 100, >=8 => 0, linear in between.
  let value: number;
  if (ema <= 5) {
    value = 100;
  } else if (ema >= 8) {
    value = 0;
  } else {
    value = 100 * (8 - ema) / 3.0;
  }
  const emaStr = ema.toFixed(1);
  let reason: string;
  if (ema <= 5) {
    reason = `Feeling fresh (Hooper ${emaStr})`;
  } else if (ema >= 8) {
    reason = `High fatigue/stress (Hooper ${emaStr})`;
  } else {
    reason = `Moderate fatigue building (Hooper ${emaStr})`;
  }
  return {
    value: Math.round(value),
    weight: 0,
    reason,
  };
}
