import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import {
  planReminders,
  reminderCopy,
  reminderRoute,
  type ReminderPlanInput,
  type ReminderPillar,
  type ClockTime,
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
        actionTypeId: "REMINDER",
        // Read by the tap handler (useReminderSync) to deep-link + attribute.
        extra: { route: reminderRoute(p.pillar), pillar: p.pillar },
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

/**
 * Default learned anchors used for the periodic re-sync (app foreground /
 * cold start / post-log). Mirrors the onboarding cold-start anchors: morning
 * weigh-in + sleep, evening training, mid-morning wellness. Kept here so the
 * onboarding step, the foreground hook, and the post-log path stay in sync.
 * `nutrition` stays null (no reminder) until a learned-time signal exists.
 */
const DEFAULT_LEARNED_TIMES: Record<ReminderPillar, ClockTime | null> = {
  weight: { hour: 7, minute: 30 },
  sleep: { hour: 7, minute: 30 },
  training: { hour: 19, minute: 0 },
  wellness: { hour: 10, minute: 0 },
  nutrition: null,
};

/** Per-pillar "logged today" suppression flags. Each log path passes only its
 *  own pillar's flag (mirrors the weight path); the others default to false so
 *  the next foreground / cold-start sync — which knows the real state — settles
 *  them. All optional so existing single-pillar callers keep type-checking. */
export type ReminderLoggedFlags = {
  weightLoggedToday?: boolean;
  sleepLoggedToday?: boolean;
  trainingLoggedToday?: boolean;
  wellnessLoggedToday?: boolean;
  nutritionLoggedToday?: boolean;
};

export type ResyncRemindersOpts = ReminderLoggedFlags & {
  openedToday: boolean;
  /**
   * Learned per-pillar DEVICE-LOCAL log times (the caller is responsible for
   * converting any server-side UTC stats to local before passing them in). A
   * present, non-null pillar overrides its default anchor; a `null` value (no
   * signal) or an absent pillar falls back to `DEFAULT_LEARNED_TIMES`. Omit the
   * whole map to use all defaults (the suppression-only post-log path).
   */
  learnedTimes?: Partial<Record<ReminderPillar, ClockTime | null>>;
};

/**
 * Re-sync the adaptive reminder plan with today's real suppression state.
 * Fully self-guarding: no-op on web, when the user hasn't opted in, or when
 * OS permission isn't already granted (never re-prompts — onboarding owns the
 * prompt). Callers pass which pillars were logged today so those reminders are
 * suppressed for today while tomorrow's stay scheduled, and optionally the
 * user's learned per-pillar log times so anchors drift toward real habits.
 */
export async function resyncReminders(opts: ResyncRemindersOpts): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!remindersEnabled()) return;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== "granted") return;
  } catch {
    return;
  }
  const lt = opts.learnedTimes;
  const pick = (p: ReminderPillar): ClockTime | null =>
    lt?.[p] ?? DEFAULT_LEARNED_TIMES[p];
  const input: ReminderPlanInput = {
    learnedTimes: {
      weight: pick("weight"),
      sleep: pick("sleep"),
      training: pick("training"),
      wellness: pick("wellness"),
      nutrition: pick("nutrition"),
    },
    loggedToday: {
      weight: !!opts.weightLoggedToday,
      sleep: !!opts.sleepLoggedToday,
      training: !!opts.trainingLoggedToday,
      wellness: !!opts.wellnessLoggedToday,
      nutrition: !!opts.nutritionLoggedToday,
    },
    openedToday: opts.openedToday,
    config: { maxPerDay: 2, leadMinutes: 30 },
  };
  await syncAdaptiveReminders(input);
}
