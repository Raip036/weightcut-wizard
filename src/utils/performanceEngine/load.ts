import { logger } from "@/lib/logger";
import type { SessionRow } from "./types";
import { getIntensityMultiplier } from "./helpers";
import { sportLoadMultiplier, CONTACT_SESSION_TYPES } from "@/lib/sessionTypes";

// ─── EWMA-based ACWR ─────────────────────────────────────────
// EWMA decay: λ = 2 / (N + 1). N=7 → λ≈0.286 (acute), N=28 → λ≈0.069 (chronic).
// Williams et al. 2017 ACWR variant — weights the most recent days more
// heavily, which matches how the body actually accumulates fatigue.

export const ACUTE_LAMBDA = 2 / (7 + 1);
export const CHRONIC_LAMBDA = 2 / (28 + 1);

/**
 * Exponentially Weighted Moving Average of daily loads.
 * Most recent day has the highest weight. Williams et al. 2017 ACWR variant.
 */
export function ewmaLoad(dailyLoads: { date: string; load: number }[], lambda: number): number {
  if (dailyLoads.length === 0) return 0;
  let ewma = dailyLoads[0].load;
  for (let i = 1; i < dailyLoads.length; i++) {
    ewma = lambda * dailyLoads[i].load + (1 - lambda) * ewma;
  }
  return ewma;
}

/**
 * Computes EWMA-based Acute:Chronic Workload Ratio.
 * Acute window = trailing 7 days, chronic window = trailing 28 days.
 * +1 in the denominator avoids divide-by-zero for first-time users.
 */
export function computeEwmaAcwr(dailyLoads: { date: string; load: number }[]): {
  acuteLoad: number;
  chronicLoad: number;
  loadRatio: number;
} {
  const acuteLoad = ewmaLoad(dailyLoads.slice(-7), ACUTE_LAMBDA);
  const chronicLoad = ewmaLoad(dailyLoads.slice(-28), CHRONIC_LAMBDA);
  const loadRatio = acuteLoad / (chronicLoad + 1);
  return { acuteLoad, chronicLoad, loadRatio };
}

// ─── Session Load ────────────────────────────────────────────
// sessionLoad = RPE × minutes × intensityMultiplier × sportLoadMultiplier.
// The sport multiplier (from sessionTypes.ts) captures the fact that a
// 10 min sparring round costs the body more than 10 min of shadowboxing.
export function sessionLoad(session: SessionRow): number {
  if (session.session_type === 'Rest' || session.session_type === 'Recovery') {
    return 0;
  }
  return session.rpe
    * session.duration_minutes
    * getIntensityMultiplier(session)
    * sportLoadMultiplier(session.session_type);
}

// ─── CNS / Proximity Multiplier ─────────────────────────────
/**
 * CNS fatigue multiplier for multi-session days.
 * Replaces a flat 10% bump. Accounts for session count, intensity, and proximity
 * between sessions (using created_at timestamps when available).
 */
export function cnsMultiplier(sessions: SessionRow[]): number {
  const training = sessions.filter(s => s.session_type !== 'Rest' && s.session_type !== 'Recovery');
  if (training.length <= 1) return 1.0;

  const anyHighRpe = training.some(s => s.rpe >= 7);
  if (!anyHighRpe && training.length === 2) return 1.05;

  const timestamps = training
    .map(s => s.created_at ? new Date(s.created_at).getTime() : null)
    .filter((t): t is number => t != null)
    .sort((a, b) => a - b);

  if (timestamps.length < 2) return training.length > 1 ? 1.10 : 1.00;

  if (training.length >= 3) return 1.20;
  const maxGapHours = (timestamps[timestamps.length - 1] - timestamps[0]) / 3_600_000;
  if (maxGapHours < 6)  return 1.15;
  if (maxGapHours < 12) return 1.10;
  return 1.05;
}

// ─── Daily Load ──────────────────────────────────────────────
// Sum of session loads × CNS multiplier (which now accounts for
// session count, intensity, and proximity rather than a flat 10%).
export function dailyLoad(sessions: SessionRow[]): number {
  const training = sessions.filter(s => s.session_type !== 'Rest' && s.session_type !== 'Recovery');
  if (training.length === 0) return 0;

  const total = training.reduce((sum, s) => sum + sessionLoad(s), 0);
  const cns = cnsMultiplier(sessions);
  const result = total * cns;

  logger.info('[PE] dailyLoad', {
    sessions: training.length,
    rawTotal: total,
    cnsMultiplier: cns,
    result,
  });

  return result;
}

// ─── Strain ──────────────────────────────────────────────────
// strain = 21 * (1 - e^(-dailyLoad / divisor))
// Clamped 0-21. Diminishing returns at high loads.
export function calculateStrain(load: number, divisor: number = 1000): number {
  const strain = 21 * (1 - Math.exp(-load / divisor));
  const clamped = Math.min(21, Math.max(0, strain));

  logger.info('[PE] strain', { load, divisor, strain: clamped });

  return clamped;
}

// ─── Foster Monotony + Weekly Strain ─────────────────────────
/**
 * Foster's overtraining indicators (Foster, 1998).
 * - Monotony = mean(weeklyDailyLoads) / std(weeklyDailyLoads)
 *   - High monotony (> ~2.0) = same-intensity-every-day pattern, overtraining risk.
 * - Weekly Strain = weeklyTotalLoad × monotony
 *   - Foster red flag at > 6000.
 *
 * Edge case: <7 days of data returns zeros — the index just hasn't seen
 * enough variance to make a meaningful call yet.
 */
export function computeFosterMetrics(dailyLoads: { date: string; load: number }[]): {
  weeklyMonotony: number;
  weeklyStrain: number;
} {
  const last7 = dailyLoads.slice(-7).map(d => d.load);
  if (last7.length === 0) return { weeklyMonotony: 0, weeklyStrain: 0 };
  const weeklyTotal = last7.reduce((s, l) => s + l, 0);
  const mean = weeklyTotal / 7;
  const variance = last7.reduce((s, l) => s + (l - mean) ** 2, 0) / 7;
  const std = Math.sqrt(variance);
  const weeklyMonotony = std > 0.01 ? mean / std : 0;
  const weeklyStrain = weeklyTotal * weeklyMonotony;
  return { weeklyMonotony, weeklyStrain };
}

// ─── Contact Load Tracker ────────────────────────────────────
export type ContactRiskZone = 'low' | 'moderate' | 'high' | 'critical';

/**
 * Combat-sports-specific injury-risk metric. Counts rounds of contact
 * (sparring + live grappling) over rolling 7 days. Uses an optional
 * `rounds` field on the session row (added to schema in T5).
 */
export function computeContactLoad(sessions28d: SessionRow[]): {
  contactRoundsLast7d: number;
  contactRiskZone: ContactRiskZone;
} {
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  const cutoff = sevenDaysAgo.toISOString().slice(0, 10);

  const contactRoundsLast7d = sessions28d
    .filter(s => s.date >= cutoff && CONTACT_SESSION_TYPES.has(s.session_type))
    .reduce((sum, s) => sum + ((s as any).rounds ?? 0), 0);

  let contactRiskZone: ContactRiskZone;
  if (contactRoundsLast7d <= 8)  contactRiskZone = 'low';
  else if (contactRoundsLast7d <= 15) contactRiskZone = 'moderate';
  else if (contactRoundsLast7d <= 25) contactRiskZone = 'high';
  else contactRiskZone = 'critical';

  return { contactRoundsLast7d, contactRiskZone };
}
