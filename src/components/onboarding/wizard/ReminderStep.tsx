/**
 * ReminderStep: onboarding wizard step that requests iOS local-notification
 * permission for adaptive reminders.
 *
 * Explains the
 * value before the iOS system prompt fires so the user makes an informed
 * choice. Both paths ("Turn on" and "Maybe later") advance the wizard via
 * `onAdvance`; the step is always skippable.
 *
 * Behaviour:
 *   - "Turn on reminders" → calls `requestReminderPermission()`. If granted:
 *     `setRemindersEnabled(true)` + schedules a cold-start reminder plan,
 *     then advances.
 *   - "Maybe later" → `setRemindersEnabled(false)` and advances without
 *     prompting. The user can enable from Settings later.
 *   - Web / non-iOS: permission call is a no-op; both buttons still advance.
 */

import { useCallback, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import {
  requestReminderPermission,
  setRemindersEnabled,
  syncAdaptiveReminders,
} from "@/lib/reminderScheduler";
import type { ReminderPlanInput } from "@/lib/reminderSchedule";

/** Cold-start defaults: no log history yet so we use reasonable morning/evening anchors. */
const COLD_START_INPUT: ReminderPlanInput = {
  learnedTimes: {
    weight: { hour: 7, minute: 30 },
    sleep: { hour: 7, minute: 30 },
    training: { hour: 19, minute: 0 },
    wellness: { hour: 10, minute: 0 },
    nutrition: null,
  },
  loggedToday: {
    weight: false,
    sleep: false,
    training: false,
    wellness: false,
    nutrition: false,
  },
  openedToday: false,
  config: { maxPerDay: 2, leadMinutes: 30 },
};

interface ReminderStepProps {
  /** Called after the user enables reminders OR taps "Maybe later". */
  onAdvance: () => void;
  className?: string;
}

export function ReminderStep({ onAdvance, className }: ReminderStepProps): JSX.Element {
  const [loading, setLoading] = useState(false);

  const handleTurnOn = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const granted = await requestReminderPermission();
      if (granted) {
        setRemindersEnabled(true);
        try {
          await syncAdaptiveReminders(COLD_START_INPUT);
        } catch (schedErr) {
          // Non-fatal: permission is already granted; schedule can be
          // retried on next app open via `syncAdaptiveReminders`.
          logger.warn("ReminderStep: cold-start schedule failed", schedErr);
        }
      } else {
        // User denied the iOS prompt, or we're on web, so store the preference
        // so we don't re-ask next time the app opens.
        setRemindersEnabled(false);
      }
    } catch (err) {
      logger.warn("ReminderStep: requestReminderPermission failed", err);
      setRemindersEnabled(false);
    } finally {
      setLoading(false);
      onAdvance();
    }
  }, [loading, onAdvance]);

  const handleSkip = useCallback(() => {
    setRemindersEnabled(false);
    onAdvance();
  }, [onAdvance]);

  return (
    <div className={cn("flex flex-col gap-5 pt-4 px-1", className)}>
      {/* Icon */}
      <div className="flex justify-center">
        <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Bell className="h-8 w-8 text-primary" strokeWidth={1.8} />
        </div>
      </div>

      {/* Body copy */}
      <div className="space-y-2 text-center">
        <h2 className="text-[22px] font-bold leading-tight text-foreground">
          Stay on track
        </h2>
        <p className="text-[14px] text-muted-foreground leading-snug max-w-[300px] mx-auto">
          We'll nudge you at the times you already log: a couple of taps in
          the morning, one in the evening. Two reminders a day, max.
        </p>
      </div>

      {/* Benefit chips */}
      <div className="space-y-2">
        {[
          "Fires before your natural log time, not at random",
          "Suppressed on days you've already logged",
          "Adapts as your habits change",
        ].map((text) => (
          <div
            key={text}
            className="flex items-start gap-3 rounded-xs border border-border/40 bg-card px-4 py-3"
          >
            <Bell className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" strokeWidth={2} />
            <p className="text-[13px] text-foreground/85 leading-snug">{text}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="space-y-2.5 pt-1">
        <button
          type="button"
          onClick={handleTurnOn}
          disabled={loading}
          className="no-tap-select w-full h-12 rounded-xs bg-primary text-primary-foreground text-[15px] font-semibold active:scale-[0.98] transition-transform disabled:opacity-60"
        >
          {loading ? "Setting up…" : "Turn on reminders"}
        </button>
        <button
          type="button"
          onClick={handleSkip}
          disabled={loading}
          className="no-tap-select w-full h-11 rounded-xs bg-transparent text-muted-foreground text-[13px] font-medium active:opacity-70 transition-opacity disabled:opacity-40"
        >
          <BellOff className="inline h-4 w-4 mr-1.5 -mt-0.5" strokeWidth={1.8} />
          Maybe later
        </button>
      </div>
    </div>
  );
}
