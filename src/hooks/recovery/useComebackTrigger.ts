// T18: useComebackTrigger — watches the user's readiness over rolling 72h
// and fires a single "Comeback Card ready" toast when the current score
// jumps +20 vs the earliest score logged within the prior 48h.
//
// History storage: per-user AIPersistence key `readiness_history_48h`
// holds an array of `{ ts: number, score: number }` entries. We append on
// every distinct score update, prune to 72h, and use the earliest entry
// within the comeback window as the comparison baseline. AIPersistence
// stores arbitrary JSON so the array shape is fine.
//
// Rate limit: toast fires at most once per ISO week per user, tracked via
// `localStorage[comeback-trigger-ack:${userId}:${YYYY-Wxx}]`. Spec §7.3.b
// requires "at most once per 7 days" — ISO week is a clean approximation
// that aligns with user mental models ("I already shared one this week").
//
// Returns the comeback window the trigger detected so the dashboard can
// hand the same old/new pair to ComebackSheet when the user taps "View".
//
// Spec reference: docs/superpowers/specs/2026-06-01-recovery-page-redesign-design.md
// §7.3.b — "ComebackCard / auto-trigger".
import { useEffect, useRef, useState, createElement } from "react";
import { getISOWeek, getISOWeekYear } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { ToastAction, type ToastActionElement } from "@/components/ui/toast";
import { AIPersistence } from "@/lib/aiPersistence";
import { isRestSession } from "@/lib/sessionTypes";
import { logger } from "@/lib/logger";

export interface ComebackWindow {
  oldDate: Date;
  oldScore: number;
  newDate: Date;
  newScore: number;
}

interface ReadinessHistoryEntry {
  ts: number;
  score: number;
}

const HISTORY_KEY = "readiness_history_48h";
const HISTORY_TTL_HOURS = 72; // matches the prune window so AIPersistence
                              // won't drop the key mid-comparison.
const HISTORY_WINDOW_MS = 72 * 3_600_000;
const COMEBACK_WINDOW_MS = 48 * 3_600_000;
const COMEBACK_THRESHOLD = 20;

// ── ISO-week ack key ─────────────────────────────────────────────────
// "2026-W22" — ISO week year + week number so the gate naturally rolls
// over at week boundaries. Spec wording is "last 7 days"; ISO week is a
// stable bucket that doesn't drift with timezone, which matters because
// localStorage is shared with the device's wall clock.
function weekAckKey(userId: string, today: Date): string {
  const year = getISOWeekYear(today);
  const week = String(getISOWeek(today)).padStart(2, "0");
  return `comeback-trigger-ack:${userId}:${year}-W${week}`;
}

function readWeekAck(userId: string, today: Date): boolean {
  try {
    return localStorage.getItem(weekAckKey(userId, today)) != null;
  } catch {
    return false;
  }
}

function writeWeekAck(userId: string, today: Date): void {
  try {
    localStorage.setItem(weekAckKey(userId, today), String(Date.now()));
  } catch {
    /* localStorage unavailable — fail open; the toast may re-fire next
       relaunch but the alternative is suppressing it forever, which is
       worse UX. */
  }
}

// ── History helpers ──────────────────────────────────────────────────
// Read → prune → maybe-append → persist. All in one function so we never
// half-update the stored array on error.
function recordAndPrune(
  userId: string,
  now: number,
  score: number,
): ReadinessHistoryEntry[] {
  const raw = (AIPersistence.load(userId, HISTORY_KEY) as
    | ReadinessHistoryEntry[]
    | null) ?? [];

  // Defensive cast — if the stored payload has been tampered or shape-
  // mismatched (e.g. an older app version wrote a number), reset rather
  // than throw.
  const safe: ReadinessHistoryEntry[] = Array.isArray(raw)
    ? raw.filter(
        (e): e is ReadinessHistoryEntry =>
          e != null &&
          typeof e === "object" &&
          typeof (e as ReadinessHistoryEntry).ts === "number" &&
          typeof (e as ReadinessHistoryEntry).score === "number",
      )
    : [];

  const cutoff = now - HISTORY_WINDOW_MS;
  const pruned = safe.filter((e) => e.ts >= cutoff);

  // Only append if the latest entry is meaningfully different. Tiny
  // re-renders (engine recomputes that round to the same int) would
  // otherwise bloat the array.
  const latest = pruned[pruned.length - 1];
  const shouldAppend =
    latest == null || Math.round(latest.score) !== Math.round(score);

  const next: ReadinessHistoryEntry[] = shouldAppend
    ? [...pruned, { ts: now, score }]
    : pruned;

  if (shouldAppend || next.length !== safe.length) {
    AIPersistence.save(userId, HISTORY_KEY, next, HISTORY_TTL_HOURS);
  }

  return next;
}

// Find the earliest entry within the comeback window (48h back from now)
// — that's what we compare `currentScore` against to detect a bounce.
function earliestInWindow(
  history: ReadinessHistoryEntry[],
  now: number,
): ReadinessHistoryEntry | null {
  const cutoff = now - COMEBACK_WINDOW_MS;
  let earliest: ReadinessHistoryEntry | null = null;
  for (const e of history) {
    if (e.ts < cutoff) continue;
    if (!earliest || e.ts < earliest.ts) earliest = e;
  }
  return earliest;
}

// ── Protocols-completed math ─────────────────────────────────────────
// Deterministic, no AI. Counts wellness check-ins, rest days, sleep
// entries ≥7h, and mobility sessions inside the comeback window, then
// clamps to 0–10. Uses only the data RecoveryDashboard already has.
//
// Date-based filtering: convert `oldDate`/`newDate` to ISO date strings
// (YYYY-MM-DD) and include rows where `row.date` falls in that span.
// Hours within the boundary days both count — fine because the window
// is always 48h+, never sub-day.
function isoDatesInRange(oldDate: Date, newDate: Date): Set<string> {
  const out = new Set<string>();
  const start = new Date(oldDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(newDate);
  end.setHours(0, 0, 0, 0);
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    out.add(cursor.toISOString().split("T")[0]);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export interface ProtocolsCompletedInput {
  oldDate: Date;
  newDate: Date;
  /** Same shape as RecoveryDashboard's `checkinHistoryRows` (Convex rows). */
  checkinRows: Array<{ date: string }> | null | undefined;
  /** `{ date, hours }` — matches RecoveryDashboard's `sleepLogs`. */
  sleepLogs: Array<{ date: string; hours: number }> | null | undefined;
  /** Same shape as RecoveryDashboard's `sessions28d`. We only read
   *  `date`, `session_type`, and `mobility_done`. */
  sessions28d: Array<{ date: string; session_type?: string; mobility_done?: boolean | null }>;
}

export function computeProtocolsCompleted({
  oldDate,
  newDate,
  checkinRows,
  sleepLogs,
  sessions28d,
}: ProtocolsCompletedInput): number {
  const dates = isoDatesInRange(oldDate, newDate);

  // Wellness check-ins logged in the window, capped at 2.
  const checkins = (checkinRows ?? []).filter((r) => dates.has(r.date)).length;
  const checkinPts = Math.min(2, checkins);

  // Rest days logged in the window. A recovery day now has PRIMARY 'Rest'
  // (Recovery is a tag under the Rest primary), so we detect rest via the
  // primary classifier rather than `=== 'Recovery'`.
  const restDays = sessions28d.filter(
    (s) => dates.has(s.date) && isRestSession(s.session_type),
  ).length;

  // Sleep entries with ≥7h in the window, capped at 2.
  const goodSleep = (sleepLogs ?? []).filter(
    (l) => dates.has(l.date) && l.hours >= 7,
  ).length;
  const sleepPts = Math.min(2, goodSleep);

  // Mobility sessions logged in the window. `mobility_done` is a boolean
  // on the session row; rest-day rows can carry it too.
  const mobility = sessions28d.filter(
    (s) => dates.has(s.date) && s.mobility_done === true,
  ).length;

  const total = checkinPts + restDays + sleepPts + mobility;
  return Math.max(0, Math.min(10, total));
}

// ── Hook ──────────────────────────────────────────────────────────────
export interface UseComebackTriggerOptions {
  userId: string | null;
  /** Latest readiness score (0..100). Pass `null` while metrics are still
   *  loading so we don't append nulls to history. */
  currentScore: number | null;
  /** Called when the user taps "View" on the toast. The trigger window
   *  is also exposed via `triggeredWindow` for the caller to pass into
   *  ComebackSheet. */
  onView?: () => void;
}

export function useComebackTrigger({
  userId,
  currentScore,
  onView,
}: UseComebackTriggerOptions): { triggeredWindow: ComebackWindow | null } {
  // Track the window we most recently detected so the consumer can open
  // the sheet with the exact same old/new pair the toast referenced.
  const [triggeredWindow, setTriggeredWindow] = useState<ComebackWindow | null>(null);

  // Latest callback ref so the effect closure stays current without
  // re-firing when the parent rebinds `onView`.
  const onViewRef = useRef(onView);
  useEffect(() => {
    onViewRef.current = onView;
  }, [onView]);

  // Per-mount guard so a single score update doesn't fire the toast
  // twice (StrictMode double-invoke, race with metric recompute, etc.).
  // Re-checked against the localStorage ack on every effect run so the
  // gate still holds across remounts.
  const firedThisMountRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    if (currentScore == null || !Number.isFinite(currentScore)) return;

    try {
      const now = Date.now();
      const history = recordAndPrune(userId, now, currentScore);

      // Need at least one prior entry within 48h to detect a bounce.
      const earliest = earliestInWindow(history, now);
      if (!earliest) return;
      // Don't compare against the same entry we just appended.
      if (earliest.ts === now) return;

      const delta = currentScore - earliest.score;
      if (delta < COMEBACK_THRESHOLD) return;

      const today = new Date(now);

      // Rate-limit: at most once per ISO week per user.
      if (readWeekAck(userId, today)) return;
      if (firedThisMountRef.current) return;

      const window: ComebackWindow = {
        oldDate: new Date(earliest.ts),
        oldScore: earliest.score,
        newDate: today,
        newScore: currentScore,
      };

      setTriggeredWindow(window);
      writeWeekAck(userId, today);
      firedThisMountRef.current = true;

      toast({
        title: "Comeback Card ready",
        description: `+${Math.round(delta)} readiness in 48h. Share the bounce.`,
        duration: 10_000,
        action: createElement(
          ToastAction,
          {
            altText: "View",
            onClick: () => onViewRef.current?.(),
          },
          "View",
        ) as unknown as ToastActionElement,
      });
    } catch (err) {
      // Fail open — never let a comeback-trigger bug break the dashboard.
      logger.warn("useComebackTrigger: failed to evaluate", { err });
    }
  }, [userId, currentScore]);

  return { triggeredWindow };
}
