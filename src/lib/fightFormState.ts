export type FightFormState = "ok" | "calibrating" | "no_camp" | "paused" | "stale";

/** True when the row carries a real, displayable score (fresh OR stale). */
export function isScoredState(state: FightFormState | string | undefined | null): boolean {
  return state === "ok" || state === "stale";
}

/** Whether the score should be visually de-emphasised (built on stale/thin data). */
export function isStaleState(state: FightFormState | string | undefined | null): boolean {
  return state === "stale";
}
