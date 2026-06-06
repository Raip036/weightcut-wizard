import type { ScoringConfig, SubScore } from "../types";

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/**
 * Wellness sub-score from the daily check-in's Hooper index.
 *
 * Convention (must match the survey in `WellnessCheckIn.tsx`):
 *   hooper = sleep_quality + (8 - stress) + (8 - fatigue) + (8 - soreness)
 *   range 4..28, where HIGHER = BETTER (fresher / more recovered).
 *
 * The previous implementation assumed the opposite ("lower is better") with
 * hardcoded thresholds, which inverted the result — a great day (Hooper ~28)
 * scored 0. We now use the config-driven linear map declared in `config/v1.ts`
 * (`hooperFloor: 4`, `hooperScalar: 4.2`) so:
 *   Hooper 4  → 0   (wrung out)
 *   Hooper 16 → ~50 (moderate)
 *   Hooper 28 → 100 (fresh)
 * which is the direction the stored data has always carried.
 */
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

  // EMA over available days (most recent weighted heaviest).
  const alpha = 2 / (valid.length + 1);
  let ema = valid[0].hooper;
  for (let i = 1; i < valid.length; i++) ema = alpha * valid[i].hooper + (1 - alpha) * ema;

  // Linear map over the Hooper EMA (higher = fresher).
  const { hooperFloor, hooperScalar } = cfg.wellness;
  const value = clamp((ema - hooperFloor) * hooperScalar, 0, 100);

  const emaStr = ema.toFixed(1);
  let reason: string;
  if (value >= 66) {
    reason = `Feeling fresh (Hooper ${emaStr})`;
  } else if (value >= 33) {
    reason = `Moderate fatigue building (Hooper ${emaStr})`;
  } else {
    reason = `High fatigue/stress (Hooper ${emaStr})`;
  }
  return {
    value: Math.round(value),
    weight: 0,
    reason,
  };
}
