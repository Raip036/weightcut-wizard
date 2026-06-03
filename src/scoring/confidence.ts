/**
 * Per-pillar completeness from staleness: 1 when fresh (staleDays 0), ramping
 * linearly down to 0 at `horizonDays`. `null` staleDays (never logged) → 0.
 */
export function completenessFor(
  staleDays: number | null,
  cfg: { horizonDays: number },
): number {
  if (staleDays === null) return 0;
  return Math.min(1, Math.max(0, 1 - staleDays / cfg.horizonDays));
}

/** Weight-weighted mean of completeness over PRESENT (weight>0) pillars. */
export function rollUpConfidence(
  pillars: Array<{ weight: number; completeness: number }>,
): number {
  const present = pillars.filter((p) => p.weight > 0);
  const total = present.reduce((a, p) => a + p.weight, 0);
  if (total <= 0) return 0;
  return present.reduce((a, p) => a + p.completeness * p.weight, 0) / total;
}
