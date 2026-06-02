// WHOOP-style Deterministic Performance Engine
// All strain/load/overtraining calculations are non-AI
// LLM only interprets — never calculates

import { logger } from "@/lib/logger";
import type { SessionRow, AllMetrics, OvertrainingRisk, WellnessCheckIn, PersonalBaseline, LoadConfidence, DailySessionSummary, ThisWeekSummary, LastWeekSummary } from "./types";
import { clamp, mapRange, groupByDate } from "./helpers";
import { sessionLoad, dailyLoad, calculateStrain, computeEwmaAcwr, computeFosterMetrics, computeContactLoad } from "./load";
import { deriveCalibration } from "./calibration";
import { getLoadZone, computeBalanceMetrics, computeDeficitImpactScore, computeWellnessScore, computeStabilityScore } from "./wellness";
import { computeEnhancedReadiness, applyRestDayRecovery } from "./readiness";
import { detectTrends, detectEnhancedTrends } from "./trends";
import {
  getStrainHistory, getConsecutiveHighStrainDays,
  getAvgRPE7d, getAvgSoreness7d, getSessionsLast7d,
  getLatestSleep, getLatestSoreness, getAvgSleep, getRecentSessions,
  computeForecast, computeSleepScore, getAvgSleepLast3,
} from "./stats";
import { derivePillars } from "./pillars";
import { generateActionLine } from "./actionLine";
import { isRestSession } from "@/lib/sessionTypes";

// ─── Build Daily Loads Array (28 days) ───────────────────────
function buildDailyLoads(sessions28d: SessionRow[]): { date: string; load: number; sessions: SessionRow[] }[] {
  const grouped = groupByDate(sessions28d);
  const today = new Date();
  const result: { date: string; load: number; sessions: SessionRow[] }[] = [];

  for (let i = 27; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const daySessions = grouped.get(dateStr) || [];
    result.push({
      date: dateStr,
      load: dailyLoad(daySessions),
      sessions: daySessions,
    });
  }

  return result;
}

// Minimum days of training in the trailing 28 before ACWR is considered
// meaningful. Sports-science consensus settles around 2 weeks of consistent
// data; anything less and the chronic baseline is dominated by zeros which
// makes the acute/chronic ratio explode on the first session logged.
const LOAD_CONFIDENCE_REQUIRED_DAYS = 14;

// Absolute floor on weekly load before ANY spike warning fires, regardless
// of ratio. Roughly equivalent to one solid 60 min session at RPE 7. Stops
// the engine from screaming "Heavy week" when the user has done one easy
// run all week, even if the ratio math says otherwise.
const MIN_ACUTE_LOAD_FOR_SPIKE_WARNING = 500;

// Hooper index >= 16 = "Good" or "Great" wellness. When the body is
// objectively saying it feels fine, downgrade load warnings by one severity
// step so the model doesn't contradict what the user already told it.
const WELLNESS_OK_HOOPER_THRESHOLD = 16;

// ─── Load Monitoring ─────────────────────────────────────────
function computeLoadMetrics(dailyLoads: { date: string; load: number }[]): {
  acuteLoad: number;
  chronicLoad: number;
  loadRatio: number;
  loadConfidence: LoadConfidence;
} {
  // EWMA-based ACWR (Williams et al. 2017) — weights recent days more heavily
  // than the older flat 7d sum / 28d mean approach.
  const { acuteLoad, chronicLoad, loadRatio } = computeEwmaAcwr(dailyLoads);

  // Reliability gate: count distinct training days (any non-zero load) across
  // the full 28-day window. ACWR is only meaningful with sustained data.
  const trainingDaysIn28d = dailyLoads.filter((d) => d.load > 0).length;
  const loadConfidence: LoadConfidence = {
    trainingDaysIn28d,
    required: LOAD_CONFIDENCE_REQUIRED_DAYS,
    isReliable: trainingDaysIn28d >= LOAD_CONFIDENCE_REQUIRED_DAYS,
  };

  logger.info('[PE] loadMetrics', { acuteLoad, chronicLoad, loadRatio, trainingDaysIn28d, isReliable: loadConfidence.isReliable });

  return { acuteLoad, chronicLoad, loadRatio, loadConfidence };
}

// ─── Adaptive Overtraining Score ────────────────────────────

function computeAdaptiveOvertrainingScore(
  loadRatio: number,
  acuteLoad: number,
  loadConfidence: LoadConfidence,
  avgRPE7d: number,
  avgSoreness7d: number,
  consecutiveHighDays: number,
  sessionsLast7d: number,
  calibration: import("./types").AthleteCalibration,
  trends: import("./types").TrendAlerts,
  todayCheckIn: WellnessCheckIn | null | undefined,
): OvertrainingRisk {
  let score = 0;
  const factors: string[] = [];

  // Load-spike penalty is gated on two things: (a) we have enough chronic
  // history for the ratio to be meaningful at all, and (b) the absolute
  // weekly load is large enough that a "spike" is plausibly real fatigue
  // and not just one solid session on an otherwise empty week.
  const loadSpikeAllowed = loadConfidence.isReliable && acuteLoad >= MIN_ACUTE_LOAD_FOR_SPIKE_WARNING;
  const { caution, danger } = calibration.loadRatioThresholds;
  const inPeak = calibration.phase === 'peak';
  if (loadSpikeAllowed) {
    if (loadRatio > danger) {
      if (inPeak) {
        // Camp peak: load is supposed to spike. Relabel for transparency
        // but don't penalize — peaking is intentional, not overtraining.
        factors.push('Camp peak load — expected at this stage');
      } else {
        score += 40;
        factors.push(`Severe acute load spike (ratio ${loadRatio.toFixed(2)} > ${danger})`);
      }
    } else if (loadRatio > caution) {
      if (inPeak) {
        factors.push('Camp peak load — expected at this stage');
      } else {
        score += Math.round(mapRange(loadRatio, caution, danger, 15, 40));
        factors.push(`Elevated acute load (ratio ${loadRatio.toFixed(2)} > ${caution})`);
      }
    }
  }

  // Taper: load SHOULD be down, but if it's collapsed too far the athlete
  // risks losing sharpness. Surface as a transparency factor only — no
  // score contribution (this isn't overtraining, it's the inverse).
  if (calibration.phase === 'taper' && loadRatio < 0.7) {
    factors.push('Taper looks too aggressive — keep some intensity');
  }

  if (avgRPE7d > calibration.rpeCeiling) {
    const overBy = avgRPE7d - calibration.rpeCeiling;
    const rpePenalty = Math.round(clamp(0, 25, overBy * 10));
    score += rpePenalty;
    factors.push(`Average RPE ${avgRPE7d.toFixed(1)} exceeds ceiling ${calibration.rpeCeiling}`);
  }

  if (avgSoreness7d > 6) {
    const sorenessPenalty = Math.round(mapRange(avgSoreness7d, 6, 10, 10, 25));
    score += sorenessPenalty;
    factors.push(`High average soreness (${avgSoreness7d.toFixed(1)}/10) in last 7 days`);
  }

  if (consecutiveHighDays >= 3) {
    score += 20;
    factors.push(`${consecutiveHighDays} consecutive high-strain days`);
  }

  if (sessionsLast7d >= calibration.sessionFrequencyFlagThreshold) {
    score += 15;
    factors.push(`${sessionsLast7d} sessions in last 7 days (threshold: ${calibration.sessionFrequencyFlagThreshold})`);
  }

  if (trends.sorenessRising) {
    score += 10;
    factors.push('Soreness trending upward');
  }
  if (trends.sleepDeclining) {
    score += 8;
    factors.push('Sleep quality declining');
  }
  if (trends.loadEscalating) {
    score += 8;
    factors.push('Training load escalating without rest');
  }

  score = clamp(0, 100, score);

  // Wellness override: if the user said they feel Good or Great today, the
  // body's signal beats a load-math edge case. Downgrade the score so the
  // zone moves down one tier (Critical -> High, High -> Moderate, etc).
  const hooper = todayCheckIn?.hooper_index;
  let wellnessAdjusted = false;
  if (typeof hooper === 'number' && hooper >= WELLNESS_OK_HOOPER_THRESHOLD && score >= 20) {
    const reduced = Math.max(0, score - 25);
    if (reduced < score) {
      wellnessAdjusted = true;
      factors.push(`Wellness check-in is good (Hooper ${hooper}/28), softening load warnings`);
      score = reduced;
    }
  }

  let zone: OvertrainingRisk['zone'];
  if (score <= 30) zone = 'low';
  else if (score <= 60) zone = 'moderate';
  else if (score <= 80) zone = 'high';
  else zone = 'critical';

  logger.info('[PE] adaptiveOvertrainingScore', {
    score, zone, factors, tier: calibration.tier,
    loadSpikeAllowed, wellnessAdjusted,
  });

  return { score, zone, factors };
}

// ─── Master Function ─────────────────────────────────────────
export function computeAllMetrics(
  sessions28d: SessionRow[],
  profileFreq?: number | null,
  activityLevel?: string | null,
  todayCheckIn?: WellnessCheckIn | null,
  baseline?: PersonalBaseline | null,
  previousDayReadiness?: number | null,
  sleepLogs?: { date: string; hours: number }[],
  daysToFight?: number | null,
): AllMetrics {
  const calibration = deriveCalibration(
    profileFreq ?? null,
    activityLevel ?? null,
    sessions28d,
    daysToFight ?? null,
  );

  const dailyLoadsArr = buildDailyLoads(sessions28d);
  const { acuteLoad, chronicLoad, loadRatio, loadConfidence } = computeLoadMetrics(dailyLoadsArr);

  const todayEntry = dailyLoadsArr[dailyLoadsArr.length - 1];
  const todayStrain = calculateStrain(todayEntry.load, calibration.strainDivisor);

  const avgRPE = getAvgRPE7d(sessions28d);
  const avgSoreness = getAvgSoreness7d(sessions28d);
  const consecutiveHighDays = getConsecutiveHighStrainDays(dailyLoadsArr, calibration.strainDivisor);
  const sessionsLast7d = getSessionsLast7d(sessions28d);

  const trends = baseline
    ? detectEnhancedTrends(sessions28d, dailyLoadsArr, baseline, sleepLogs)
    : detectTrends(sessions28d, dailyLoadsArr, sleepLogs);

  const overtrainingRisk = computeAdaptiveOvertrainingScore(
    loadRatio,
    acuteLoad,
    loadConfidence,
    avgRPE,
    avgSoreness,
    consecutiveHighDays,
    sessionsLast7d,
    calibration,
    trends,
    todayCheckIn,
  );

  const todayRestSessions = todayEntry.sessions?.filter(s => s.session_type === 'Rest') || [];
  if (todayRestSessions.length > 0) {
    const restSession = todayRestSessions[0];
    const adjusted = applyRestDayRecovery(
      overtrainingRisk.score,
      restSession.soreness_level,
      restSession.sleep_quality ?? null,
      restSession.sleep_hours,
      restSession.fatigue_level ?? null,
      restSession.mobility_done ?? null,
    );
    overtrainingRisk.score = adjusted;
    if (adjusted <= 30) overtrainingRisk.zone = 'low';
    else if (adjusted <= 60) overtrainingRisk.zone = 'moderate';
    else if (adjusted <= 80) overtrainingRisk.zone = 'high';
    else overtrainingRisk.zone = 'critical';
  }

  const readiness = computeEnhancedReadiness(
    sessions28d, dailyLoadsArr, loadRatio, calibration,
    todayCheckIn, baseline, previousDayReadiness,
  );

  const forecast = computeForecast(dailyLoadsArr, overtrainingRisk.score, calibration);

  const sleepScore = computeSleepScore(sessions28d, sleepLogs);
  const avgSleepLast3 = getAvgSleepLast3(sessions28d, sleepLogs);

  // Foster overtraining indicators + combat-sports contact-load tracker.
  const { weeklyMonotony, weeklyStrain } = computeFosterMetrics(dailyLoadsArr);
  const { contactRoundsLast7d, contactRiskZone } = computeContactLoad(sessions28d);

  const enhancedFields: Partial<AllMetrics> = {};

  if (todayCheckIn) {
    enhancedFields.hooperIndex = todayCheckIn.hooper_index;
    enhancedFields.hooperComponents = {
      sleep: todayCheckIn.sleep_quality,
      stress: todayCheckIn.stress_level,
      fatigue: todayCheckIn.fatigue_level,
      soreness: todayCheckIn.soreness_level,
    };
    enhancedFields.wellnessScore = computeWellnessScore(todayCheckIn.hooper_index, baseline ?? null);
  }

  if (baseline) {
    enhancedFields.balanceMetrics = computeBalanceMetrics(baseline);
    enhancedFields.deficitImpactScore = computeDeficitImpactScore(baseline.avg_deficit_7d);
    enhancedFields.stabilityScore = computeStabilityScore(baseline.hooper_cv_14d);
  }

  // Calendar week boundaries — Monday as week start. Today is computed
  // from the same Date instance used elsewhere so DST quirks line up.
  const _now = new Date();
  const _dow = (_now.getDay() + 6) % 7; // 0..6, Monday = 0
  const _monday = new Date(_now);
  _monday.setHours(0, 0, 0, 0);
  _monday.setDate(_monday.getDate() - _dow);
  const _lastMonday = new Date(_monday);
  _lastMonday.setDate(_lastMonday.getDate() - 7);
  const _lastSunday = new Date(_monday);
  _lastSunday.setDate(_lastSunday.getDate() - 1);
  const _todayIso = _now.toISOString().slice(0, 10);
  const _weekStartIso = _monday.toISOString().slice(0, 10);

  const _toIso = (d: Date) => d.toISOString().slice(0, 10);
  const _isoForOffset = (start: Date, offset: number) => {
    const d = new Date(start);
    d.setDate(d.getDate() + offset);
    return _toIso(d);
  };

  // Build the 7-key sessionsByDate map up front so every Mon..Sun
  // has a stable key (empty array if no sessions).
  const _sessionsByDate: Record<string, DailySessionSummary[]> = {};
  for (let i = 0; i < 7; i++) {
    _sessionsByDate[_isoForOffset(_monday, i)] = [];
  }

  let _thisWeekSessions = 0;
  let _thisWeekMinutes = 0;
  let _lastWeekSessions = 0;
  let _lastWeekMinutes = 0;

  const _lastWeekStartIso = _toIso(_lastMonday);
  const _lastWeekEndIso = _toIso(_lastSunday);

  for (const s of sessions28d) {
    if (isRestSession(s.session_type)) continue; // exclude rest from training totals
    const date = s.date;
    // This calendar week
    if (date >= _weekStartIso && date <= _todayIso) {
      _thisWeekSessions += 1;
      _thisWeekMinutes += s.duration_minutes ?? 0;
      if (_sessionsByDate[date]) {
        _sessionsByDate[date].push({
          sessionType: s.session_type,
          sessionTag: s.session_tag ?? null,
          durationMinutes: s.duration_minutes ?? 0,
          rpe: s.rpe ?? 0,
        });
      }
    } else if (date >= _lastWeekStartIso && date <= _lastWeekEndIso) {
      _lastWeekSessions += 1;
      _lastWeekMinutes += s.duration_minutes ?? 0;
    }
  }

  const thisWeek: ThisWeekSummary = {
    sessionCount: _thisWeekSessions,
    totalMinutes: _thisWeekMinutes,
    sessionsByDate: _sessionsByDate,
    weekStart: _weekStartIso,
    today: _todayIso,
  };
  const lastWeek: LastWeekSummary = {
    sessionCount: _lastWeekSessions,
    totalMinutes: _lastWeekMinutes,
  };

  // ─── Display pillars + deterministic action line ──────────────
  // Pillars are display-derived from the existing readiness breakdown;
  // they DO NOT re-weight the hero readiness score.
  const pillars = derivePillars(readiness.breakdown, loadConfidence);

  // Days since the most recent hard session (RPE >= 7, excluding rest/recovery).
  // Sentinel = 999 if there's no hard session in the 28d window.
  const _todayDateIso = new Date().toISOString().slice(0, 10);
  const _hardDates = sessions28d
    .filter(s => s.rpe >= 7 && !isRestSession(s.session_type))
    .map(s => s.date)
    .sort()
    .reverse();
  const _lastHardIso = _hardDates[0];
  const daysSinceLastHardSession = _lastHardIso
    ? Math.floor((Date.parse(_todayDateIso) - Date.parse(_lastHardIso)) / 86_400_000)
    : 999;

  const actionLine = generateActionLine({
    readinessScore: readiness.score,
    campPhase: calibration.phase ?? 'off-camp',
    daysSinceLastHardSession,
    sessionsLast7d,
  });

  logger.info('[PE] allMetrics', {
    strain: todayStrain,
    acuteLoad,
    chronicLoad,
    loadRatio,
    overtrainingScore: overtrainingRisk.score,
    overtrainingZone: overtrainingRisk.zone,
    readiness: readiness.score,
    readinessTier: readiness.breakdown.tier,
    tier: calibration.tier,
  });

  return {
    strain: todayStrain,
    dailyLoad: todayEntry.load,
    acuteLoad,
    chronicLoad,
    loadRatio,
    loadConfidence,
    loadZone: getLoadZone(loadRatio, calibration),
    overtrainingRisk,
    weeklySessionCount: sessionsLast7d,
    thisWeek,
    lastWeek,
    avgSleep: getAvgSleep(sessions28d, sleepLogs),
    latestSleep: getLatestSleep(sessions28d, sleepLogs),
    latestSoreness: getLatestSoreness(sessions28d),
    avgRPE7d: avgRPE,
    avgSoreness7d: avgSoreness,
    sessionsLast7d,
    consecutiveHighDays,
    strainHistory: getStrainHistory(dailyLoadsArr, calibration.strainDivisor),
    forecast,
    recentSessions: getRecentSessions(sessions28d),
    readiness,
    trends,
    calibration,
    sleepScore,
    avgSleepLast3,
    weeklyMonotony,
    weeklyStrain,
    contactRoundsLast7d,
    contactRiskZone,
    pillars,
    actionLine,
    ...enhancedFields,
  };
}

// ─── Re-exports ──────────────────────────────────────────────
// All consumers import from @/utils/performanceEngine — barrel re-exports everything

export type {
  SessionRow, SleepLog, OvertrainingRisk, DailyStrainEntry, LoadZone, LoadZoneInfo,
  ForecastResult, AthleteTier, AthleteCalibration, CampPhase, TrendAlerts,
  ReadinessBreakdown, EnhancedReadinessBreakdown, ReadinessResult,
  WellnessCheckIn, BalanceDirection, BalanceSeverity, BalanceMetric,
  PersonalBaseline, AllMetrics, PillarScores,
  DailySessionSummary, ThisWeekSummary, LastWeekSummary,
} from "./types";

export { clamp, mapRange, getRecentSleepValues, getRecentSorenessValues, zScore } from "./helpers";
export {
  sessionLoad, dailyLoad, calculateStrain,
  ewmaLoad, computeEwmaAcwr, cnsMultiplier,
  computeFosterMetrics, computeContactLoad,
  ACUTE_LAMBDA, CHRONIC_LAMBDA,
} from "./load";
export type { ContactRiskZone } from "./load";
export { deriveCalibration, determineCampPhase, applyCampPhaseToCalibration } from "./calibration";
export {
  computeBalanceMetrics, computeDeficitImpactScore, computeWellnessScore,
  computeStabilityScore, autoRegressiveSmooth, getLoadZone,
} from "./wellness";
export { computeReadiness, computeEnhancedReadiness, applyRestDayRecovery } from "./readiness";
export { detectTrends, detectEnhancedTrends } from "./trends";
export { derivePillars } from "./pillars";
export { generateActionLine } from "./actionLine";
export type { ActionLineInput } from "./actionLine";
