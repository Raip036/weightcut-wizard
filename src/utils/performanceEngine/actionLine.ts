// src/utils/performanceEngine/actionLine.ts

import type { CampPhase } from './types';

export interface ActionLineInput {
  readinessScore: number;
  campPhase: CampPhase;
  daysSinceLastHardSession: number;  // 0 if today is a hard session, large number if never
  sessionsLast7d: number;
}

/**
 * Generate the action-line copy shown under the readiness verdict.
 * Deterministic lookup over (readiness band × camp phase × recent-load context).
 * No LLM. Designed to be the SINGLE source of "what should I do today".
 */
export function generateActionLine({
  readinessScore,
  campPhase,
  daysSinceLastHardSession,
  sessionsLast7d,
}: ActionLineInput): string {
  // Critical recovery — non-negotiable rest
  if (readinessScore < 35) return 'Full rest. Walk + sauna only.';

  // Recovering — light effort
  if (readinessScore < 55) {
    if (campPhase === 'peak')  return 'Light skill only. Protect peak.';
    if (campPhase === 'taper') return 'Walkthroughs and visualisation only.';
    return 'Z2 60 min + mobility. No contact.';
  }

  // Ready — moderate to hard
  if (readinessScore < 80) {
    if (campPhase === 'peak')  return 'Sharp work. Short rounds, clean reps.';
    if (campPhase === 'taper') return 'Pads + light movement. Keep snappy.';
    if (daysSinceLastHardSession >= 3) return 'Hard session OK. Keep RPE ≤ 8.';
    if (sessionsLast7d >= 5)   return 'Moderate session. Cap rounds at 4.';
    return 'Moderate session. Stay sharp.';
  }

  // Peaked — full effort
  if (campPhase === 'taper') return 'Sharp work only. Short, fast, clean.';
  if (campPhase === 'peak')  return 'Full sparring round. Peak window is open.';
  if (sessionsLast7d <= 2)   return 'Big session day. Make it count.';
  return 'Full sparring + strength.';
}
