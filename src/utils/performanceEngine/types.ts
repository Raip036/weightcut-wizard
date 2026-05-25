// WHOOP-style Deterministic Performance Engine — Types

export interface SleepLog {
  date: string;
  hours: number;
}

export interface SessionRow {
  id: string;
  date: string;
  session_type: string;
  duration_minutes: number;
  rpe: number;
  intensity: string; // legacy 'low' | 'moderate' | 'high'
  intensity_level: number | null; // new 1-5 scale
  soreness_level: number;
  sleep_hours: number;
  user_id: string;
  created_at: string;
  // Rest day fields
  fatigue_level?: number | null;
  sleep_quality?: string | null;
  mobility_done?: boolean | null;
}

export interface OvertrainingRisk {
  score: number; // 0-100
  zone: 'low' | 'moderate' | 'high' | 'critical';
  factors: string[];
}

export interface DailyStrainEntry {
  date: string;
  strain: number;
  dailyLoad: number;
  sessionCount: number;
}

export type LoadZone = 'detraining' | 'optimal' | 'pushing' | 'overreaching';

export interface LoadZoneInfo {
  zone: LoadZone;
  label: string;
  description: string;
}

export interface ForecastResult {
  predictedStrain: number;
  predictedLoadRatio: number;
  predictedLoadZone: LoadZoneInfo;
  predictedOvertrainingScore: number;
  isRestDay: boolean;
}

export type AthleteTier = 'beginner' | 'developing' | 'intermediate' | 'advanced';

export interface AthleteCalibration {
  tier: AthleteTier;
  loadRatioThresholds: { caution: number; danger: number };
  rpeCeiling: number;
  normalSessionsPerWeek: number;
  strainDivisor: number;
  sessionFrequencyFlagThreshold: number;
}

export interface TrendAlerts {
  sorenessRising: boolean;
  sleepDeclining: boolean;
  loadEscalating: boolean;
  rpeCreeping: boolean;
  alerts: string[];
}

export interface ReadinessBreakdown {
  sleepScore: number;
  sorenessScore: number;
  loadBalanceScore: number;
  recoveryScore: number;
  consistencyScore: number;
}

export interface EnhancedReadinessBreakdown extends ReadinessBreakdown {
  wellnessScore?: number;
  priorRecoveryScore?: number;
  deficitImpactScore?: number;
  stabilityScore?: number;
  hydrationScore?: number;
  tier: 1 | 2 | 3;
}

export interface ReadinessResult {
  score: number;
  label: 'peaked' | 'ready' | 'recovering' | 'strained';
  breakdown: EnhancedReadinessBreakdown;
}

// ─── Wellness / Baseline Types ────────────────────────────────

export interface WellnessCheckIn {
  sleep_quality: number;   // 1-7
  stress_level: number;    // 1-7
  fatigue_level: number;   // 1-7
  soreness_level: number;  // 1-7
  energy_level?: number | null;
  motivation_level?: number | null;
  sleep_hours?: number | null;
  hydration_feeling?: number | null;  // 1-5
  appetite_level?: number | null;     // 1-5
  hooper_index: number;    // 4-28
}

export type BalanceDirection = 'improving' | 'stable' | 'declining';
export type BalanceSeverity = 'normal' | 'warning' | 'alert';

export interface BalanceMetric {
  metric: string;
  recent14d: number;
  baseline60d: number;
  zScore: number;
  direction: BalanceDirection;
  severity: BalanceSeverity;
}

export interface PersonalBaseline {
  sleep_hours_mean_14d: number | null;
  sleep_hours_std_14d: number | null;
  soreness_mean_14d: number | null;
  soreness_std_14d: number | null;
  fatigue_mean_14d: number | null;
  fatigue_std_14d: number | null;
  stress_mean_14d: number | null;
  stress_std_14d: number | null;
  hooper_mean_14d: number | null;
  hooper_std_14d: number | null;
  daily_load_mean_14d: number | null;
  daily_load_std_14d: number | null;
  sleep_hours_mean_60d: number | null;
  sleep_hours_std_60d: number | null;
  soreness_mean_60d: number | null;
  soreness_std_60d: number | null;
  fatigue_mean_60d: number | null;
  fatigue_std_60d: number | null;
  stress_mean_60d: number | null;
  stress_std_60d: number | null;
  hooper_mean_60d: number | null;
  hooper_std_60d: number | null;
  daily_load_mean_60d: number | null;
  daily_load_std_60d: number | null;
  hooper_cv_14d: number | null;
  avg_deficit_7d: number | null;
  avg_deficit_14d: number | null;
}

/**
 * How trustworthy is the user's load math right now? ACWR is meaningless
 * without a chronic baseline, so we gate Heavy/Light/Balanced calls on having
 * at least `required` training days in the last 28.
 */
export interface LoadConfidence {
  trainingDaysIn28d: number;
  required: number;          // 14 — sports-science standard
  isReliable: boolean;       // trainingDaysIn28d >= required
}

/**
 * Per-day session summary used by the redesigned weekly card to show
 * "what actually happened" rather than abstract load bars. Each key is
 * an ISO date (YYYY-MM-DD); the value is the list of sessions logged
 * that day (empty array if none).
 *
 * Excludes Rest entries — they're tracked separately on the card's
 * suggestion path, not as "training" sessions.
 */
export interface DailySessionSummary {
  sessionType: string;
  durationMinutes: number;
  rpe: number;
}

/**
 * Roll-up of the current CALENDAR week (Monday → today, inclusive).
 * Distinct from `weeklySessionCount` which is a rolling-7d count.
 */
export interface ThisWeekSummary {
  sessionCount: number;
  totalMinutes: number;
  /** Date keys for every day in the week (Mon..Sun, 7 entries). Days
   *  the user hasn't reached yet still appear with an empty array, so
   *  the UI can render ghost placeholders deterministically. */
  sessionsByDate: Record<string, DailySessionSummary[]>;
  /** ISO date (YYYY-MM-DD) of this week's Monday. */
  weekStart: string;
  /** ISO date (YYYY-MM-DD) of today, in the same timezone as `weekStart`. */
  today: string;
}

/**
 * Previous calendar week (Mon..Sun). Used for the inline delta on the
 * card: e.g. "5 sessions · 4h 20m · ▲ +1 vs last wk".
 */
export interface LastWeekSummary {
  sessionCount: number;
  totalMinutes: number;
}

export interface AllMetrics {
  strain: number;           // Today's 0-21 strain
  dailyLoad: number;        // Today's raw load
  acuteLoad: number;        // Sum of last 7 daily loads
  chronicLoad: number;      // Average of last 28 daily loads
  loadRatio: number;        // acuteLoad / (chronicLoad + 1)
  loadConfidence: LoadConfidence;
  loadZone: LoadZoneInfo;   // User-friendly interpretation
  overtrainingRisk: OvertrainingRisk;
  weeklySessionCount: number;
  thisWeek: ThisWeekSummary;
  lastWeek: LastWeekSummary;
  avgSleep: number;
  latestSleep: number;
  latestSoreness: number;
  avgRPE7d: number;
  avgSoreness7d: number;
  sessionsLast7d: number;
  consecutiveHighDays: number;
  strainHistory: DailyStrainEntry[]; // Last 7 days for chart
  forecast: ForecastResult;
  recentSessions: SessionRow[];
  // Core fields
  readiness: ReadinessResult;
  trends: TrendAlerts;
  calibration: AthleteCalibration;
  sleepScore: number;
  avgSleepLast3: number;
  // Enhanced fields (populated when wellness data available)
  balanceMetrics?: BalanceMetric[];
  deficitImpactScore?: number;
  wellnessScore?: number;
  hooperIndex?: number;
  hooperComponents?: { sleep: number; stress: number; fatigue: number; soreness: number };
  stabilityScore?: number;
}
