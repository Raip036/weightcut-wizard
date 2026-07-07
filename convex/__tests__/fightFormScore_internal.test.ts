import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Tests for sleep / weight sourcing in `fetchScoringInputs`. Apple HealthKit
 * was removed (App Store Guideline 2.5.1), so sleep and weight now come SOLELY
 * from the manual `sleep_logs` / `weight_logs` tables — there is no HealthKit
 * precedence merge and no `inputs.sources` map any more.
 */

async function seedUser(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {} as any);
    await ctx.db.insert("profiles", {
      userId,
      age: 30,
      sex: "M",
      heightCm: 180,
      currentWeightKg: 80,
      goalWeightKg: 75,
      targetDate: "2026-12-01",
      activityLevel: "moderate",
      goalType: "weight_loss",
      role: "fighter",
      subscriptionTier: "pro",
    } as any);
    return userId;
  });
}

describe("fetchScoringInputs — manual sleep/weight sourcing", () => {
  it("uses the manual sleep_logs hours for a date", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";
    await t.run(async (ctx) => {
      await ctx.db.insert("sleep_logs", { userId, date, hours: 6 });
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date,
    });

    const sleepForDate = inputs.sleepHours.find((s) => s.date === date);
    expect(sleepForDate).toBeDefined();
    expect(sleepForDate!.hours).toBe(6);
    // No HealthKit provenance map is emitted any more.
    expect((inputs as Record<string, unknown>).sources).toBeUndefined();
  });

  it("uses the manual weight_logs weight for a date", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";
    await t.run(async (ctx) => {
      await ctx.db.insert("weight_logs", { userId, date, weightKg: 80.0 });
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date,
    });

    const wForDate = inputs.weights.find((w) => w.date === date);
    expect(wForDate).toBeDefined();
    expect(wForDate!.weightKg).toBe(80.0);
    expect((inputs as Record<string, unknown>).sources).toBeUndefined();
  });

  it("carries every dated sleep + weight log within the lookback window", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const target = "2026-05-15";
    const earlier = "2026-05-14";
    await t.run(async (ctx) => {
      await ctx.db.insert("sleep_logs", { userId, date: target, hours: 6 });
      await ctx.db.insert("sleep_logs", { userId, date: earlier, hours: 5 });
      await ctx.db.insert("weight_logs", { userId, date: target, weightKg: 79.0 });
      await ctx.db.insert("weight_logs", { userId, date: earlier, weightKg: 79.5 });
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date: target,
    });

    expect(inputs.sleepHours.find((s) => s.date === target)!.hours).toBe(6);
    expect(inputs.sleepHours.find((s) => s.date === earlier)!.hours).toBe(5);
    expect(inputs.weights.find((w) => w.date === target)!.weightKg).toBe(79.0);
    expect(inputs.weights.find((w) => w.date === earlier)!.weightKg).toBe(79.5);
  });

  it("omits a sleep entry for a date with no manual log (no rescue without training)", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date,
    });

    expect(inputs.sleepHours.find((s) => s.date === date)).toBeUndefined();
    expect(inputs.weights.find((w) => w.date === date)).toBeUndefined();
  });
});

/**
 * Load-pillar sourcing: the training-load pillar must reflect ALL training
 * (gym workouts via `gym_sessions` + martial-arts / fight-camp sessions via
 * `fight_camp_calendar`), de-duped so a gym workout — which writes BOTH a
 * `gym_sessions` row AND a synthesized `source:"gym"` calendar row — counts
 * exactly once.
 */
describe("fetchScoringInputs — training-load union (gym + calendar, de-duped)", () => {
  it("does NOT double-count a gym workout that has both a gym_sessions row and a source:'gym' calendar row", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";
    await t.run(async (ctx) => {
      // The gym finish flow writes BOTH rows for the same workout.
      await ctx.db.insert("gym_sessions", {
        userId,
        date,
        sessionType: "S&C",
        status: "completed",
        durationMinutes: 60,
        perceivedFatigue: 7,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("fight_camp_calendar", {
        userId,
        date,
        sessionType: "S&C",
        intensity: "high",
        durationMinutes: 60,
        rpe: 7,
        source: "gym",
      });
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date,
    });

    // Exactly one load session for the day — the gym_sessions row. The
    // source:"gym" calendar row must be excluded so load isn't doubled.
    const forDate = inputs.sessions.filter((s) => s.date === date);
    expect(forDate.length).toBe(1);
    expect(forDate[0]).toMatchObject({ date, rpe: 7, durationMinutes: 60 });
  });

  it("does NOT double-count a legacy gym mirror whose `source` is UNSET (pre-backfill deploy window) but that matches a gym_sessions row on date+sessionType+durationMinutes", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";
    await t.run(async (ctx) => {
      // Gym workout: canonical gym_sessions row.
      await ctx.db.insert("gym_sessions", {
        userId,
        date,
        sessionType: "S&C",
        status: "completed",
        durationMinutes: 60,
        perceivedFatigue: 7,
        updatedAt: Date.now(),
      });
      // Legacy gym mirror written BEFORE the source-tagging change: `source`
      // is unset. `undefined !== "gym"` passes the source filter, so without
      // the presence-based dedup this row would be double-counted until the
      // backfill runs. It matches the gym_sessions row on date+type+duration.
      await ctx.db.insert("fight_camp_calendar", {
        userId,
        date,
        sessionType: "S&C",
        intensity: "high",
        durationMinutes: 60,
        rpe: 7,
        // source deliberately omitted (legacy pre-backfill row)
      });
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date,
    });

    // Exactly one load session for the day — the gym_sessions row only. The
    // untagged mirror must be excluded by matching it against the fetched
    // gym_sessions rows, closing the deploy-ordering window.
    const forDate = inputs.sessions.filter((s) => s.date === date);
    expect(forDate.length).toBe(1);
    expect(forDate[0]).toMatchObject({ date, rpe: 7, durationMinutes: 60 });
  });

  it("adds load for a non-gym calendar session (e.g. a logged BJJ round with rpe + duration)", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";
    await t.run(async (ctx) => {
      // Martial-arts session logged via FightCampLogForm — NO gym_sessions row.
      await ctx.db.insert("fight_camp_calendar", {
        userId,
        date,
        sessionType: "BJJ",
        intensity: "high",
        durationMinutes: 45,
        rpe: 8,
        source: "round_card",
      });
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date,
    });

    const forDate = inputs.sessions.filter((s) => s.date === date);
    expect(forDate.length).toBe(1);
    expect(forDate[0]).toMatchObject({ date, rpe: 8, durationMinutes: 45 });
  });

  it("excludes rest-day calendar rows from load and skips calendar rows missing rpe/duration", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";
    await t.run(async (ctx) => {
      // Rest day — must not contribute load.
      await ctx.db.insert("fight_camp_calendar", {
        userId,
        date,
        sessionType: "Rest",
        intensity: "low",
        durationMinutes: 0,
        rpe: 0,
        source: "manual",
      });
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date,
    });

    expect(inputs.sessions.filter((s) => s.date === date).length).toBe(0);
    // Rest-day detection is preserved (used by the training-load cold-start gate).
    expect(inputs.restDays).toContain(date);
  });

  it("counts BOTH a gym workout (via gym_sessions) and a separate non-gym session on the same day exactly once each", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";
    await t.run(async (ctx) => {
      // Gym workout: gym_sessions row + its synthesized source:"gym" calendar row.
      await ctx.db.insert("gym_sessions", {
        userId,
        date,
        sessionType: "S&C",
        status: "completed",
        durationMinutes: 50,
        perceivedFatigue: 6,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("fight_camp_calendar", {
        userId,
        date,
        sessionType: "S&C",
        intensity: "moderate",
        durationMinutes: 50,
        rpe: 6,
        source: "gym",
      });
      // Separate martial-arts session the same day — no gym_sessions row.
      await ctx.db.insert("fight_camp_calendar", {
        userId,
        date,
        sessionType: "Muay Thai",
        intensity: "high",
        durationMinutes: 40,
        rpe: 9,
        source: "quicklog",
      });
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date,
    });

    const forDate = inputs.sessions.filter((s) => s.date === date);
    // Two distinct load contributions: the gym workout (once) + the MT session.
    expect(forDate.length).toBe(2);
    expect(forDate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date, rpe: 6, durationMinutes: 50 }),
        expect.objectContaining({ date, rpe: 9, durationMinutes: 40 }),
      ]),
    );
  });
});
