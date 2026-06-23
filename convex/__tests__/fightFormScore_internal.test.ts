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
