import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

async function seedUser(t: ReturnType<typeof convexTest>): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {} as any);
    await ctx.db.insert("profiles", {
      userId, age: 30, sex: "M", heightCm: 180, currentWeightKg: 80,
      goalWeightKg: 75, targetDate: "2026-12-01", activityLevel: "moderate",
      goalType: "weight_loss", role: "fighter", subscriptionTier: "pro",
    } as any);
    return userId;
  });
}

describe("weeklyCompleteness", () => {
  it("returns 7 days oldest→newest with per-pillar flags, count and status", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });
    const today = "2026-05-15";

    await t.run(async (ctx) => {
      await ctx.db.insert("weight_logs", { userId, date: today, weightKg: 80 } as any);
      await ctx.db.insert("sleep_logs", { userId, date: today, hours: 8 } as any);
      await ctx.db.insert("daily_wellness_checkins", {
        userId, date: today, hooperIndex: 5,
        sleepQuality: 7, fatigueLevel: 3, sorenessLevel: 2, stressLevel: 2,
      } as any);
      await ctx.db.insert("gym_sessions", {
        userId, date: today, status: "completed", durationMinutes: 45, perceivedFatigue: 6,
        sessionType: "BJJ", updatedAt: Date.now(),
      } as any);
      await ctx.db.insert("meals", { userId, date: today, mealType: "lunch", mealName: "x", isAiGenerated: false } as any);
      await ctx.db.insert("sleep_logs", { userId, date: "2026-05-14", hours: 7 } as any);
      await ctx.db.insert("fight_camp_calendar", { userId, date: "2026-05-13", sessionType: "Rest", intensity: "Rest", durationMinutes: 0, rpe: 0 } as any);
    });

    const days = (await asUser.query(api.fightFormScore.weeklyCompleteness, { date: today }))!;
    expect(days).toHaveLength(7);
    expect(days[6].date).toBe(today);
    expect(days[0].date).toBe("2026-05-09");

    const d15 = days[6];
    expect(d15.count).toBe(5);
    expect(d15.status).toBe("full");
    expect(d15.logged.weight).toBe(true);
    expect(d15.logged.meals).toBe(true);

    const d14 = days[5];
    expect(d14.count).toBe(1);
    expect(d14.status).toBe("partial");

    // A logged rest day satisfies the training pillar (resting is part of the
    // plan) and still reads as a "rest" day unless every pillar is logged.
    const d13 = days[4];
    expect(d13.status).toBe("rest");
    expect(d13.count).toBe(1);
    expect(d13.logged.training).toBe(true);

    const d12 = days[3];
    expect(d12.status).toBe("none");
  });
});
