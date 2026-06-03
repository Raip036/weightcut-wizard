import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

// Compute ISO date strings relative to today so they fall inside the 14-day window.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function seedUser(t: ReturnType<typeof convexTest>): Promise<Id<"users">> {
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

describe("loggingTimeStats", () => {
  it("returns a per-pillar median time (null when no signal)", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });

    // Use dates within the last 14 days so the query's `date >= sinceIso` filter includes them.
    const today = todayIso();
    const yesterday = daysAgoIso(1);

    await t.run(async (ctx) => {
      await ctx.db.insert("weight_logs", { userId, date: today, weightKg: 80 } as any);
      await ctx.db.insert("weight_logs", { userId, date: yesterday, weightKg: 80 } as any);
      await ctx.db.insert("sleep_logs", { userId, date: today, hours: 8 } as any);
    });

    const r = await asUser.query(api.fightFormScore.loggingTimeStats, {});
    expect(r).not.toBeNull();
    expect(r!.weight).not.toBeNull();
    expect(typeof r!.weight!.hour).toBe("number");
    expect(typeof r!.weight!.minute).toBe("number");
    expect(r!.sleep).not.toBeNull();
    expect(r!.nutrition).toBeNull();
    expect(r!.training).toBeNull();
    expect(r!.wellness).toBeNull();
  });
});
