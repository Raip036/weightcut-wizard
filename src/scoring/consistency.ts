import type { ScoringConfig } from "./types";

export type FormMomentumInputs = {
  priorRawScores: Array<{ date: string; rawScore: number }>;
  rawScore: number;
  activePillars: number;
  totalPillars: number;
  dataConfidence: number;
  cfg: ScoringConfig;
};

/**
 * Consistency reward. Returns 0..maxBonus points for sustained, fully-logged
 * strong performance. Un-gameable by design: requires every eligible pillar
 * present (can't drop a weak pillar), a strong rawScore TODAY, and a strong
 * MEAN over the recent window (a single good day earns nothing). Scaled by
 * dataConfidence so stale data can't generate a bonus.
 */
export function computeFormMomentum(inputs: FormMomentumInputs): number {
  const { priorRawScores, rawScore, activePillars, totalPillars, dataConfidence, cfg } = inputs;
  const c = cfg.consistency;
  if (priorRawScores.length < c.lookbackDays) return 0;
  if (totalPillars <= 0 || activePillars < totalPillars) return 0;
  if (rawScore <= c.minRawForBonus) return 0;

  const recent = [...priorRawScores]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-c.lookbackDays);
  const mean = recent.reduce((a, s) => a + s.rawScore, 0) / recent.length;

  const span = Math.max(1e-9, c.fullBonusMean - c.minRawForBonus);
  const scaled = Math.min(1, Math.max(0, (mean - c.minRawForBonus) / span));
  return scaled * c.maxBonus * Math.min(1, Math.max(0, dataConfidence));
}
