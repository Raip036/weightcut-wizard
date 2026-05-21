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

describe("path proposals", () => {
  it("getActivePathProposals returns pending and excludes snoozed", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("training_path_proposals", {
        userId, technique: "Kimura", techniqueNormalized: "kimura",
        sport: "BJJ", status: "pending", declineCount: 0, createdAt: Date.now(),
      });
      await ctx.db.insert("training_path_proposals", {
        userId, technique: "Armbar", techniqueNormalized: "armbar",
        sport: "BJJ", status: "snoozed", snoozedUntil: Date.now() + 1_000_000,
        declineCount: 1, createdAt: Date.now(),
      });
    });
    const out = await t
      .withIdentity({ subject: userId })
      .query(api.training_paths.getActivePathProposals, {});
    expect(out.length).toBe(1);
    expect(out[0].technique).toBe("Kimura");
  });

  it("snoozePathProposal sets status and snoozedUntil ~7 days out", async () => {
    const t = convexTest(schema);
    const before = Date.now();
    const userId = await seedUser(t);
    const propId = await t.run(async (ctx) =>
      ctx.db.insert("training_path_proposals", {
        userId, technique: "Kimura", techniqueNormalized: "kimura",
        sport: "BJJ", status: "pending", declineCount: 0, createdAt: Date.now(),
      }),
    );
    await t
      .withIdentity({ subject: userId })
      .mutation(api.training_paths.snoozePathProposal, { proposalId: propId });
    const row = await t.run(async (ctx) => ctx.db.get(propId));
    expect(row?.status).toBe("snoozed");
    expect(row?.snoozedUntil).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);
  });

  it("declinePathProposal increments declineCount and flips status", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const propId = await t.run(async (ctx) =>
      ctx.db.insert("training_path_proposals", {
        userId, technique: "Kimura", techniqueNormalized: "kimura",
        sport: "BJJ", status: "pending", declineCount: 1, createdAt: Date.now(),
      }),
    );
    await t
      .withIdentity({ subject: userId })
      .mutation(api.training_paths.declinePathProposal, { proposalId: propId });
    const row = await t.run(async (ctx) => ctx.db.get(propId));
    expect(row?.status).toBe("declined");
    expect(row?.declineCount).toBe(2);
  });

  it("snoozePathProposal throws for another user's proposal", async () => {
    const t = convexTest(schema);
    const ownerId = await seedUser(t);
    const intruderId = await seedUser(t);
    const propId = await t.run(async (ctx) =>
      ctx.db.insert("training_path_proposals", {
        userId: ownerId, technique: "Kimura", techniqueNormalized: "kimura",
        sport: "BJJ", status: "pending", declineCount: 0, createdAt: Date.now(),
      }),
    );
    await expect(
      t.withIdentity({ subject: intruderId })
        .mutation(api.training_paths.snoozePathProposal, { proposalId: propId }),
    ).rejects.toThrow(/Not authorized/);
  });
});
