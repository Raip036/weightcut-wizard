import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Tests for the HealthKit-vs-manual precedence rule in `fetchScoringInputs`:
 * when `daily_health_summary` has a usable value for a given date, that
 * value WINS over the matching manual `sleep_logs` / `weight_logs` row.
 * Manual entries are the fallback when HealthKit is null / 0 / absent.
 *
 * The `inputs.sources` map records which side won per date, surfacing via
 * the engine output's `inputSources` for UI badges like "Sleep from Apple
 * Health".
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

describe("fetchScoringInputs — HealthKit precedence", () => {
  it("prefers HealthKit sleepMinutes over manual sleep_logs for the same date", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";
    await t.run(async (ctx) => {
      await ctx.db.insert("sleep_logs", { userId, date, hours: 6 });
      await ctx.db.insert("daily_health_summary", {
        userId,
        date,
        // 7.5h via HealthKit — should beat the 6h manual log.
        sleepMinutes: 450,
        sourcesPresent: ["Apple Watch"],
        computedAt: Date.now(),
      } as any);
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date,
    });

    const sleepForDate = inputs.sleepHours.find((s) => s.date === date);
    expect(sleepForDate).toBeDefined();
    expect(sleepForDate!.hours).toBeCloseTo(7.5, 5);
    expect(inputs.sources?.sleepHoursByDate[date]).toBe("healthkit");
    expect(inputs.sources?.sleepHoursTargetDate).toBe("healthkit");
  });

  it("falls back to manual sleep_logs when HealthKit sleepMinutes is null", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";
    await t.run(async (ctx) => {
      await ctx.db.insert("sleep_logs", { userId, date, hours: 6 });
      // HK row exists but has no sleepMinutes → manual must win.
      await ctx.db.insert("daily_health_summary", {
        userId,
        date,
        stepCount: 9000,
        sourcesPresent: ["iPhone"],
        computedAt: Date.now(),
      } as any);
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date,
    });

    const sleepForDate = inputs.sleepHours.find((s) => s.date === date);
    expect(sleepForDate!.hours).toBe(6);
    expect(inputs.sources?.sleepHoursByDate[date]).toBe("manual");
  });

  it("falls back to manual sleep_logs when HealthKit sleepMinutes is 0 (no samples that day)", async () => {
    // Edge case: rollupDaily can legitimately write 0 minutes for a day
    // with no sleep samples — we don't want that phantom to clobber a
    // real manual log.
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";
    await t.run(async (ctx) => {
      await ctx.db.insert("sleep_logs", { userId, date, hours: 7 });
      await ctx.db.insert("daily_health_summary", {
        userId,
        date,
        sleepMinutes: 0,
        sourcesPresent: ["Apple Watch"],
        computedAt: Date.now(),
      } as any);
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date,
    });

    const sleepForDate = inputs.sleepHours.find((s) => s.date === date);
    expect(sleepForDate!.hours).toBe(7);
    expect(inputs.sources?.sleepHoursByDate[date]).toBe("manual");
  });

  it("prefers HealthKit bodyMassKg over manual weight_logs for the same date", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";
    await t.run(async (ctx) => {
      await ctx.db.insert("weight_logs", { userId, date, weightKg: 80.0 });
      await ctx.db.insert("daily_health_summary", {
        userId,
        date,
        bodyMassKg: 79.2,
        sourcesPresent: ["Withings Scale"],
        computedAt: Date.now(),
      } as any);
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date,
    });

    const wForDate = inputs.weights.find((w) => w.date === date);
    expect(wForDate!.weightKg).toBeCloseTo(79.2, 5);
    expect(inputs.sources?.weightsByDate[date]).toBe("healthkit");
    expect(inputs.sources?.weightLatest).toBe("healthkit");
  });

  it("falls back to manual weight_logs when HealthKit bodyMassKg is absent", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";
    await t.run(async (ctx) => {
      await ctx.db.insert("weight_logs", { userId, date, weightKg: 80.0 });
      // HK row with no bodyMassKg field at all.
      await ctx.db.insert("daily_health_summary", {
        userId,
        date,
        stepCount: 7000,
        sourcesPresent: ["iPhone"],
        computedAt: Date.now(),
      } as any);
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date,
    });

    const wForDate = inputs.weights.find((w) => w.date === date);
    expect(wForDate!.weightKg).toBe(80.0);
    expect(inputs.sources?.weightsByDate[date]).toBe("manual");
    expect(inputs.sources?.weightLatest).toBe("manual");
  });

  it("merges per-date independently — HK wins on one date, manual on another", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const target = "2026-05-15";
    const earlier = "2026-05-14";
    await t.run(async (ctx) => {
      // Both dates have a manual sleep log.
      await ctx.db.insert("sleep_logs", { userId, date: target, hours: 6 });
      await ctx.db.insert("sleep_logs", { userId, date: earlier, hours: 5 });
      // Only the target date has HealthKit sleep — earlier date stays manual.
      await ctx.db.insert("daily_health_summary", {
        userId,
        date: target,
        sleepMinutes: 480, // 8h
        sourcesPresent: ["Apple Watch"],
        computedAt: Date.now(),
      } as any);
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date: target,
    });

    const targetSleep = inputs.sleepHours.find((s) => s.date === target);
    const earlierSleep = inputs.sleepHours.find((s) => s.date === earlier);
    expect(targetSleep!.hours).toBe(8);
    expect(earlierSleep!.hours).toBe(5);
    expect(inputs.sources?.sleepHoursByDate[target]).toBe("healthkit");
    expect(inputs.sources?.sleepHoursByDate[earlier]).toBe("manual");
  });

  it("emits a HealthKit-only entry when no matching manual log exists", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";
    await t.run(async (ctx) => {
      await ctx.db.insert("daily_health_summary", {
        userId,
        date,
        sleepMinutes: 420, // 7h, no manual log at all
        bodyMassKg: 78.5,
        sourcesPresent: ["Apple Watch"],
        computedAt: Date.now(),
      } as any);
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId,
      date,
    });

    expect(inputs.sleepHours).toContainEqual({ date, hours: 7 });
    expect(inputs.weights).toContainEqual({ date, weightKg: 78.5 });
    expect(inputs.sources?.sleepHoursByDate[date]).toBe("healthkit");
    expect(inputs.sources?.weightsByDate[date]).toBe("healthkit");
  });
});
