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
      // Store a real stored tier + future expiry for Pro (the materialized
      // shape RevenueCat writes). A bare "pro" with no expiry is no longer a
      // valid Pro state — effectiveTier requires a finite future expiry for
      // any non-lifetime tier (bounded-expiry invariant, F1).
      subscriptionTier: tier === "pro" ? "premium_annual" : "free",
      ...(tier === "pro"
        ? { subscriptionExpiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 }
        : {}),
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

describe("path lifecycle (pause / resume / archive)", () => {
  async function seedPath(
    t: ReturnType<typeof convexTest>,
    userId: Id<"users">,
    status: "active" | "queued" | "paused" = "active",
  ) {
    return await t.run(async (ctx) =>
      ctx.db.insert("training_paths", {
        userId, sport: "BJJ", goal: "Master kimura", goalType: "note",
        status, createdAt: Date.now(), lastAdvancedAt: Date.now(),
      }),
    );
  }

  it("pausePath flips status to paused", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const pathId = await seedPath(t, userId);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.training_paths.pausePath, { pathId });
    const row = await t.run((ctx) => ctx.db.get(pathId));
    expect(row?.status).toBe("paused");
  });

  it("resumePath returns paused path to active when slot is free", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const pathId = await seedPath(t, userId, "paused");
    await t
      .withIdentity({ subject: userId })
      .mutation(api.training_paths.resumePath, { pathId });
    const row = await t.run((ctx) => ctx.db.get(pathId));
    expect(row?.status).toBe("active");
  });

  it("resumePath queues the path if 3 actives already exist", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    for (let i = 0; i < 3; i++) await seedPath(t, userId, "active");
    const pausedId = await seedPath(t, userId, "paused");
    await t
      .withIdentity({ subject: userId })
      .mutation(api.training_paths.resumePath, { pathId: pausedId });
    const row = await t.run((ctx) => ctx.db.get(pausedId));
    expect(row?.status).toBe("queued");
  });

  it("archivePath flips status to archived", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const pathId = await seedPath(t, userId);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.training_paths.archivePath, { pathId });
    const row = await t.run((ctx) => ctx.db.get(pathId));
    expect(row?.status).toBe("archived");
  });

  it("pausing an active path auto-promotes the oldest queued one", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const activeId = await seedPath(t, userId, "active");
    const queuedId = await seedPath(t, userId, "queued");
    await t
      .withIdentity({ subject: userId })
      .mutation(api.training_paths.pausePath, { pathId: activeId });
    const promoted = await t.run((ctx) => ctx.db.get(queuedId));
    expect(promoted?.status).toBe("active");
  });
});

describe("path reads for widget", () => {
  it("getActivePaths returns active paths ordered by lastAdvancedAt desc", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("training_paths", {
        userId, sport: "BJJ", goal: "older", goalType: "note",
        status: "active", createdAt: 1, lastAdvancedAt: 100,
      });
      await ctx.db.insert("training_paths", {
        userId, sport: "BJJ", goal: "newer", goalType: "note",
        status: "active", createdAt: 2, lastAdvancedAt: 200,
      });
    });
    const out = await t
      .withIdentity({ subject: userId })
      .query(api.training_paths.getActivePaths, {});
    expect(out.map((p) => p.goal)).toEqual(["newer", "older"]);
  });

  it("getPathWithSteps returns ordered steps", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const pathId = await t.run(async (ctx) => {
      const pid = await ctx.db.insert("training_paths", {
        userId, sport: "BJJ", goal: "g", goalType: "note",
        status: "active", createdAt: 1, lastAdvancedAt: 1,
      });
      for (const pos of [3, 1, 2]) {
        await ctx.db.insert("training_path_steps", {
          pathId: pid, position: pos, state: pos === 1 ? "current" : "upcoming",
          prescription: `s${pos}`, wizardLine: `w${pos}`,
          details: { why: "", how: [], pitfalls: [] },
          targetSport: "BJJ", expectedSessions: 1,
        });
      }
      return pid;
    });
    const out = await t
      .withIdentity({ subject: userId })
      .query(api.training_paths.getPathWithSteps, { pathId });
    expect(out.steps.map((s) => s.position)).toEqual([1, 2, 3]);
  });

  it("getHeroStep returns current step + next-2 from most-advanced active path", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      const pid = await ctx.db.insert("training_paths", {
        userId, sport: "BJJ", goal: "Hero path", goalType: "note",
        status: "active", createdAt: 1, lastAdvancedAt: 200,
      });
      for (const [pos, state] of [
        [1, "completed"], [2, "completed"], [3, "current"],
        [4, "upcoming"], [5, "upcoming"], [6, "upcoming"],
      ] as const) {
        await ctx.db.insert("training_path_steps", {
          pathId: pid, position: pos, state,
          prescription: `step${pos}`, wizardLine: `w${pos}`,
          details: { why: "", how: [], pitfalls: [] },
          targetSport: "BJJ", expectedSessions: 1,
        });
      }
    });
    const hero = await t
      .withIdentity({ subject: userId })
      .query(api.training_paths.getHeroStep, {});
    expect(hero?.currentStep.prescription).toBe("step3");
    expect(hero?.nextSteps.map((s) => s.prescription)).toEqual(["step4", "step5"]);
    expect(hero?.totalSteps).toBe(6);
    expect(hero?.stepNumber).toBe(3);
  });
});

describe("submitStepFeedback", () => {
  it("writes a feedback row and patches the step's completedFeedback", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const { pathId, stepId } = await t.run(async (ctx) => {
      const pid = await ctx.db.insert("training_paths", {
        userId, sport: "BJJ", goal: "g", goalType: "note",
        status: "active", createdAt: 1, lastAdvancedAt: 1,
      });
      const sid = await ctx.db.insert("training_path_steps", {
        pathId: pid, position: 1, state: "completed",
        prescription: "p", wizardLine: "w",
        details: { why: "", how: [], pitfalls: [] },
        targetSport: "BJJ", expectedSessions: 1, completedAt: Date.now(),
      });
      return { pathId: pid, stepId: sid };
    });
    await t
      .withIdentity({ subject: userId })
      .mutation(api.training_paths.submitStepFeedback, {
        stepId,
        feedback: "off",
      });
    const step = await t.run((ctx) => ctx.db.get(stepId));
    expect(step?.completedFeedback).toBe("off");
    const fbRows = await t.run((ctx) =>
      ctx.db
        .query("training_path_feedback")
        .withIndex("by_path_at", (q) => q.eq("pathId", pathId))
        .collect(),
    );
    expect(fbRows.length).toBe(1);
    expect(fbRows[0].feedback).toBe("off");
  });
});
