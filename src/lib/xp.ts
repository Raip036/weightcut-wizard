/**
 * Frontend mirror of `convex/lib/xp.ts`. Same source, copied to avoid a
 * `convex/`-from-`src/` import dependency. Keep the two files in sync —
 * if you change the formula, change BOTH.
 */

export interface XpLevelInfo {
  level: number;
  currentLevelXp: number;
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
