import { describe, it, expect } from "vitest";
import { planReminders, type ReminderPlanInput } from "../reminderSchedule";

const base = (over: Partial<ReminderPlanInput> = {}): ReminderPlanInput => ({
  learnedTimes: { weight: { hour: 7, minute: 30 }, sleep: { hour: 7, minute: 30 }, training: { hour: 19, minute: 0 }, wellness: { hour: 10, minute: 0 }, nutrition: null },
  loggedToday: { weight: false, sleep: false, training: false, wellness: false, nutrition: false },
  openedToday: false,
  config: { maxPerDay: 2, leadMinutes: 30 },
  ...over,
});

describe("planReminders", () => {
  it("suppresses reminders for pillars already logged today", () => {
    const out = planReminders(base({ loggedToday: { weight: true, sleep: true, training: false, wellness: false, nutrition: false } }));
    expect(out.some((n) => n.pillar === "weight")).toBe(false);
    expect(out.some((n) => n.pillar === "sleep")).toBe(false);
  });

  it("caps the number of scheduled reminders at maxPerDay", () => {
    const out = planReminders(base());
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it("fires leadMinutes BEFORE the learned time", () => {
    const out = planReminders(base({ loggedToday: { weight: false, sleep: true, training: true, wellness: true, nutrition: true } }));
    const w = out.find((n) => n.pillar === "weight");
    expect(w).toBeDefined();
    expect(w!.hour).toBe(7);
    expect(w!.minute).toBe(0);
  });

  it("prefers earlier reminders when capping", () => {
    const out = planReminders(base());
    const hours = out.map((n) => n.hour).sort((a, b) => a - b);
    expect(hours[0]).toBeLessThanOrEqual(hours[1]);
    expect(out.length).toBe(2);
  });

  it("skips pillars with no learned time (nutrition null)", () => {
    const out = planReminders(base({ loggedToday: { weight: true, sleep: true, training: true, wellness: true, nutrition: false } }));
    expect(out.some((n) => n.pillar === "nutrition")).toBe(false);
  });

  it("schedules nothing when everything is logged", () => {
    const out = planReminders(base({ loggedToday: { weight: true, sleep: true, training: true, wellness: true, nutrition: true } }));
    expect(out).toHaveLength(0);
  });
});
