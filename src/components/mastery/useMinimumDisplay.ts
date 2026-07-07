// useMinimumDisplay: latch wizard-aurora generation loaders so each
// (discipline, kind) stays visible for a brief minimum after it first appears,
// even if the underlying job clears instantly (cached / fast generation). This
// guarantees the loader animation always plays through rather than flashing-
// and-vanishing. Self-contained; no timers leak (cleared on unmount).
import { useEffect, useMemo, useRef, useState } from "react";

/** One in-flight generation job surfaced by `getGenerationStatus`. */
export type GenerationJob = { discipline: string; kind: "drills" | "sparring" };

/** Minimum time (ms) a "drills" loader stays visible once it first appears for
 *  a given discipline+kind, even if the underlying job has already cleared. */
export const LOADER_MIN_DISPLAY_MS = 2500;

/** Minimum time (ms) a "sparring" loader stays visible. Longer than the drills
 *  floor so graduation (final drill tick -> sparring generation) always plays
 *  as one continuous ~3s process, even when sparring is already generated and
 *  the reveal would otherwise be instant. */
export const SPARRING_LOADER_MIN_DISPLAY_MS = 3000;

/** Default per-kind minimum-display floor. */
const DEFAULT_MIN_DISPLAY_BY_KIND: Record<"drills" | "sparring", number> = {
  drills: LOADER_MIN_DISPLAY_MS,
  sparring: SPARRING_LOADER_MIN_DISPLAY_MS,
};

/**
 * Per-kind minimum-display override: a partial map or a function returning the
 * floor (ms) for a given job kind. Lets callers vary the floor per kind (e.g.
 * shorten the sparring window under reduced motion). Missing kinds fall back to
 * the defaults above.
 */
export type LoaderMinDisplay =
  | Partial<Record<"drills" | "sparring", number>>
  | ((kind: "drills" | "sparring") => number);

function makeKey(discipline: string, kind: "drills" | "sparring"): string {
  return `${discipline.toLowerCase()}|${kind}`;
}

export interface MinimumDisplay {
  /** True while a loader for (discipline, kind) is active OR still inside its
   *  minimum-display window. */
  has: (discipline: string, kind: "drills" | "sparring") => boolean;
  /** Held jobs (active OR within min-display window), original-cased
   *  discipline + kind. Drive standalone loader lists from this so a held-but-
   *  cleared job still renders for its full minimum window. */
  jobs: GenerationJob[];
}

/**
 * Latch generating jobs so each (discipline, kind) stays "on" for at least
 * `LOADER_MIN_DISPLAY_MS` after it first appears, even once the real job has
 * cleared from `getGenerationStatus`.
 *
 * A re-render is scheduled when a held key's minimum window elapses so the
 * loader can retract on its own without any further job tick.
 */
export function useMinimumDisplay(
  jobs: GenerationJob[],
  minDisplay?: LoaderMinDisplay,
): MinimumDisplay {
  // Per-key state: first-seen timestamp + the original-cased job (so a held-
  // but-cleared loader can still be listed for its full window). Persists
  // across renders; pruned once the window elapses AND the job is gone.
  const seenRef = useRef<Map<string, { seenAt: number; job: GenerationJob }>>(
    new Map(),
  );
  // Bump to force a re-render when a held window expires.
  const [, force] = useState(0);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const activeKeys = useMemo(
    () => new Set(jobs.map((j) => makeKey(j.discipline, j.kind))),
    [jobs],
  );

  const now = Date.now();
  const seen = seenRef.current;

  // Resolve the per-kind minimum-display floor (caller override or default).
  const floorFor = (kind: "drills" | "sparring"): number => {
    if (typeof minDisplay === "function") return minDisplay(kind);
    return minDisplay?.[kind] ?? DEFAULT_MIN_DISPLAY_BY_KIND[kind];
  };

  // Record first-seen for any newly-active key (keep the original-cased job).
  for (const job of jobs) {
    const key = makeKey(job.discipline, job.kind);
    if (!seen.has(key)) seen.set(key, { seenAt: now, job });
  }

  // Compute which keys are currently held (active OR within min-display window).
  const held = new Set<string>();
  const heldJobs: GenerationJob[] = [];
  for (const [key, { seenAt, job }] of seen) {
    const minMs = floorFor(job.kind);
    const withinWindow = now - seenAt < minMs;
    if (activeKeys.has(key) || withinWindow) {
      held.add(key);
      heldJobs.push(job);
      // Schedule a re-render when this key's window expires so a held-but-
      // cleared loader can retract on its own (no further job tick needed).
      if (!activeKeys.has(key) && withinWindow && !timersRef.current.has(key)) {
        const delay = minMs - (now - seenAt);
        const t = setTimeout(() => {
          timersRef.current.delete(key);
          force((n) => n + 1);
        }, delay);
        timersRef.current.set(key, t);
      }
    } else {
      // Window elapsed and job gone → forget so a future run latches fresh.
      seen.delete(key);
    }
  }

  // Clear timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  return {
    has: (discipline, kind) => held.has(makeKey(discipline, kind)),
    jobs: heldJobs,
  };
}

// ─── Deterministic cycle-complete detection ──────────────────────────────────

/** Per-discipline count of graduated, not-yet-mastered sparring assignments. */
export type GraduatedCounts = Record<string, number>;

/** One discipline whose cycle just completed (its un-mastered graduated count
 *  fell from >0 to 0 this render). Carries an XP figure for the cutscene. */
export interface CycleCompletion {
  discipline: string;
  xp: number;
}

/** XP awarded per graduated technique (3 lands × 15 XP each). */
const XP_PER_GRADUATED_TECHNIQUE = 3 * 15;
/** Flat bonus for completing a whole discipline cycle. */
const CYCLE_BONUS_XP = 50;

/**
 * Deterministic cycle-complete detector.
 *
 * Pass the CURRENT per-discipline count of graduated, un-mastered sparring
 * assignments (derived from `getMasteryFlow`). When a discipline's count
 * transitions from >0 (previous render) to 0 — i.e. its last graduated
 * assignment just got mastered — this returns a `CycleCompletion` for it ONCE.
 *
 * Double-fire is guarded by an internal already-celebrated Set, shared with the
 * imperative path via `markCelebrated` / `isCelebrated` so the legacy
 * `onCycleComplete` callback and this deterministic detection can't both fire.
 *
 * The detector is render-pure (no effects): it reads/writes refs during render
 * and returns the newly-completed disciplines. Callers should fire at most one
 * cutscene at a time (the spine shows them serially).
 */
export interface CycleDetector {
  /** Disciplines whose cycle completed since the last call (deduped). */
  completions: CycleCompletion[];
  /** True if a discipline has already had its cutscene fired this session. */
  isCelebrated: (discipline: string) => boolean;
  /** Mark a discipline celebrated (call from the imperative callback path too). */
  markCelebrated: (discipline: string) => void;
}

/** Mutable state of the cycle detector, held across renders (in the hook, via a
 *  ref). Exported so the transition logic can be unit-tested without a React
 *  renderer. */
export interface CycleDetectorState {
  prevCounts: GraduatedCounts;
  celebrated: Set<string>;
  resetKey: string | number | null | undefined;
  awaitingBaseline: boolean;
}

/** Fresh detector state. `awaitingBaseline` starts true so the first stable
 *  step seeds the baseline from real data instead of comparing against {}. */
export function createCycleDetectorState(
  resetKey?: string | number | null,
): CycleDetectorState {
  return { prevCounts: {}, celebrated: new Set(), resetKey, awaitingBaseline: true };
}

/**
 * PURE step of the cycle-completion detector. Mutates `state` in place (matching
 * the hook's ref-based render model) and returns the disciplines whose cycle
 * just completed this step (an un-mastered graduated count going >0 -> 0).
 *
 * Camp-scope + stability rules (this is the regression fix):
 * - When `resetKey` changes (the active camp switched), clear the celebrated Set
 *   and mark that we await a fresh baseline. Do NOT baseline yet: `counts` is
 *   derived from a latched flow still holding the OLD camp's counts during the
 *   switch blip, so reseeding here would capture stale counts and false-fire
 *   when the new camp's counts land.
 * - While `!stable` (a query blip; `counts` = latched/old data), emit nothing and
 *   do not move the baseline. Detection resumes on the next stable step.
 * - The first stable step after mount or a camp switch seeds the baseline from
 *   the settled counts and emits nothing (it is the baseline, not a transition).
 */
export function stepCycleDetection(
  state: CycleDetectorState,
  counts: GraduatedCounts,
  resetKey: string | number | null | undefined,
  stable: boolean,
): CycleCompletion[] {
  if (state.resetKey !== resetKey) {
    state.resetKey = resetKey;
    state.celebrated = new Set();
    state.awaitingBaseline = true;
  }

  const completions: CycleCompletion[] = [];
  if (!stable) return completions;

  if (state.awaitingBaseline) {
    state.awaitingBaseline = false;
    state.prevCounts = { ...counts };
    return completions;
  }

  const prev = state.prevCounts;
  for (const [discipline, prevCount] of Object.entries(prev)) {
    const current = counts[discipline] ?? 0;
    if (prevCount > 0 && current === 0 && !state.celebrated.has(discipline)) {
      state.celebrated.add(discipline);
      const xp = prevCount * XP_PER_GRADUATED_TECHNIQUE + CYCLE_BONUS_XP;
      completions.push({ discipline, xp });
    }
  }

  // Re-entry: a discipline that gets a new graduated batch after its trophy was
  // shown clears its celebrated guard, so a future cycle can celebrate again.
  for (const [discipline, current] of Object.entries(counts)) {
    if (current > 0 && (prev[discipline] ?? 0) === 0) {
      state.celebrated.delete(discipline);
    }
  }

  state.prevCounts = { ...counts };
  return completions;
}

export function useCycleCompletionDetector(
  counts: GraduatedCounts,
  resetKey?: string | number | null,
  stable: boolean = true,
): CycleDetector {
  const stateRef = useRef<CycleDetectorState | null>(null);
  if (stateRef.current === null) stateRef.current = createCycleDetectorState(resetKey);
  const state = stateRef.current;

  const completions = stepCycleDetection(state, counts, resetKey, stable);

  return {
    completions,
    isCelebrated: (discipline) => state.celebrated.has(discipline),
    markCelebrated: (discipline) => state.celebrated.add(discipline),
  };
}
