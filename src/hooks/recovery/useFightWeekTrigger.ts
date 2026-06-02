// T19: useFightWeekTrigger — fires a single "Fight week — Form card ready"
// toast 7 days before the user's logged fight date. Idempotent per camp:
// the ack is keyed on `${userId}:${fightDateIso}` so a second camp on the
// same userId still gets its own toast, but the same camp can't re-toast
// after a relaunch.
//
// The dashboard owns the data; this hook is purely the trigger. When the
// user taps "View" on the toast the dashboard opens FightWeekFormSheet
// with the same fight date the toast referenced.
//
// Spec reference: docs/superpowers/specs/2026-06-01-recovery-page-redesign-design.md
// §7.3.c — "FightWeekFormCard / auto-trigger".
import { useEffect, useRef, createElement } from "react";
import { toast } from "@/hooks/use-toast";
import { ToastAction, type ToastActionElement } from "@/components/ui/toast";
import { logger } from "@/lib/logger";

const TRIGGER_DAYS_OUT = 7;

// localStorage ack key — per-user + per-fight so account switching on one
// device, or a user editing their fight date, still produces a fresh
// toast. Spec calls for "once per camp", and a fight-date change is
// effectively a new camp from the user's perspective.
function ackKey(userId: string, fightDateIso: string): string {
  return `fight-week-card-ack:${userId}:${fightDateIso}`;
}

function readAck(userId: string, fightDateIso: string): boolean {
  try {
    return localStorage.getItem(ackKey(userId, fightDateIso)) != null;
  } catch {
    return false;
  }
}

function writeAck(userId: string, fightDateIso: string): void {
  try {
    localStorage.setItem(ackKey(userId, fightDateIso), String(Date.now()));
  } catch {
    /* localStorage unavailable — fail open. The toast may re-fire next
       relaunch, but suppressing it forever is worse UX than the rare
       duplicate. Same fallback policy as useComebackTrigger. */
  }
}

// ── Hook ──────────────────────────────────────────────────────────────
export interface UseFightWeekTriggerOptions {
  /** Auth'd user id. Null while loading; the hook short-circuits. */
  userId: string | null;
  /** Days until the fight, computed by the dashboard from the active
   *  camp's `fightDate` (same shape as T12). Null when no active camp
   *  exists or it's completed — short-circuits. */
  daysToFight: number | null;
  /** ISO YYYY-MM-DD of the fight. Used to key the idempotency ack so
   *  the same camp can't re-toast across relaunches. Null when no
   *  active camp exists. */
  fightDateIso: string | null;
  /** Called when the user taps "View" on the toast. */
  onView?: () => void;
}

export interface UseFightWeekTriggerResult {
  /** True once the trigger has fired this mount; consumers can use this
   *  for diagnostics. Also true if the toast has previously fired for
   *  this camp on this device (read from localStorage). */
  ready: boolean;
  /** Echoes the fight date back so the consumer can hand it to the sheet
   *  alongside `daysToFight`. */
  fightDateIso: string | null;
}

export function useFightWeekTrigger({
  userId,
  daysToFight,
  fightDateIso,
  onView,
}: UseFightWeekTriggerOptions): UseFightWeekTriggerResult {
  // Latest callback ref so the effect closure stays current without
  // re-firing when the parent rebinds `onView`. Same pattern as
  // useComebackTrigger.
  const onViewRef = useRef(onView);
  useEffect(() => {
    onViewRef.current = onView;
  }, [onView]);

  // Per-mount guard so a single render pass doesn't fire the toast twice
  // (StrictMode double-invoke, daysToFight transient recompute, etc.).
  const firedThisMountRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    if (!fightDateIso) return;
    if (daysToFight !== TRIGGER_DAYS_OUT) return;

    try {
      // Per-camp ack guard — only fire once per camp across relaunches.
      if (readAck(userId, fightDateIso)) return;
      if (firedThisMountRef.current) return;

      writeAck(userId, fightDateIso);
      firedThisMountRef.current = true;

      toast({
        title: "Fight week — Form card ready",
        description: "7 days out. Share your peaking curve.",
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
      // Fail open — never let a trigger bug break the dashboard.
      logger.warn("useFightWeekTrigger: failed to fire", { err });
    }
  }, [userId, daysToFight, fightDateIso]);

  const ready =
    firedThisMountRef.current ||
    (userId != null && fightDateIso != null && readAck(userId, fightDateIso));

  return { ready, fightDateIso };
}
