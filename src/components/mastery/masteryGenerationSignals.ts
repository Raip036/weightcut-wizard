/**
 * masteryGenerationSignals — a tiny client-side store of OPTIMISTIC "the
 * mastery widget is generating something" intents.
 *
 * Why this exists: the wizard loaders (drills / sparring) used to depend on
 * catching a transient backend job marker (`mastery_generation_jobs`) that is
 * created inside an async action. That window races the reactive query and is
 * routinely missed — so the loader never shows and the result "appears out of
 * nowhere".
 *
 * Instead, the trigger that KICKS OFF generation (logging a session with
 * notes, or ticking the last drill) pushes a signal here immediately. The
 * MasterySpine widget merges these optimistic signals with the real backend
 * job markers and a deterministic derivation, all through a minimum-display
 * latch, so the wizard always plays.
 *
 * Signals self-expire via a TTL so a never-arriving job can never leave a
 * stuck loader. The widget also reconciles them against real data (mission /
 * sparring rows appearing) once the minimum-display window has elapsed.
 *
 * Date.now() is used intentionally — this is client app code, not a workflow
 * script, so it's safe here.
 */
import { useSyncExternalStore } from "react";

export type MasteryGenerationKind = "drills" | "sparring";

export interface MasteryGenerationSignal {
  /** Discipline / sport the generation is for (e.g. "Muay Thai"). */
  discipline: string;
  kind: MasteryGenerationKind;
  /** Epoch-ms the signal was pushed. */
  since: number;
}

/** Safety TTL — a signal older than this is dropped even if nothing reconciled
 *  it, so a failed/blocked generation never leaves the loader stuck. Generation
 *  realistically completes well under this. */
const SIGNAL_TTL_MS = 15_000;

let signals: MasteryGenerationSignal[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function prune(now: number) {
  const next = signals.filter((s) => now - s.since < SIGNAL_TTL_MS);
  if (next.length !== signals.length) {
    signals = next;
    return true;
  }
  return false;
}

/**
 * Record an optimistic "generating" intent. Dedupes by discipline+kind,
 * refreshing the timestamp so re-triggers extend the window.
 */
export function pushMasterySignal(
  discipline: string,
  kind: MasteryGenerationKind,
) {
  if (!discipline) return;
  const now = Date.now();
  const key = discipline.toLowerCase();
  const filtered = signals.filter(
    (s) => !(s.discipline.toLowerCase() === key && s.kind === kind),
  );
  signals = [...filtered, { discipline, kind, since: now }];
  prune(now);
  emit();
}

/**
 * Explicitly clear a signal once the widget has reconciled it against real
 * data (e.g. the generated mission / sparring rows appeared and the minimum
 * display window has elapsed).
 */
export function clearMasterySignal(
  discipline: string,
  kind: MasteryGenerationKind,
) {
  const key = discipline.toLowerCase();
  const next = signals.filter(
    (s) => !(s.discipline.toLowerCase() === key && s.kind === kind),
  );
  if (next.length !== signals.length) {
    signals = next;
    emit();
  }
}

function getSnapshot(): MasteryGenerationSignal[] {
  return signals;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Prune on subscribe so a remounted widget never reads stale signals.
  if (prune(Date.now())) emit();
  return () => listeners.delete(listener);
}

/**
 * Reactive hook returning the current (TTL-pruned) optimistic signals. The
 * snapshot is referentially stable until a signal is pushed/cleared, so it's
 * safe to use directly in render / effect deps.
 */
export function useMasterySignals(): MasteryGenerationSignal[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
