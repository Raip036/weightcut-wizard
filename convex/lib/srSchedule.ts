/**
 * Leitner-style spaced repetition scheduler — intentionally simpler than
 * SM-2 / Anki for v1 of the Training Summary flashcards.
 *
 * Rules:
 *   - new card                 → intervalDays = 1, due tomorrow
 *   - recall = "got"           → intervalDays = min(prev * 2, MAX), due in N days
 *   - recall = "forgot"        → intervalDays = 1, due tomorrow, lapses += 1
 *
 * The frontend mirror lives at `src/lib/srSchedule.ts` (same logic,
 * duplicated to avoid a `convex/`→`src/` import dependency).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_INTERVAL_DAYS = 30;

export interface SrState {
  intervalDays: number;
  lapses: number;
}

export interface SrUpdate {
  intervalDays: number;
  dueAt: number;
  lapses: number;
  lastReviewedAt: number;
}

export function scheduleNext(prev: SrState, recall: "got" | "forgot"): SrUpdate {
  const now = Date.now();
  if (recall === "forgot") {
    return {
      intervalDays: 1,
      dueAt: now + DAY_MS,
      lapses: prev.lapses + 1,
      lastReviewedAt: now,
    };
  }
  const next = Math.min(Math.max(1, prev.intervalDays) * 2, MAX_INTERVAL_DAYS);
  return {
    intervalDays: next,
    dueAt: now + next * DAY_MS,
    lapses: prev.lapses,
    lastReviewedAt: now,
  };
}

export function initialState(now: number = Date.now()): SrUpdate {
  return {
    intervalDays: 1,
    dueAt: now + DAY_MS,
    lapses: 0,
    lastReviewedAt: now,
  };
}
