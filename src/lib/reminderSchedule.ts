export type ReminderPillar = "weight" | "sleep" | "training" | "wellness" | "nutrition";
export type ClockTime = { hour: number; minute: number };

export type ReminderPlanInput = {
  /** Learned natural log time per pillar (null = no signal → don't remind). */
  learnedTimes: Record<ReminderPillar, ClockTime | null>;
  loggedToday: Record<ReminderPillar, boolean>;
  openedToday: boolean;
  config: { maxPerDay: number; leadMinutes: number };
};

export type PlannedReminder = { pillar: ReminderPillar; hour: number; minute: number };

const PILLAR_COPY: Record<ReminderPillar, { title: string; body: string }> = {
  weight:    { title: "Morning weigh-in", body: "Step on the scale ⚖️" },
  sleep:     { title: "Log last night's sleep", body: "How'd you sleep? 😴" },
  training:  { title: "Log today's training", body: "Tag your session 🥊" },
  wellness:  { title: "Quick wellness check-in", body: "30 seconds — how do you feel?" },
  nutrition: { title: "Log your meals", body: "Keep your nutrition on track 🍽️" },
};

export function reminderCopy(pillar: ReminderPillar) {
  return PILLAR_COPY[pillar];
}

/**
 * In-app route a reminder should deep-link to when tapped. Read from the
 * scheduled notification's `extra.route` by the tap handler. `/weight` is the
 * default fallback (the morning weigh-in is the primary retention lever).
 */
const PILLAR_ROUTE: Record<ReminderPillar, string> = {
  weight: "/weight",
  sleep: "/sleep",
  training: "/training-calendar",
  wellness: "/recovery/check-in",
  nutrition: "/nutrition",
};

export function reminderRoute(pillar: ReminderPillar): string {
  return PILLAR_ROUTE[pillar];
}

function minusMinutes(t: ClockTime, mins: number): ClockTime {
  let total = t.hour * 60 + t.minute - mins;
  if (total < 0) total += 24 * 60;
  return { hour: Math.floor(total / 60) % 24, minute: total % 60 };
}

/**
 * Decide which reminders to schedule. Pure. Rules:
 * - skip pillars logged today (suppression) or with no learned time,
 * - fire `leadMinutes` before the learned time,
 * - cap at `maxPerDay`, keeping the EARLIEST candidates (morning prompts win
 *   over an evening one when capped),
 * - returned ordered earliest→latest.
 */
export function planReminders(input: ReminderPlanInput): PlannedReminder[] {
  const { learnedTimes, loggedToday, config } = input;
  const PILLARS: ReminderPillar[] = ["weight", "sleep", "training", "wellness", "nutrition"];
  const candidates = PILLARS
    .filter((p) => !loggedToday[p] && learnedTimes[p] != null)
    .map((p) => {
      const fire = minusMinutes(learnedTimes[p]!, config.leadMinutes);
      return { pillar: p, hour: fire.hour, minute: fire.minute, sortKey: fire.hour * 60 + fire.minute };
    })
    .sort((a, b) => a.sortKey - b.sortKey);
  return candidates.slice(0, Math.max(0, config.maxPerDay)).map(({ pillar, hour, minute }) => ({ pillar, hour, minute }));
}
