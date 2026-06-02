import type { SessionRow, DailyStrainEntry, ForecastResult, AthleteCalibration } from "./types";
import { clamp, mapRange, getRecentSleepValues, groupByDate } from "./helpers";
import { calculateStrain } from "./load";
import { getLoadZone } from "./wellness";
import { isRestSession } from "@/lib/sessionTypes";

export function getStrainHistory(
  dailyLoads: { date: string; load: number; sessions: SessionRow[] }[],
  divisor: number = 1000,
): DailyStrainEntry[] {
  return dailyLoads.slice(-7).map(d => ({
    date: d.date,
    strain: calculateStrain(d.load, divisor),
    dailyLoad: d.load,
    sessionCount: d.sessions.filter(s => !isRestSession(s.session_type)).length,
  }));
}

export function getConsecutiveHighStrainDays(
  dailyLoads: { date: string; load: number }[],
  divisor: number = 1000,
): number {
  let count = 0;
  for (let i = dailyLoads.length - 1; i >= 0; i--) {
    if (calculateStrain(dailyLoads[i].load, divisor) > 15) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

export function getAvgRPE7d(sessions28d: SessionRow[]): number {
  const today = new Date();
  const recent: SessionRow[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    recent.push(...sessions28d.filter(s => s.date === dateStr && !isRestSession(s.session_type)));
  }
  if (recent.length === 0) return 0;
  return recent.reduce((sum, s) => sum + s.rpe, 0) / recent.length;
}

export function getAvgSoreness7d(sessions28d: SessionRow[]): number {
  const today = new Date();
  const recent: SessionRow[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    recent.push(...sessions28d.filter(s => s.date === dateStr && s.soreness_level > 0));
  }
  if (recent.length === 0) return 0;
  return recent.reduce((sum, s) => sum + s.soreness_level, 0) / recent.length;
}

export function getSessionsLast7d(sessions28d: SessionRow[]): number {
  const today = new Date();
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    count += sessions28d.filter(s => s.date === dateStr && !isRestSession(s.session_type)).length;
  }
  return count;
}

export function getLatestSleep(sessions28d: SessionRow[], sleepLogs?: { date: string; hours: number }[]): number {
  const sleepByDate = new Map<string, number>();
  if (sleepLogs) {
    for (const log of sleepLogs) {
      if (log.hours > 0) sleepByDate.set(log.date, log.hours);
    }
  }

  const grouped = groupByDate(sessions28d);
  const today = new Date();
  for (let i = 0; i < 3; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    // Check sleep_logs first
    const logged = sleepByDate.get(dateStr);
    if (logged) return logged;
    // Fall back to session sleep or default 8h if training happened
    const daySessions = grouped.get(dateStr) || [];
    if (daySessions.length > 0) {
      const withSleep = daySessions.find(s => s.sleep_hours > 0);
      return withSleep ? withSleep.sleep_hours : 8;
    }
  }
  return 8;
}

export function getLatestSoreness(sessions28d: SessionRow[]): number {
  const grouped = groupByDate(sessions28d);
  const today = new Date();
  for (let i = 0; i < 3; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const daySessions = grouped.get(dateStr) || [];
    const withSoreness = daySessions.find(s => s.soreness_level > 0);
    if (withSoreness) return withSoreness.soreness_level;
  }
  return 0;
}

export function getAvgSleep(sessions28d: SessionRow[], sleepLogs?: { date: string; hours: number }[]): number {
  const sleepByDate = new Map<string, number>();
  if (sleepLogs) {
    for (const log of sleepLogs) {
      if (log.hours > 0) sleepByDate.set(log.date, log.hours);
    }
  }

  // Collect sleep values: sleep_logs first, then session sleep, then 8h default for training days
  const grouped = groupByDate(sessions28d);
  const allDates = new Set([...sleepByDate.keys(), ...grouped.keys()]);
  const values: number[] = [];
  for (const date of allDates) {
    const logged = sleepByDate.get(date);
    if (logged) { values.push(logged); continue; }
    const daySessions = grouped.get(date) || [];
    if (daySessions.length > 0) {
      const sessionSleep = daySessions.find(s => s.sleep_hours > 0);
      values.push(sessionSleep ? sessionSleep.sleep_hours : 8);
    }
  }
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function getRecentSessions(sessions28d: SessionRow[]): SessionRow[] {
  const today = new Date();
  const recent: SessionRow[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    recent.push(...sessions28d.filter(s => s.date === dateStr));
  }
  return recent.slice(0, 15);
}

export function computeForecast(
  dailyLoads: { date: string; load: number }[],
  currentOvertrainingScore: number,
  calibration: AthleteCalibration,
): ForecastResult {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const targetDow = tomorrow.getDay();

  const sameDowLoads: number[] = [];
  for (let weeksBack = 1; weeksBack <= 3; weeksBack++) {
    const idx = dailyLoads.length - (weeksBack * 7);
    if (idx >= 0) {
      const entry = dailyLoads[idx];
      const entryDate = new Date(entry.date);
      if (entryDate.getDay() === targetDow && entry.load > 0) {
        sameDowLoads.push(entry.load);
      }
    }
  }

  let avgLoad: number;
  if (sameDowLoads.length >= 2) {
    avgLoad = sameDowLoads.reduce((s, l) => s + l, 0) / sameDowLoads.length;
  } else {
    const last3 = dailyLoads.slice(-3);
    const weights = [0.5, 0.3, 0.2];
    let weighted = 0;
    let totalW = 0;
    for (let i = 0; i < last3.length; i++) {
      const w = weights[i] ?? 0.1;
      weighted += last3[last3.length - 1 - i].load * w;
      totalW += w;
    }
    avgLoad = totalW > 0 ? weighted / totalW : 0;
  }

  const predictedStrain = calculateStrain(avgLoad, calibration.strainDivisor);

  const acuteWithPredicted = dailyLoads.slice(-6).reduce((sum, d) => sum + d.load, 0) + avgLoad;
  const chronicWithPredicted = (dailyLoads.reduce((sum, d) => sum + d.load, 0) + avgLoad) / 29;
  const predictedLoadRatio = acuteWithPredicted / (chronicWithPredicted + 1);

  let otDelta: number;
  const { caution, danger } = calibration.loadRatioThresholds;
  if (avgLoad === 0) {
    otDelta = -10;
  } else if (predictedLoadRatio > caution) {
    otDelta = Math.round(mapRange(predictedLoadRatio, caution, danger, 5, 15));
  } else {
    otDelta = -3;
  }

  const predictedOvertrainingScore = clamp(0, 100, currentOvertrainingScore + otDelta);

  return {
    predictedStrain,
    predictedLoadRatio,
    predictedLoadZone: getLoadZone(predictedLoadRatio, calibration),
    predictedOvertrainingScore,
    isRestDay: avgLoad === 0,
  };
}

export function computeSleepScore(sessions28d: SessionRow[], sleepLogs?: { date: string; hours: number }[]): number {
  const recentSleep = getRecentSleepValues(sessions28d, 3, sleepLogs);
  if (recentSleep.length === 0) return 50;

  let baseline: number;
  if (sleepLogs && sleepLogs.length > 0) {
    const withHours = sleepLogs.filter(log => log.hours > 0);
    baseline = withHours.length > 0
      ? withHours.reduce((sum, log) => sum + log.hours, 0) / withHours.length
      : 7.5;
  } else {
    const allSleep = sessions28d.filter(s => s.sleep_hours > 0);
    baseline = allSleep.length > 0
      ? allSleep.reduce((sum, s) => sum + s.sleep_hours, 0) / allSleep.length
      : 7.5;
  }

  const weights = [0.5, 0.3, 0.2];
  let weightedSleep = 0;
  let totalWeight = 0;
  for (let i = 0; i < recentSleep.length; i++) {
    const w = weights[i] ?? 0;
    weightedSleep += recentSleep[i] * w;
    totalWeight += w;
  }
  if (totalWeight > 0) weightedSleep /= totalWeight;
  else weightedSleep = baseline;

  return Math.round(clamp(0, 100, mapRange(weightedSleep, baseline - 3, baseline + 1, 0, 100)));
}

export function getAvgSleepLast3(sessions28d: SessionRow[], sleepLogs?: { date: string; hours: number }[]): number {
  const recentSleep = getRecentSleepValues(sessions28d, 3, sleepLogs);
  if (recentSleep.length === 0) return 0;
  return recentSleep.reduce((s, h) => s + h, 0) / recentSleep.length;
}
