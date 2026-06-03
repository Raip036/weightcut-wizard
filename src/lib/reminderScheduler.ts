import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import {
  planReminders,
  reminderCopy,
  type ReminderPlanInput,
  type ReminderPillar,
  type PlannedReminder,
} from "./reminderSchedule";

const ENABLE_KEY = "adaptive_reminders_enabled";

/** Stable per-pillar notification ids so reschedules replace cleanly. */
export const REMINDER_IDS: Record<ReminderPillar, number> = {
  weight: 9101,
  sleep: 9102,
  training: 9103,
  wellness: 9104,
  nutrition: 9105,
};

export function remindersEnabled(): boolean {
  return localStorage.getItem(ENABLE_KEY) === "1";
}

export function setRemindersEnabled(on: boolean): void {
  localStorage.setItem(ENABLE_KEY, on ? "1" : "0");
}

export async function requestReminderPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const res = await LocalNotifications.requestPermissions();
  return res.display === "granted";
}

async function cancelAllReminders(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.cancel({
    notifications: Object.values(REMINDER_IDS).map((id) => ({ id })),
  });
}

export async function applyReminderPlan(plan: PlannedReminder[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await cancelAllReminders();
  if (plan.length === 0) return;
  await LocalNotifications.schedule({
    notifications: plan.map((p) => {
      const copy = reminderCopy(p.pillar);
      return {
        id: REMINDER_IDS[p.pillar],
        title: copy.title,
        body: copy.body,
        schedule: { on: { hour: p.hour, minute: p.minute }, every: "day" as const },
        sound: "default",
        actionTypeId: "",
        extra: null,
      };
    }),
  });
}

/**
 * Compute + apply the adaptive reminder plan. Caller assembles the planner
 * input from `loggingTimeStats` + today's logged state. No-op when the user
 * hasn't enabled reminders. When the app was opened today, tighten the cap to 1.
 */
export async function syncAdaptiveReminders(input: ReminderPlanInput): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!remindersEnabled()) {
    await cancelAllReminders();
    return;
  }
  const effective: ReminderPlanInput = {
    ...input,
    config: {
      ...input.config,
      maxPerDay: input.openedToday
        ? Math.min(1, input.config.maxPerDay)
        : input.config.maxPerDay,
    },
  };
  await applyReminderPlan(planReminders(effective));
}
