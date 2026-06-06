/**
 * Rest-timer plumbing for the active workout.
 *
 * Two concerns, kept out of the React tree so any set row can trigger a rest
 * countdown without prop-drilling through ExerciseBlock → ActiveSessionView:
 *
 *   1. A tiny module bus — `RestTimerPill` registers a `start(seconds)`
 *      function; a completed set calls `startRest(...)`.
 *   2. Persisted, user-customizable durations — a global default plus an
 *      optional per-exercise override (both in localStorage, no schema).
 */

const DEFAULT_KEY = "wcw:gym:restDefault";
const PER_EX_KEY = "wcw:gym:restByExercise";

export const DEFAULT_REST_SECONDS = 90;
export const REST_PRESETS = [60, 90, 120, 150, 180, 240] as const;

export function getDefaultRest(): number {
  try {
    const v = parseInt(localStorage.getItem(DEFAULT_KEY) ?? "", 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_REST_SECONDS;
  } catch {
    return DEFAULT_REST_SECONDS;
  }
}

export function setDefaultRest(seconds: number): void {
  try {
    localStorage.setItem(DEFAULT_KEY, String(seconds));
  } catch {
    /* ignore */
  }
}

function readPerExercise(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PER_EX_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Resolved rest for an exercise: its override if set, else the global default. */
export function getRestForExercise(exerciseId?: string | null): number {
  if (exerciseId) {
    const map = readPerExercise();
    const v = map[exerciseId];
    if (Number.isFinite(v) && v > 0) return v;
  }
  return getDefaultRest();
}

export function setRestForExercise(exerciseId: string, seconds: number): void {
  try {
    const map = readPerExercise();
    map[exerciseId] = seconds;
    localStorage.setItem(PER_EX_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

type StartFn = (seconds: number) => void;
let starter: StartFn | null = null;

export function registerRestStarter(fn: StartFn | null): void {
  starter = fn;
}

/** Fire-and-forget — no-op if no RestTimerPill is mounted. */
export function startRest(seconds: number): void {
  starter?.(seconds);
}
