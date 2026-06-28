/**
 * TDD tests for the getCampCompletionPrompt query.
 *
 * Bug: brand-new users (maintaining/losing goal_type, zero fight_camps) were
 * greeted with the "start your next camp" overlay right after onboarding.
 *
 * Fix: add a camps.length === 0 guard in the next_camp branch so the overlay
 * is never shown to users who have never had a camp.
 */
import { describe, test, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

async function seedUser(
  t: ReturnType<typeof convexTest>,
  opts: {
    goalType?: string;
    nextCampNudgeShownAt?: number;
  } = {},
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {} as any);
    await ctx.db.insert("profiles", {
      userId,
      age: 28,
      sex: "M",
      heightCm: 175,
      currentWeightKg: 77,
      goalWeightKg: 73,
      activityLevel: "active",
      goalType: opts.goalType ?? "maintaining",
      role: "fighter",
      subscriptionTier: "free",
      ...(opts.nextCampNudgeShownAt !== undefined
        ? { nextCampNudgeShownAt: opts.nextCampNudgeShownAt }
        : {}),
    } as any);
    return userId;
  });
}

async function seedCamp(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  fightDate: string,
  extra: { isCompleted?: boolean; completionOverlayShownAt?: number } = {},
): Promise<Id<"fight_camps">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("fight_camps", {
      userId,
      name: "Test Camp",
      fightDate,
      updatedAt: Date.now(),
      ...extra,
    } as any),
  );
}

describe("getCampCompletionPrompt", () => {
  test("brand-new maintaining user with ZERO camps returns null (no 'next camp' takeover)", async () => {
    // BUG: before fix this returns { kind: "next_camp" }
    const t = convexTest(schema);
    const userId = await seedUser(t, { goalType: "maintaining" });
    // No fight_camps rows at all.
    const asUser = t.withIdentity({ subject: userId });

    const result = await asUser.query(api.campCompletion.getCampCompletionPrompt, {});
    expect(result).toBeNull();
  });

  test("fighter with ONE completed past camp and no cooldown returns next_camp", async () => {
    // Regression: the greeting must still fire for users who actually had a camp.
    const t = convexTest(schema);
    // nudgeShownAt older than 7 days (well in the past) so cooldown does not block.
    const eightyDaysAgo = Date.now() - 80 * 24 * 60 * 60 * 1000;
    const userId = await seedUser(t, {
      goalType: "cutting",
      nextCampNudgeShownAt: eightyDaysAgo,
    });
    // Past camp, already completed, completionOverlayShownAt set so it is NOT
    // a pending wrapup — we want to exercise the next_camp branch only.
    const pastFightDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await seedCamp(t, userId, pastFightDate, {
      isCompleted: true,
      completionOverlayShownAt: Date.now() - 25 * 24 * 60 * 60 * 1000,
    });

    const asUser = t.withIdentity({ subject: userId });
    const result = await asUser.query(api.campCompletion.getCampCompletionPrompt, {});
    expect(result).toEqual({ kind: "next_camp" });
  });
});
