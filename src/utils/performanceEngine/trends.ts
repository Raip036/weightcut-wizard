import type { SessionRow, TrendAlerts, PersonalBaseline } from "./types";
import { getRecentSorenessValues, getRecentSleepValues, zScore } from "./helpers";
import { isRestSession } from "@/lib/sessionTypes";

export function detectTrends(
  sessions28d: SessionRow[],
  dailyLoadsArr: { date: string; load: number }[],
  sleepLogs?: { date: string; hours: number }[],
): TrendAlerts {
  const alerts: string[] = [];
  let sorenessRising = false;
  let sleepDeclining = false;
  let loadEscalating = false;
  let rpeCreeping = false;

  const recentSoreness = getRecentSorenessValues(sessions28d, 4);
  if (recentSoreness.length >= 3) {
    if (recentSoreness[0] > recentSoreness[1] && recentSoreness[1] > recentSoreness[2]) {
      sorenessRising = true;
      alerts.push(`Soreness trending up: ${recentSoreness[2]}→${recentSoreness[1]}→${recentSoreness[0]}/10 over 3 days`);
    }
  }

  const recentSleep = getRecentSleepValues(sessions28d, 4, sleepLogs);
  if (recentSleep.length >= 4) {
    let decliningCount = 0;
    for (let i = 0; i < 3; i++) {
      if (recentSleep[i] < recentSleep[i + 1]) decliningCount++;
    }
    if (decliningCount >= 3) {
      sleepDeclining = true;
      alerts.push(`Sleep declining: ${recentSleep.slice().reverse().map(h => h + 'h').join('→')} over 4 nights`);
    }
  }

  const lastDays = dailyLoadsArr.slice(-4);
  if (lastDays.length >= 3) {
    const last3 = lastDays.slice(-3);
    const allNonZero = last3.every(d => d.load > 0);
    const increasing = last3[2].load > last3[1].load && last3[1].load > last3[0].load;
    if (allNonZero && increasing) {
      loadEscalating = true;
      alerts.push(`Training load escalating for 3+ days with no rest`);
    }
  }

  const trainingSessions = sessions28d
    .filter(s => !isRestSession(s.session_type))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));

  if (trainingSessions.length >= 6) {
    const recent3 = trainingSessions.slice(0, 3);
    const prior3 = trainingSessions.slice(3, 6);
    const avgRecent = recent3.reduce((s, x) => s + x.rpe, 0) / 3;
    const avgPrior = prior3.reduce((s, x) => s + x.rpe, 0) / 3;
    if (avgRecent - avgPrior >= 1.5) {
      rpeCreeping = true;
      alerts.push(`RPE creeping up: recent avg ${avgRecent.toFixed(1)} vs prior ${avgPrior.toFixed(1)}`);
    }
  }

  return { sorenessRising, sleepDeclining, loadEscalating, rpeCreeping, alerts };
}

// ─── Enhanced Trend Detection ────────────────────────────────

export function detectEnhancedTrends(
  sessions28d: SessionRow[],
  dailyLoadsArr: { date: string; load: number }[],
  baseline?: PersonalBaseline | null,
  sleepLogs?: { date: string; hours: number }[],
): TrendAlerts {
  const baseTrends = detectTrends(sessions28d, dailyLoadsArr, sleepLogs);

  if (!baseline) return baseTrends;

  const alerts = [...baseTrends.alerts];

  if (baseline.hooper_mean_14d != null && baseline.hooper_mean_60d != null && baseline.hooper_std_60d != null) {
    const wellnessZ = zScore(baseline.hooper_mean_14d, baseline.hooper_mean_60d, baseline.hooper_std_60d);
    if (wellnessZ < -1.0) {
      alerts.push(`Wellness declining: 14-day avg below 60-day baseline by ${Math.abs(wellnessZ).toFixed(1)} SD`);
    }
  }

  if (baseline.hooper_cv_14d != null && baseline.hooper_cv_14d > 0.25) {
    alerts.push(`Recovery stability worsening: CV at ${(baseline.hooper_cv_14d * 100).toFixed(0)}%`);
  }

  if (baseline.avg_deficit_7d != null && Math.abs(baseline.avg_deficit_7d) > 500) {
    alerts.push(`Caloric deficit impacting recovery: ${Math.abs(baseline.avg_deficit_7d).toFixed(0)}kcal avg deficit over 7 days`);
  }

  return { ...baseTrends, alerts };
}
