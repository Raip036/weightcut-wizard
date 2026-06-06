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

describe("catchUpSuggestions", () => {
  it("lists missing pillars for the date and suggests sleep median + last weight", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });
    const target = "2026-05-14";

    await t.run(async (ctx) => {
      await ctx.db.insert("sleep_logs", { userId, date: "2026-05-10", hours: 7 } as any);
      await ctx.db.insert("sleep_logs", { userId, date: "2026-05-11", hours: 8 } as any);
      await ctx.db.insert("sleep_logs", { userId, date: "2026-05-12", hours: 7 } as any);
      await ctx.db.insert("weight_logs", { userId, date: "2026-05-12", weightKg: 79 } as any);
      await ctx.db.insert("daily_wellness_checkins", {
        userId, date: target, hooperIndex: 5, sleepQuality: 7, fatigueLevel: 3, sorenessLevel: 2, stressLevel: 2,
      } as any);
      await ctx.db.insert("marked_skips", { userId, date: target, pillar: "nutrition" });
    });

    const r = await asUser.query(api.fightFormScore.catchUpSuggestions, { date: target });
    expect(r).not.toBeNull();
    expect(r!.date).toBe(target);
    expect(r!.missing).toContain("weight");
    expect(r!.missing).toContain("sleep");
    expect(r!.missing).toContain("training");
    expect(r!.missing).not.toContain("wellness");
    expect(r!.missing).not.toContain("nutrition");
    expect(r!.suggestedSleepHours).toBeCloseTo(7, 5);
    expect(r!.lastWeightKg).toBe(79);
  });

  it("returns empty missing when fully logged", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });
    const target = "2026-05-14";
    await t.run(async (ctx) => {
      await ctx.db.insert("weight_logs", { userId, date: target, weightKg: 80 } as any);
      await ctx.db.insert("sleep_logs", { userId, date: target, hours: 8 } as any);
      await ctx.db.insert("daily_wellness_checkins", { userId, date: target, hooperIndex: 5, sleepQuality: 7, fatigueLevel: 3, sorenessLevel: 2, stressLevel: 2 } as any);
      await ctx.db.insert("gym_sessions", { userId, date: target, status: "completed", durationMinutes: 45, perceivedFatigue: 6, sessionType: "BJJ", updatedAt: Date.now() } as any);
      await ctx.db.insert("meals", { userId, date: target, mealType: "lunch", mealName: "x", isAiGenerated: false } as any);
    });
    const r = await asUser.query(api.fightFormScore.catchUpSuggestions, { date: target });
    expect(r!.missing).toHaveLength(0);
  });
});
