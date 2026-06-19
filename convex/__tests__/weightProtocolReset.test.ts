import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Root-cause test for the recurring "Start over doesn't reset" bug on the
 * Weight Protocol page.
 *
 * The page's only Chapter-1 gate is `!fightPlan` derived from
 * `getCurrentForUser`, and Convex queries are reactive — so IF `clearProtocol`
 * deletes the active camp's fight_plan row, the page MUST fall back to
 * Chapter 1. These tests prove the server reset path works end-to-end, and
 * guard the latent `.unique()` duplicate-row landmine that would otherwise
 * make `getCurrentForUser` THROW (which reads to the user as "nothing reset").
 */

async function seedUserAndCamp(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {} as any);
    const campId = await ctx.db.insert("fight_camps", {
      userId,
      name: "Test Camp",
      fightDate: "2026-07-04",
      isCompleted: false,
    } as any);
    return { userId, campId };
  });
}

async function insertPlan(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  campId: Id<"fight_camps">,
  kind: "fight_plan" | "rehydration",
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("weight_protocols", {
      userId,
      campId,
      kind,
      payload: { days: [] },
      derivedSnapshot: {},
      model: "test",
      createdAt: Date.now(),
    } as any),
  );
}

describe("weight protocol reset (clearProtocol)", () => {
  it("deletes the active camp's fight_plan + rehydration so getCurrentForUser returns null", async () => {
    const t = convexTest(schema);
    const { userId, campId } = await seedUserAndCamp(t);
    await insertPlan(t, userId, campId, "fight_plan");
    await insertPlan(t, userId, campId, "rehydration");
    const asUser = t.withIdentity({ subject: userId });

    const before = await asUser.query(api.weightProtocols.getCurrentForUser, {});
    expect(before?.fightPlan).not.toBeNull();

    const res = await asUser.mutation(api.weightProtocols.clearProtocol, {});
    expect(res.cleared).toBe(true);
    expect(res.deletedFightPlan).toBe(true);
    expect(res.deletedRehydration).toBe(true);

    const after = await asUser.query(api.weightProtocols.getCurrentForUser, {});
    expect(after?.fightPlan ?? null).toBeNull();
    expect(after?.rehydration ?? null).toBeNull();

    const rows = await t.run(async (ctx) =>
      ctx.db.query("weight_protocols").collect(),
    );
    expect(rows.length).toBe(0);
  });

  it("tolerates a duplicate fight_plan row (no .unique() throw) and clears all copies", async () => {
    const t = convexTest(schema);
    const { userId, campId } = await seedUserAndCamp(t);
    await insertPlan(t, userId, campId, "fight_plan");
    await insertPlan(t, userId, campId, "fight_plan"); // duplicate landmine
    const asUser = t.withIdentity({ subject: userId });

    // Must NOT throw even with two rows for the same (user, camp, kind).
    const before = await asUser.query(api.weightProtocols.getCurrentForUser, {});
    expect(before?.fightPlan ?? null).not.toBeNull();

    const res = await asUser.mutation(api.weightProtocols.clearProtocol, {});
    expect(res.deletedFightPlan).toBe(true);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("weight_protocols").collect(),
    );
    expect(rows.length).toBe(0);
  });
});
