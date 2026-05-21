import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/** Seed a Convex user + profile pair. `tier` defaults to "pro" so most tests
 *  exercise the authenticated-Pro path without boilerplate. */
async function seedUser(
  t: ReturnType<typeof convexTest>,
  tier: "free" | "pro" = "pro",
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
      subscriptionTier: tier,
    } as any);
    return userId;
  });
}

describe("pathSlotUsage", () => {
  it("returns 0/3/0 for a new Pro user with no paths", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const result = await t
      .withIdentity({ subject: userId })
      .query(api.training_paths.pathSlotUsage, {});
    expect(result).toEqual({ active: 0, max: 3, queued: 0, paused: 0, isPro: true });
  });

  it("counts active, queued, and paused paths separately", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 2; i++) {
        await ctx.db.insert("training_paths", {
          userId, sport: "BJJ", goal: `g${i}`, goalType: "note",
          status: "active", createdAt: Date.now(), lastAdvancedAt: Date.now(),
        });
      }
      await ctx.db.insert("training_paths", {
        userId, sport: "BJJ", goal: "queued", goalType: "note",
        status: "queued", createdAt: Date.now(), lastAdvancedAt: Date.now(),
      });
      await ctx.db.insert("training_paths", {
        userId, sport: "BJJ", goal: "paused", goalType: "note",
        status: "paused", createdAt: Date.now(), lastAdvancedAt: Date.now(),
      });
    });
    const result = await t
      .withIdentity({ subject: userId })
      .query(api.training_paths.pathSlotUsage, {});
    expect(result.active).toBe(2);
    expect(result.queued).toBe(1);
    expect(result.paused).toBe(1);
  });

  it("reports isPro=false for non-Pro users", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "free");
    const result = await t
      .withIdentity({ subject: userId })
      .query(api.training_paths.pathSlotUsage, {});
    expect(result.isPro).toBe(false);
  });
});
