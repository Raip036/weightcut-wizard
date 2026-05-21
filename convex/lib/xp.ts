/**
 * Per-discipline XP / level math.
 *
 * Used by both Convex queries/mutations (this file is plain TypeScript;
 * no Convex deps) and the frontend (re-exported from `src/lib/xp.ts`).
 *
 * Progression curve: `level = floor(sqrt(totalXp / 50))`, with a floor of
 * 1 so the UI never shows "Lv 0". This gives early users a fast first
 * level (50 XP) and stretches later levels:
 *
 *   Level 1 →    50 XP
 *   Level 2 →   200 XP
 *   Level 3 →   450 XP
 *   Level 5 → 1,250 XP
 *   Level 10 → 5,000 XP
 *
 * Tune-without-migration: levels are derived from `totalXp` on read, so
 * changing this formula doesn't require backfilling any rows.
 */

export interface XpLevelInfo {
  /** 1, 2, 3, … */
  level: number;
  /** Total XP needed to reach `level` (the current level's baseline). */
  currentLevelXp: number;
  /** Total XP needed to reach `level + 1` (the next level's baseline). */
  nextLevelXp: number;
  /** 0..1 fraction of progress toward `nextLevelXp`. */
  progress: number;
}

export function levelFromXp(totalXp: number): XpLevelInfo {
  const safeXp = Math.max(0, Math.floor(totalXp));
  const level = Math.max(1, Math.floor(Math.sqrt(safeXp / 50)));
  const currentLevelXp = 50 * level * level;
  const nextLevelXp = 50 * (level + 1) * (level + 1);
  const span = nextLevelXp - currentLevelXp;
  const progress =
    span <= 0 ? 0 : Math.max(0, Math.min(1, (safeXp - currentLevelXp) / span));
  return { level, currentLevelXp, nextLevelXp, progress };
}
