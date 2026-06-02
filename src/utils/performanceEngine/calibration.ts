import type { AthleteTier, AthleteCalibration, CampPhase, SessionRow } from "./types";
import { clamp } from "./helpers";
import { sessionLoad } from "./load";
import { isRestSession } from "@/lib/sessionTypes";

export type { CampPhase } from "./types";

/**
 * Map days-to-fight to a camp phase.
 * - off-camp: > 28 days out (or no fight scheduled)
 * - build:    15-28 days out
 * - peak:     8-14 days out  (load is supposed to spike — loosen thresholds)
 * - taper:    0-7 days out   (load should taper — flag under-loading)
 */
export function determineCampPhase(daysToFight: number | null): CampPhase {
  if (daysToFight == null || daysToFight > 28) return 'off-camp';
  if (daysToFight > 14) return 'build';
  if (daysToFight > 7) return 'peak';
  return 'taper';
}

/**
 * Apply camp-phase-specific shifts to the ACWR thresholds in a calibration.
 * Returns a NEW calibration object (immutable). Also stamps `phase` on the
 * returned calibration so downstream consumers (e.g. UI relabeling) can
 * tell which phase the math was tuned for.
 */
export function applyCampPhaseToCalibration(
  calibration: AthleteCalibration,
  phase: CampPhase,
): AthleteCalibration {
  const t = calibration.loadRatioThresholds;
  switch (phase) {
    case 'build':
      return {
        ...calibration,
        loadRatioThresholds: { caution: t.caution - 0.05, danger: t.danger - 0.05 },
        phase,
      };
    case 'peak':
      return {
        ...calibration,
        loadRatioThresholds: { caution: t.caution + 0.15, danger: t.danger + 0.10 },
        phase,
      };
    case 'taper':
      return {
        ...calibration,
        loadRatioThresholds: { caution: t.caution + 0.20, danger: t.danger + 0.20 },
        phase,
      };
    default:
      return { ...calibration, phase };
  }
}

const TIER_DEFAULTS: Record<AthleteTier, Omit<AthleteCalibration, 'tier'>> = {
  advanced: {
    loadRatioThresholds: { caution: 1.4, danger: 1.6 },
    rpeCeiling: 8,
    normalSessionsPerWeek: 6,
    strainDivisor: 1400,
    sessionFrequencyFlagThreshold: 8,
  },
  intermediate: {
    loadRatioThresholds: { caution: 1.3, danger: 1.5 },
    rpeCeiling: 7,
    normalSessionsPerWeek: 4,
    strainDivisor: 1100,
    sessionFrequencyFlagThreshold: 6,
  },
  developing: {
    loadRatioThresholds: { caution: 1.2, danger: 1.4 },
    rpeCeiling: 7,
    normalSessionsPerWeek: 3,
    strainDivisor: 900,
    sessionFrequencyFlagThreshold: 4,
  },
  beginner: {
    // Beginners log infrequently; tight thresholds caused false 'Heavy week'
    // calls from the very first session. Per sports-science recommendations
    // for newer trainees we widen the spike window; the absolute-load floor
    // applied in computeAdaptiveOvertrainingScore prevents tiny absolute
    // loads from tripping a warning even when ratios look high.
    loadRatioThresholds: { caution: 1.5, danger: 1.8 },
    rpeCeiling: 6,
    normalSessionsPerWeek: 1,
    strainDivisor: 700,
    sessionFrequencyFlagThreshold: 3,
  },
};

function determineTier(profileFreq: number | null, activityLevel: string | null): AthleteTier {
  const f = profileFreq ?? 0;
  if (f >= 6 || activityLevel === 'extra_active') return 'advanced';
  if (f >= 4 || activityLevel === 'very_active') return 'intermediate';
  if (f >= 2 || activityLevel === 'moderately_active') return 'developing';
  return 'beginner';
}

export function deriveCalibration(
  profileFreq: number | null,
  activityLevel: string | null,
  sessions28d: SessionRow[],
  daysToFight: number | null = null,
): AthleteCalibration {
  const tier = determineTier(profileFreq, activityLevel);
  const defaults = TIER_DEFAULTS[tier];
  const calibration: AthleteCalibration = { tier, ...defaults };

  const trainingSessions = sessions28d.filter(s => !isRestSession(s.session_type));
  const uniqueTrainingDays = new Set(trainingSessions.map(s => s.date)).size;

  if (uniqueTrainingDays >= 7) {
    const avgRPE = trainingSessions.reduce((sum, s) => sum + s.rpe, 0) / trainingSessions.length;
    calibration.rpeCeiling = clamp(4, 10, avgRPE + 1.5);

    calibration.normalSessionsPerWeek = Math.round((uniqueTrainingDays / 4) * 10) / 10;

    const avgSessionLoad = trainingSessions.reduce((sum, s) => sum + sessionLoad(s), 0) / trainingSessions.length;
    const targetStrain = 8.5;
    const ratio = 1 - targetStrain / 21;
    if (ratio > 0 && avgSessionLoad > 0) {
      calibration.strainDivisor = clamp(400, 2500, -avgSessionLoad / Math.log(ratio));
    }

    calibration.sessionFrequencyFlagThreshold = Math.ceil(calibration.normalSessionsPerWeek + 2);
  }

  // Apply camp-phase shift at the end so the planned-peaking band of an
  // ACWR spike doesn't trip false Red zone alarms. When `daysToFight` is
  // null this resolves to 'off-camp' and leaves thresholds untouched.
  const phase = determineCampPhase(daysToFight);
  return applyCampPhaseToCalibration(calibration, phase);
}
