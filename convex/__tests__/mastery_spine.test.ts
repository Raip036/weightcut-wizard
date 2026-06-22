/**
 * Task 4.1 — Mastery Spine state-machine tests
 *
 * Covers:
 *   1. Mission complete with siblings → allMissionsComplete === false
 *   2. Last mission completes → allMissionsComplete === true
 *   3. Untick re-seals the cycle (getMasteryFlow phase → "drill")
 *   4. markLanded ×3 → mastery + cycle bonus once; 4th call is no-op
 *   5. Frozen cycle guard: generateMissionIfReady returns cycle_in_progress
 *   6. Non-Pro: getMissionFeatureStatus.isPro === false
 *
 * IMPORTANT: graduateCycleToSparring is an LLM action — never call it or
 * finishInProgressScheduledFunctions in tests where allMissionsComplete is
 * true (that would schedule it). Only finish scheduled functions when only
 * pure DB internalMutations (awardXp) are in the queue.
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Seed a Convex user + profile. `tier="pro"` uses the bounded-expiry shape
 *  required by effectiveTier (premium_annual + future expiry). */
async function seedUser(
  t: ReturnType<typeof convexTest>,
  tier: "pro" | "free" = "pro",
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
      targetDate: "2026-12-01",
      activityLevel: "active",
      goalType: "performance",
      role: "fighter",
      subscriptionTier: tier === "pro" ? "premium_annual" : "free",
      ...(tier === "pro"
        ? { subscriptionExpiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 }
        : {}),
    } as any);
    return userId;
  });
}

/** Insert a training_mission with N items (all uncompleted by default).
 *  Returns { missionId, itemIds }. */
async function seedMission(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  opts: {
    sport?: string;
    cycleId?: string;
    itemCount?: number;
    status?: "active" | "completed";
  } = {},
): Promise<{ missionId: Id<"training_missions">; itemIds: Id<"training_mission_items">[] }> {
  const now = Date.now();
  return await t.run(async (ctx) => {
    const sport = opts.sport ?? "BJJ";
    const missionId = await ctx.db.insert("training_missions", {
      userId,
      sport,
      status: opts.status ?? "active",
      title: "Test Mission",
      rationale: "For testing purposes.",
      sourceSessionIds: [],
      notesWindowStart: now,
      createdAt: now,
      lastActivityAt: now,
      cycleId: opts.cycleId,
    } as any);

    const count = opts.itemCount ?? 2;
    const itemIds: Id<"training_mission_items">[] = [];
    for (let i = 0; i < count; i++) {
      const itemId = await ctx.db.insert("training_mission_items", {
        missionId,
        position: i,
        text: `Drill item ${i + 1}`,
        completed: false,
      } as any);
      itemIds.push(itemId);
    }
    return { missionId, itemIds };
  });
}

/** Insert a graduated (non-mastered) sparring assignment row. */
async function seedGraduatedAssignment(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  opts: {
    discipline?: string;
    technique?: string;
    landedCount?: number;
    masteredAt?: number;
  } = {},
): Promise<Id<"sparring_assignments">> {
  const now = Date.now();
  return await t.run(async (ctx) => {
    const discipline = opts.discipline ?? "BJJ";
    const technique = opts.technique ?? "Guillotine Choke";
    return ctx.db.insert("sparring_assignments", {
      userId,
      discipline,
      technique,
      techniqueNormalized: `${discipline.toLowerCase()}::${technique.toLowerCase().replace(/\s+/g, "_")}`,
      whenToUse: "When opponent reaches for a single-leg",
      setups: ["Pummel for inside position"],
      counters: ["Chin-tuck defense"],
      status: "todo",
      sourceFingerprint: "test-fingerprint",
      createdAt: now,
      updatedAt: now,
      source: "graduated",
      landedCount: opts.landedCount ?? 0,
      ...(opts.masteredAt != null ? { masteredAt: opts.masteredAt } : {}),
    } as any);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Mastery Spine state-machine", () => {
  // ── Case 1: Mission complete with siblings remaining → allMissionsComplete false ──

  test("completing all items of one mission when siblings remain returns allMissionsComplete=false", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });
    const cycleId = "BJJ:test-cycle-1";

    // Mission A: 2 items (we will complete both)
    const { itemIds: itemsA } = await seedMission(t, userId, {
      sport: "BJJ",
      cycleId,
      itemCount: 2,
    });

    // Mission B: 1 item (still active — sibling)
    await seedMission(t, userId, { sport: "BJJ", cycleId, itemCount: 1 });

    // Complete first item of mission A
    const r1 = await asUser.mutation(api.training_missions.markItemCompleted, {
      itemId: itemsA[0],
      completed: true,
    });
    expect(r1.allMissionsComplete).toBe(false);
    expect(r1.missionCompleted).toBe(false);

    // Complete second (last) item of mission A
    const r2 = await asUser.mutation(api.training_missions.markItemCompleted, {
      itemId: itemsA[1],
      completed: true,
    });
    expect(r2.missionCompleted).toBe(true);
    // Mission B still active → allMissionsComplete must be false
    expect(r2.allMissionsComplete).toBe(false);
  });

  // ── Case 2: Last mission completes → allMissionsComplete true ────────────

  test("completing the last active mission's last item returns allMissionsComplete=true", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });
    const cycleId = "BJJ:test-cycle-2";

    // Only ONE active mission for this discipline
    const { itemIds } = await seedMission(t, userId, {
      sport: "BJJ",
      cycleId,
      itemCount: 1,
    });

    const result = await asUser.mutation(api.training_missions.markItemCompleted, {
      itemId: itemIds[0],
      completed: true,
    });

    expect(result.missionCompleted).toBe(true);
    expect(result.allMissionsComplete).toBe(true);

    // The mission row must now be archived (status "completed")
    const missionRow = await t.run(async (ctx) =>
      ctx.db
        .query("training_missions")
        .withIndex("by_user_sport_status", (q) =>
          q.eq("userId", userId).eq("sport", "BJJ").eq("status", "active"),
        )
        .first(),
    );
    expect(missionRow).toBeNull();
  });

  // ── Case 3: Untick re-seals → getMasteryFlow phase becomes "drill" ────────

  test("unticking an item of a completed mission re-opens it; getMasteryFlow phase → drill", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });
    const cycleId = "BJJ:test-cycle-3";

    // Seed a mission with 1 item and complete it first
    const { missionId, itemIds } = await seedMission(t, userId, {
      sport: "BJJ",
      cycleId,
      itemCount: 1,
    });

    // Complete the mission
    await asUser.mutation(api.training_missions.markItemCompleted, {
      itemId: itemIds[0],
      completed: true,
    });

    // Verify mission is now "completed"
    const completedMission = await t.run((ctx) => ctx.db.get(missionId));
    expect(completedMission?.status).toBe("completed");

    // Also seed a graduated sparring assignment so the discipline would
    // otherwise show "spar" if no active drill missions existed.
    await seedGraduatedAssignment(t, userId, { discipline: "BJJ" });

    // getMasteryFlow should show "spar" (no active drill missions, but has assignment)
    const flowBefore = await asUser.query(api.mastery_spine.getMasteryFlow, {});
    const bjjBefore = flowBefore.find((e) => e.discipline === "BJJ");
    expect(bjjBefore?.phase).toBe("spar");

    // Now UNTICK the item → the mission re-opens to "active"
    const untickResult = await asUser.mutation(api.training_missions.markItemCompleted, {
      itemId: itemIds[0],
      completed: false,
    });
    expect(untickResult.missionCompleted).toBe(false);

    // Mission should be active again
    const reopenedMission = await t.run((ctx) => ctx.db.get(missionId));
    expect(reopenedMission?.status).toBe("active");

    // getMasteryFlow should now show "drill" (active mission has incomplete items)
    const flowAfter = await asUser.query(api.mastery_spine.getMasteryFlow, {});
    const bjjAfter = flowAfter.find((e) => e.discipline === "BJJ");
    expect(bjjAfter?.phase).toBe("drill");
  });

  // ── Case 4: markLanded ×3 → mastery + cycle bonus once ────────────────────

  test("markLanded ×3 sets mastered, cycleComplete; 4th call is no-op; XP = 3×15 + 50", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });

    // ONE graduated, non-mastered assignment
    const assignmentId = await seedGraduatedAssignment(t, userId, {
      discipline: "BJJ",
      technique: "Arm Bar",
      landedCount: 0,
    });

    // Land 1
    const r1 = await asUser.mutation(api.mastery_spine.markLanded, { assignmentId });
    expect(r1.landedCount).toBe(1);
    expect(r1.mastered).toBe(false);
    expect(r1.cycleComplete).toBe(false);

    // Land 2
    const r2 = await asUser.mutation(api.mastery_spine.markLanded, { assignmentId });
    expect(r2.landedCount).toBe(2);
    expect(r2.mastered).toBe(false);
    expect(r2.cycleComplete).toBe(false);

    // Land 3 → mastery + cycle bonus (only graduated assignment, so cycle done)
    const r3 = await asUser.mutation(api.mastery_spine.markLanded, { assignmentId });
    expect(r3.landedCount).toBe(3);
    expect(r3.mastered).toBe(true);
    expect(r3.cycleComplete).toBe(true);

    // masteredAt must be set on the row
    const row = await t.run((ctx) => ctx.db.get(assignmentId));
    expect(row?.masteredAt).not.toBeNull();
    expect(typeof row?.masteredAt).toBe("number");

    // The assignment should appear in getMasteredTechniques
    const mastered = await asUser.query(api.mastery_spine.getMasteredTechniques, {});
    expect(mastered.some((a) => a._id === assignmentId)).toBe(true);

    // The assignment should be GONE from getMasteryFlow (mastered → excluded)
    const flow = await asUser.query(api.mastery_spine.getMasteryFlow, {});
    const bjj = flow.find((e) => e.discipline === "BJJ");
    const activeSparringAssignments = bjj?.assignments ?? [];
    expect(activeSparringAssignments.some((a) => a._id === assignmentId)).toBe(false);

    // 4th land → no-op guard; mastered already, no increment
    const r4 = await asUser.mutation(api.mastery_spine.markLanded, { assignmentId });
    expect(r4.mastered).toBe(true);
    expect(r4.cycleComplete).toBe(false); // no-op returns false
    const rowAfter4th = await t.run((ctx) => ctx.db.get(assignmentId));
    expect(rowAfter4th?.landedCount).toBe(3); // unchanged

    // ── XP math: 3 × 15 (lands) + 50 (cycle bonus) = 95 ──────────────────
    // The scheduler fires via setTimeout(fn, 0). We must advance fake timers
    // to fire the callbacks and then wait for the in-flight promises.
    // Only awardXp (internalMutation, pure DB) is scheduled here — no network.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const xpRow = await t.run(async (ctx) =>
      ctx.db
        .query("user_discipline_xp")
        .withIndex("by_user_sport", (q) =>
          q.eq("userId", userId).eq("sport", "BJJ"),
        )
        .first(),
    );
    expect(xpRow).not.toBeNull();
    // 3 lands × 15 XP + 1 cycle bonus × 50 XP = 95 total
    expect(xpRow!.totalXp).toBe(95);

    vi.useRealTimers();
  });

  // ── Case 5: Frozen cycle guard ─────────────────────────────────────────────

  test("generateMissionIfReady returns cycle_in_progress when an active mission exists", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    // Seed ONE active mission for BJJ
    await seedMission(t, userId, { sport: "BJJ", itemCount: 1 });

    // The frozen-cycle guard fires BEFORE any Groq call → safe to call
    const result = await t.action(
      internal.actions.trainingMissions.generate.generateMissionIfReady,
      { userId, sport: "BJJ" },
    );

    expect(result).toEqual({ skipped: "cycle_in_progress" });

    // No new missions should have been created
    const missions = await t.run(async (ctx) =>
      ctx.db
        .query("training_missions")
        .withIndex("by_user_sport_status", (q) =>
          q.eq("userId", userId).eq("sport", "BJJ").eq("status", "active"),
        )
        .collect(),
    );
    // Still only the one we seeded
    expect(missions.length).toBe(1);
  });

  // ── Case 6: Non-Pro ────────────────────────────────────────────────────────

  test("getMissionFeatureStatus returns isPro=false for a non-Pro user", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "free");
    const asUser = t.withIdentity({ subject: userId });

    const status = await asUser.query(api.training_missions.getMissionFeatureStatus, {});
    expect(status.isPro).toBe(false);
  });

  test("non-Pro user has no graduated assignments visible in getMasteredTechniques", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "free");
    const asUser = t.withIdentity({ subject: userId });

    // Seed a graduated assignment row for the free user
    await seedGraduatedAssignment(t, userId, {
      discipline: "BJJ",
      technique: "Triangle Choke",
    });

    // getMasteredTechniques is an authenticated query — returns empty (no mastered rows)
    // since the non-mastered assignment has masteredAt = undefined
    const mastered = await asUser.query(api.mastery_spine.getMasteredTechniques, {});
    expect(mastered).toEqual([]);

    // getMasteryFlow still works (no Pro gate on the query itself) but
    // returns the assignment in "spar" phase (no active missions, has assignment)
    const flow = await asUser.query(api.mastery_spine.getMasteryFlow, {});
    const bjj = flow.find((e) => e.discipline === "BJJ");
    expect(bjj?.phase).toBe("spar");

    // markLanded itself has no Pro gate — it is a landing event, not AI generation.
    // The code path we care about: getMissionFeatureStatus.isPro === false.
    // This is the primary Pro-gate used by the widget UI.
  });
});
