import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";
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

describe("upsertScore persists Plan 1/1b fields", () => {
  it("writes dataConfidence, formMomentum, stale state, and per-pillar completeness", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";

    const score = {
      score: 70, rawScore: 70, label: "sharpening", state: "stale", phase: "build",
      subScores: {
        trainingLoad:       { value: 80, weight: 0.20, reason: "ok", completeness: 0.5 },
        sleep:              { value: 90, weight: 0.20, reason: "ok", completeness: 1 },
        weightCut:          { value: 75, weight: 0.25, reason: "ok", completeness: 0.8 },
        wellness:           { value: 60, weight: 0.20, reason: "ok", completeness: 0.4 },
        nutritionAdherence: { value: 100, weight: 0.15, reason: "ok", completeness: 1 },
        recovery:           { value: 0, weight: 0, reason: "—", completeness: 0 },
      },
      appliedCeiling: null,
      campAge: null,
      topDriver: "sleep",
      topLimiter: "wellness",
      algorithmVersion: "1.0.0",
      recoveryConfidence: 0,
      dataConfidence: 0.62,
      dataAgeDays: 3,
      activePillars: 5,
      totalPillars: 5,
      formMomentum: 0,
    };

    await t.mutation(internal.fightFormScore_internal.upsertScore, {
      userId, date, campId: undefined, score,
    });

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("fight_form_scores")
        .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date))
        .first(),
    );

    expect(row).not.toBeNull();
    expect(row!.state).toBe("stale");
    expect(row!.dataConfidence).toBeCloseTo(0.62, 5);
    expect(row!.dataAgeDays).toBe(3);
    expect(row!.activePillars).toBe(5);
    expect(row!.totalPillars).toBe(5);
    expect(row!.formMomentum).toBe(0);
    expect(row!.subScores.sleep.completeness).toBe(1);
    expect(row!.subScores.wellness.completeness).toBeCloseTo(0.4, 5);
  });
});

describe("fetchScoringInputs builds priorCeilings", () => {
  it("includes recently-applied ceilings within the cooldown window and excludes older ones", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";

    await t.run(async (ctx) => {
      // 2 days ago: a fired sleep_debt cap → should be included.
      await ctx.db.insert("fight_form_scores", {
        userId, date: "2026-05-13", rawScore: 65, displayedScore: 65,
        label: "sharpening", state: "ok",
        subScores: {
          trainingLoad: { value: 50, weight: 0.25, reason: "x" },
          sleep: { value: 20, weight: 0.25, reason: "x" },
          weightCut: { value: 50, weight: 0.25, reason: "x" },
          wellness: { value: 50, weight: 0.25, reason: "x" },
          nutritionAdherence: { value: 0, weight: 0, reason: "x" },
        },
        appliedCeiling: { ruleId: "sleep_debt", cap: 65 },
        topDriver: "trainingLoad", topLimiter: "sleep",
        algorithmVersion: "1.0.0", computedAt: Date.now(),
      } as any);
      // 10 days ago: outside the 5-day cooldown → should be excluded.
      await ctx.db.insert("fight_form_scores", {
        userId, date: "2026-05-05", rawScore: 60, displayedScore: 60,
        label: "sharpening", state: "ok",
        subScores: {
          trainingLoad: { value: 50, weight: 0.25, reason: "x" },
          sleep: { value: 50, weight: 0.25, reason: "x" },
          weightCut: { value: 50, weight: 0.25, reason: "x" },
          wellness: { value: 50, weight: 0.25, reason: "x" },
          nutritionAdherence: { value: 0, weight: 0, reason: "x" },
        },
        appliedCeiling: { ruleId: "training_spike", cap: 60 },
        topDriver: "trainingLoad", topLimiter: "sleep",
        algorithmVersion: "1.0.0", computedAt: Date.now(),
      } as any);
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, { userId, date });

    expect(inputs.priorCeilings).toBeDefined();
    const rules = inputs.priorCeilings!.map((c) => c.ruleId);
    expect(rules).toContain("sleep_debt");
    expect(rules).not.toContain("training_spike");
    const sd = inputs.priorCeilings!.find((c) => c.ruleId === "sleep_debt");
    expect(sd).toEqual({ date: "2026-05-13", ruleId: "sleep_debt", cap: 65 });
  });
});

describe("ceiling latching runs end-to-end through recompute", () => {
  it("holds a fired sleep_debt cap when the user stops logging sleep", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("weight_logs", { userId, date: "2026-04-20", weightKg: 80 } as any);
      await ctx.db.insert("weight_logs", { userId, date: "2026-05-13", weightKg: 78 } as any);
      // Sleep last logged 6 days before the target → stale beyond grace AND
      // out of the live 7-day sleep-debt window.
      await ctx.db.insert("sleep_logs", { userId, date: "2026-05-09", hours: 8 } as any);
      // Yesterday a sleep_debt ceiling fired and was stored.
      await ctx.db.insert("fight_form_scores", {
        userId, date: "2026-05-14", rawScore: 65, displayedScore: 65,
        label: "sharpening", state: "ok",
        subScores: {
          trainingLoad: { value: 50, weight: 0.25, reason: "x" },
          sleep: { value: 10, weight: 0.25, reason: "x" },
          weightCut: { value: 50, weight: 0.25, reason: "x" },
          wellness: { value: 50, weight: 0.25, reason: "x" },
          nutritionAdherence: { value: 0, weight: 0, reason: "x" },
        },
        appliedCeiling: { ruleId: "sleep_debt", cap: 65 },
        topDriver: "trainingLoad", topLimiter: "sleep",
        algorithmVersion: "1.0.0", computedAt: Date.now(),
      } as any);
    });

    await t.action(internal.fightFormScore.recomputeForUserDate, { userId, date: "2026-05-15" });

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("fight_form_scores")
        .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", "2026-05-15"))
        .first(),
    );
    expect(row).not.toBeNull();
    expect(row!.appliedCeiling?.ruleId).toBe("sleep_debt");
    expect(row!.rawScore).toBeLessThanOrEqual(65);
  });
});
