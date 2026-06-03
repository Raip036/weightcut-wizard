import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
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

describe("marked_skips CRUD", () => {
  it("setSkip creates a row, is idempotent, and skipsForDate returns it", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });

    await asUser.mutation(api.markedSkips.setSkip, { date: "2026-05-10", pillar: "sleep" });
    await asUser.mutation(api.markedSkips.setSkip, { date: "2026-05-10", pillar: "sleep" });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("marked_skips").withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", "2026-05-10")).collect(),
    );
    expect(rows.length).toBe(1);

    const skips = await asUser.query(api.markedSkips.skipsForDate, { date: "2026-05-10" });
    expect(skips).toContain("sleep");
  });

  it("clearSkip removes the row", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });

    await asUser.mutation(api.markedSkips.setSkip, { date: "2026-05-10", pillar: "weight" });
    await asUser.mutation(api.markedSkips.clearSkip, { date: "2026-05-10", pillar: "weight" });

    const skips = await asUser.query(api.markedSkips.skipsForDate, { date: "2026-05-10" });
    expect(skips).not.toContain("weight");
  });
});

describe("marked skips flow into scoring inputs", () => {
  it("fetchScoringInputs maps skip pillars to SubScoreKey", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("marked_skips", { userId, date: "2026-05-10", pillar: "weight" });
      await ctx.db.insert("marked_skips", { userId, date: "2026-05-10", pillar: "nutrition" });
    });
    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId, date: "2026-05-10",
    });
    expect(inputs.markedSkips).toBeDefined();
    const byPillar = inputs.markedSkips!.map((s) => s.pillar);
    expect(byPillar).toContain("weightCut");
    expect(byPillar).toContain("nutritionAdherence");
    expect(byPillar).not.toContain("weight");
  });
});
