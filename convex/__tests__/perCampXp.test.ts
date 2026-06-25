import { describe, test, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

async function seedUser(t: any): Promise<Id<"users">> {
  return await t.run(async (ctx: any) => {
    const userId = await ctx.db.insert("users", {} as any);
    await ctx.db.insert("profiles", {
      userId, age: 28, sex: "M", heightCm: 175, currentWeightKg: 77,
      goalWeightKg: 73, targetDate: "2026-12-01", activityLevel: "active",
      goalType: "performance", role: "fighter", subscriptionTier: "premium_annual",
      subscriptionExpiresAt: Date.now() + 365 * 86400000,
    } as any);
    return userId;
  });
}
async function seedCamp(t: any, userId: Id<"users">, fightDate: string): Promise<Id<"fight_camps">> {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("fight_camps", { userId, name: "C", fightDate, updatedAt: Date.now() } as any));
}

describe("per-camp XP", () => {
  test("same sport in two camps stays independent", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const campA = await seedCamp(t, userId, "2026-09-01");
    const campB = await seedCamp(t, userId, "2026-12-01");
    const asUser = t.withIdentity({ subject: userId });
    // award 100 to A, 30 to B via the internal mutation:
    await t.mutation(internal.user_discipline_xp.awardXp, { userId, sport: "BJJ", campId: campA, amount: 100, reason: "test" });
    await t.mutation(internal.user_discipline_xp.awardXp, { userId, sport: "BJJ", campId: campB, amount: 30, reason: "test" });
    const a = await asUser.query(api.user_discipline_xp.getAllForUser, { campId: campA });
    const b = await asUser.query(api.user_discipline_xp.getAllForUser, { campId: campB });
    expect(a.find((r: any) => r.sport === "BJJ")?.totalXp).toBe(100);
    expect(b.find((r: any) => r.sport === "BJJ")?.totalXp).toBe(30);
  });

  test("re-earning a technique in a new camp creates a fresh assignment (via upsertAssignments)", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const campA = await seedCamp(t, userId, "2026-09-01");
    const campB = await seedCamp(t, userId, "2026-12-01");

    const assignment = {
      technique: "Armbar",
      techniqueNormalized: "bjj::armbar",
      whenToUse: "x",
      setups: [],
      counters: [],
      sourceFingerprint: "fp",
      source: "graduated" as const,
      landedCount: 0,
    };

    // Drive the REAL production dedup path: same techniqueNormalized, but a
    // different campId each time → must NOT dedup across camps.
    await t.mutation(internal.sparring_plan.upsertAssignments, {
      userId, discipline: "BJJ", campId: campA, assignments: [assignment],
    });
    await t.mutation(internal.sparring_plan.upsertAssignments, {
      userId, discipline: "BJJ", campId: campB, assignments: [assignment],
    });

    const all: any[] = await t.run((ctx: any) =>
      ctx.db.query("sparring_assignments")
        .withIndex("by_user", (q: any) => q.eq("userId", userId))
        .collect());
    expect(all.length).toBe(2);
    expect(all.filter((r) => r.campId === campA).length).toBe(1);
    expect(all.filter((r) => r.campId === campB).length).toBe(1);

    // Re-running upsert under the SAME camp must dedup (no third row).
    await t.mutation(internal.sparring_plan.upsertAssignments, {
      userId, discipline: "BJJ", campId: campA, assignments: [assignment],
    });
    const afterRepeat: any[] = await t.run((ctx: any) =>
      ctx.db.query("sparring_assignments")
        .withIndex("by_user", (q: any) => q.eq("userId", userId))
        .collect());
    expect(afterRepeat.length).toBe(2);
  });

  test("backfill stamps active camp on legacy XP rows and is idempotent", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const camp = await seedCamp(t, userId, "2026-12-01");

    // Legacy XP row with no campId.
    const rowId = await t.run((ctx: any) =>
      ctx.db.insert("user_discipline_xp", {
        userId, sport: "BJJ", totalXp: 40, updatedAt: Date.now(),
      } as any));

    // First run → stamps the active camp.
    const r1 = await t.mutation(internal.migrations.backfillCampIdOnXpAndSparring, { cursor: null });
    expect(r1.stamped).toBe(1);
    const afterFirst: any = await t.run((ctx: any) => ctx.db.get(rowId));
    expect(afterFirst.campId).toBe(camp);

    // Second run → already stamped, nothing to do (idempotent).
    const r2 = await t.mutation(internal.migrations.backfillCampIdOnXpAndSparring, { cursor: null });
    expect(r2.stamped).toBe(0);
    const afterSecond: any = await t.run((ctx: any) => ctx.db.get(rowId));
    expect(afterSecond.campId).toBe(camp);
  });

  test("backfill merges a legacy XP row into a colliding camp-scoped row", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const camp = await seedCamp(t, userId, "2026-12-01");

    // Simulate the race: a legacy row (no campId) AND a camp-scoped row that
    // awardXp inserted for the same (user, camp, sport) before backfill ran.
    await t.run((ctx: any) =>
      ctx.db.insert("user_discipline_xp", {
        userId, sport: "BJJ", totalXp: 40, updatedAt: 1000,
      } as any));
    await t.run((ctx: any) =>
      ctx.db.insert("user_discipline_xp", {
        userId, sport: "BJJ", campId: camp, totalXp: 25, updatedAt: 2000,
      } as any));

    const r1 = await t.mutation(internal.migrations.backfillCampIdOnXpAndSparring, { cursor: null });
    expect(r1.merged).toBe(1);
    expect(r1.stamped).toBe(0);

    // Exactly ONE row remains for (user, camp, BJJ) with the summed total.
    const rows: any[] = await t.run((ctx: any) =>
      ctx.db.query("user_discipline_xp")
        .withIndex("by_user_camp_sport", (q: any) =>
          q.eq("userId", userId).eq("campId", camp).eq("sport", "BJJ"))
        .collect());
    expect(rows.length).toBe(1);
    expect(rows[0].totalXp).toBe(65);
    expect(rows[0].updatedAt).toBe(2000);

    // No stray legacy (campId-unset) row left behind.
    const all: any[] = await t.run((ctx: any) =>
      ctx.db.query("user_discipline_xp")
        .withIndex("by_user", (q: any) => q.eq("userId", userId))
        .collect());
    expect(all.length).toBe(1);

    // Re-run is a no-op (idempotent).
    const r2 = await t.mutation(internal.migrations.backfillCampIdOnXpAndSparring, { cursor: null });
    expect(r2.merged).toBe(0);
    expect(r2.stamped).toBe(0);
  });
});
