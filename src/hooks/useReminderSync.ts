/**
 * useReminderSync — keeps the adaptive local-notification reminders alive
 * beyond the one-shot onboarding schedule.
 *
 * Three jobs, all native-only (no-op on web):
 *   1. Re-sync the reminder plan on cold start and on every foreground resume
 *      (Capacitor `appStateChange` → isActive), passing today's real
 *      suppression state so an already-logged morning weigh-in is suppressed
 *      and tomorrow's stays scheduled. Foreground re-syncs are throttled so
 *      rapid app-switching doesn't reschedule constantly.
 *   2. Handle a notification tap (`localNotificationActionPerformed`) →
 *      deep-link to the notification's `extra.route` (fallback `/weight`) and
 *      fire the REMINDER_TAPPED analytics event.
 *
 * It NEVER requests permission — onboarding's ReminderStep owns the prompt.
 * `resyncReminders` self-guards on the opt-in flag + granted OS permission, so
 * this hook only supplies the "logged today" signal + throttling + tap routing.
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useConvex } from "convex/react";
import { format } from "date-fns";
import { App as CapacitorApp } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import { isNativePlatform } from "@/hooks/useIsNative";
import {
  remindersEnabled,
  setRemindersEnabled,
  resyncReminders,
} from "@/lib/reminderScheduler";
import type { ClockTime, ReminderPillar } from "@/lib/reminderSchedule";
import { track, EVENTS } from "@/lib/analytics";
import { logger } from "@/lib/logger";
import { api } from "../../convex/_generated/api";

/** Don't re-sync more than once per 30 min on foreground resume. */
const FOREGROUND_THROTTLE_MS = 30 * 60 * 1000;

/**
 * `loggingTimeStats` derives its median hour/minute from row `_creationTime`
 * in UTC. Reminders schedule against the DEVICE-LOCAL clock, so shift the UTC
 * time back to local using the device's current offset. `getTimezoneOffset()`
 * returns (UTC − local) in minutes, so local = utc − offset (wrapped to 24h).
 * A single current-offset shift is a fine heuristic for a reminder anchor; it
 * doesn't try to be DST-exact per historical row.
 */
function utcClockToLocal(t: { hour: number; minute: number } | null): ClockTime | null {
  if (!t) return null;
  const offset = new Date().getTimezoneOffset();
  let total = t.hour * 60 + t.minute - offset;
  total = ((total % 1440) + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

export function useReminderSync(): void {
  const navigate = useNavigate();
  const convex = useConvex();
  const lastSyncRef = useRef(0);

  useEffect(() => {
    if (!isNativePlatform) return;

    let cancelled = false;
    const listeners: Array<Promise<{ remove: () => void }>> = [];

    const doSync = async (force: boolean): Promise<void> => {
      try {
        // On cold start, reconcile the server-persisted opt-in into the device
        // flag BEFORE the localStorage early-out, so the preference survives a
        // reinstall (which clears localStorage). Server value wins only when it
        // was actually set; an unset (null/undefined) value leaves the device
        // flag alone. NOTE: iOS notification PERMISSION is a separate OS grant
        // that reinstall also clears — `resyncReminders` self-guards on it, so
        // restoring the flag alone won't fire notifications until permission is
        // re-granted; it just preserves the user's stated preference.
        if (force) {
          try {
            const profile = await convex.query(api.profiles.getMine, {});
            const serverPref = profile?.reminders_enabled;
            if (typeof serverPref === "boolean") setRemindersEnabled(serverPref);
          } catch (err) {
            logger.warn("useReminderSync: reminders-pref reconcile failed", err);
          }
        }

        // Cheap early-out before any further query — flag lives in localStorage.
        if (cancelled || !remindersEnabled()) return;

        const now = Date.now();
        if (!force && now - lastSyncRef.current < FOREGROUND_THROTTLE_MS) return;
        lastSyncRef.current = now;

        // "Logged today" signal — cheapest available: the latest weight log's
        // date === today. Reuses the existing getLatest query (no new backend).
        // On a cold start the auth token may not be ready yet; treat a failed
        // query as "not logged" so the reminder still schedules.
        let weightLoggedToday = false;
        try {
          const latest = await convex.query(api.weight_logs.getLatest, {});
          const today = format(new Date(), "yyyy-MM-dd");
          weightLoggedToday = !!latest && latest.date === today;
        } catch (err) {
          logger.warn("useReminderSync: getLatest failed", err);
        }

        // Learned per-pillar anchors — median local log time over the last 14
        // days. Reuses the existing loggingTimeStats query (UTC → local shift
        // done here). Absent/failed → resyncReminders falls back to defaults.
        let learnedTimes:
          | Partial<Record<ReminderPillar, ClockTime | null>>
          | undefined;
        try {
          const stats = await convex.query(api.fightFormScore.loggingTimeStats, {});
          if (stats) {
            learnedTimes = {
              weight: utcClockToLocal(stats.weight),
              sleep: utcClockToLocal(stats.sleep),
              training: utcClockToLocal(stats.training),
              wellness: utcClockToLocal(stats.wellness),
              nutrition: utcClockToLocal(stats.nutrition),
            };
          }
        } catch (err) {
          logger.warn("useReminderSync: loggingTimeStats failed", err);
        }

        if (cancelled) return;
        await resyncReminders({ weightLoggedToday, openedToday: true, learnedTimes });
      } catch (err) {
        logger.warn("useReminderSync: sync failed", err);
      }
    };

    // Cold-start sync (bypasses the throttle).
    void doSync(true);

    // Foreground resume sync (throttled).
    listeners.push(
      CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) void doSync(false);
      }),
    );

    // Notification tap → deep-link + attribute.
    listeners.push(
      LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
        try {
          const extra = (event.notification?.extra ?? {}) as {
            route?: string;
            pillar?: string;
          };
          const route = extra.route || "/weight";
          track(EVENTS.REMINDER_TAPPED, extra.pillar ? { pillar: extra.pillar } : undefined);
          navigate(route);
        } catch (err) {
          logger.warn("useReminderSync: tap handler failed", err);
          try {
            navigate("/weight");
          } catch {
            /* ignore */
          }
        }
      }),
    );

    return () => {
      cancelled = true;
      listeners.forEach((p) => p.then((h) => h.remove()).catch(() => {}));
    };
  }, [navigate, convex]);
}
