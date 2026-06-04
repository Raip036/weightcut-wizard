import { useCallback, useEffect, useState } from "react";

import { AIPersistence } from "@/lib/aiPersistence";

/**
 * Local-only daily check-in streak for the Fight Camp coach (Phase 2).
 *
 * Talking to the coach (or tapping the check-in card) counts as today's
 * check-in. State is persisted per user via {@link AIPersistence} — same
 * localStorage layer the coach already uses — so no backend/schema changes.
 *
 * Streak math (all using *local* calendar days, not UTC):
 *   - same day        → no change (idempotent; safe to call on every message)
 *   - consecutive day  → streak + 1
 *   - gap > 1 day      → streak reset to 1 (fresh streak starting today)
 *   - never checked in  → streak becomes 1
 */

const STREAK_TYPE = "coach_checkin_streak";
// Far-future expiry so the streak isn't silently wiped by cache TTL. AIPersistence
// stores expiresAt = now + hours; 10 years keeps it effectively permanent while
// still flowing through the same LRU-bounded keyspace.
const TEN_YEARS_HOURS = 10 * 365 * 24;

interface StreakRecord {
  /** Last check-in date as a local "YYYY-MM-DD" string. */
  lastCheckinDate: string;
  /** Consecutive-day count including the last check-in date. */
  streak: number;
}

/** Local (not UTC) date as "YYYY-MM-DD". */
function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole-day difference between two local date keys (b - a). */
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const aMs = new Date(ay, am - 1, ad).getTime();
  const bMs = new Date(by, bm - 1, bd).getTime();
  return Math.round((bMs - aMs) / (24 * 60 * 60 * 1000));
}

function loadRecord(userId: string): StreakRecord | null {
  const raw = AIPersistence.load(userId, STREAK_TYPE) as StreakRecord | null;
  if (!raw || typeof raw.streak !== "number" || typeof raw.lastCheckinDate !== "string") {
    return null;
  }
  return raw;
}

/** Derive the *displayed* streak: if the last check-in is stale (>1 day old),
 *  the streak is effectively broken and should read 0 until the next check-in. */
function effectiveStreak(record: StreakRecord | null, today: string): number {
  if (!record) return 0;
  const gap = dayDiff(record.lastCheckinDate, today);
  if (gap <= 0) return record.streak; // today (or clock skew) — keep as-is
  if (gap === 1) return record.streak; // yesterday — streak still alive, not yet bumped
  return 0; // gap > 1 — streak broken
}

export function useCoachCheckinStreak(userId: string | null | undefined): {
  streak: number;
  checkedInToday: boolean;
  recordCheckin: () => void;
} {
  const [record, setRecord] = useState<StreakRecord | null>(null);

  useEffect(() => {
    if (!userId) {
      setRecord(null);
      return;
    }
    setRecord(loadRecord(userId));
  }, [userId]);

  const recordCheckin = useCallback(() => {
    if (!userId) return;
    const today = localDateKey();
    setRecord((prev) => {
      const current = prev ?? loadRecord(userId);
      let nextStreak: number;
      if (!current) {
        nextStreak = 1;
      } else {
        const gap = dayDiff(current.lastCheckinDate, today);
        if (gap <= 0) {
          nextStreak = current.streak; // already checked in today — idempotent
        } else if (gap === 1) {
          nextStreak = current.streak + 1; // consecutive day
        } else {
          nextStreak = 1; // gap > 1 — reset
        }
      }
      const next: StreakRecord = { lastCheckinDate: today, streak: nextStreak };
      AIPersistence.save(userId, STREAK_TYPE, next, TEN_YEARS_HOURS);
      return next;
    });
  }, [userId]);

  const today = localDateKey();
  const checkedInToday = record?.lastCheckinDate === today;
  const streak = effectiveStreak(record, today);

  return { streak, checkedInToday, recordCheckin };
}
