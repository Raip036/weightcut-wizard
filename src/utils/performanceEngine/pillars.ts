// src/utils/performanceEngine/pillars.ts

import { clamp } from './helpers';
import type { EnhancedReadinessBreakdown, LoadConfidence, PillarScores } from './types';

export type { PillarScores } from './types';

/**
 * Derive 3 display pillars from the existing readiness breakdown.
 * The hero readiness score is unchanged — pillars are summary views, not the
 * source of truth.
 *
 * Pillar nulling rules:
 * - body: null if there's no wellnessScore (Tier 1 — no check-in yet)
 * - load: null if loadConfidence is unreliable (under 14 training days in 28d)
 * - recovery: always returns a number (degrades gracefully)
 */
export function derivePillars(
  breakdown: EnhancedReadinessBreakdown,
  loadConfidence: LoadConfidence,
): PillarScores {
  const recovery = clamp(0, 100,
      0.55 * breakdown.sleepScore
    + 0.25 * breakdown.recoveryScore
    + 0.12 * (breakdown.hydrationScore ?? 50)
    + 0.08 * (breakdown.priorRecoveryScore ?? 50)
  );

  const body = breakdown.wellnessScore != null
    ? clamp(0, 100,
          0.60 * breakdown.wellnessScore
        + 0.35 * breakdown.sorenessScore
        + 0.05 * (breakdown.stabilityScore ?? 50)
      )
    : null;

  const load = loadConfidence.isReliable
    ? clamp(0, 100,
        breakdown.loadBalanceScore * (0.85 + 0.15 * ((breakdown.deficitImpactScore ?? 100) / 100))
      )
    : null;

  return { recovery, body, load };
}
