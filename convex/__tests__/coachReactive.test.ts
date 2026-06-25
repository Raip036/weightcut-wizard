import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

// Tests for the two behaviour-preserving social/coach reactive fixes:
//  1. coach.athleteDetail — wellness soreness join was an N+1 (one .unique()
//     per session); now a single indexed range read + in-memory Map join.
//     These tests pin the JOIN RESULT so the refactor is proven identical.
//  2. feedActivity.unreadActivityCount — per-post engagement collects were
//     unbounded; now capped at DISPLAY_CAP+1 with an early-exit. The bell
//     renders "99+" past 99, so capping is invisible to the UI.

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Minimal valid athlete profile (only required fields + the ones the query reads).
function athleteProfileFields(userId: Id<"users">) {
  return {
    userId,
    age: 28,
    sex: "male",
    heightCm: 178,
    currentWeightKg: 80,
    goalWeightKg: 77,
    targetDate: isoDaysAgo(-30), // 30 days in the future
    activityLevel: "moderate",
    goalType: "cutting",
    role: "fighter" as const,
    subscriptionTier: "free",
    displayName: "Test Athlete",
  };
}

describe("coach.athleteDetail — wellness soreness join (Fix 1)", () => {
  it("joins each recent session to its daily_wellness_checkin by date (null when none)", async () => {
    const t = convexTest(schema);

    const { coachId, athleteId, d1, d2, d3 } = await t.run(async (ctx) => {
      const coachId = await ctx.db.insert("users", {} as any);
      const athleteId = await ctx.db.insert("users", {} as any);

      const gymId = await ctx.db.insert("gyms", {
        name: "Test Gym",
        ownerUserId: coachId, // coach owns the gym → passes access check
        inviteCode: "TESTGYM1",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("gym_members", {
        gymId,
        userId: athleteId,
        memberRole: "athlete",
        status: "active",
        shareData: true,
        joinedAt: Date.now(),
      });
      await ctx.db.insert("profiles", athleteProfileFields(athleteId));

      const d1 = isoDaysAgo(1);
      const d2 = isoDaysAgo(2);
      const d3 = isoDaysAgo(3);
      // Three sessions, all within the 7-day window.
      for (const date of [d1, d2, d3]) {
        await ctx.db.insert("fight_camp_calendar", {
          userId: athleteId,
          date,
          sessionType: "BJJ",
          intensity: "medium",
          durationMinutes: 60,
          rpe: 7,
        });
      }
      // Checkins ONLY on d1 (soreness 5) and d3 (soreness 0). d2 has none.
      await ctx.db.insert("daily_wellness_checkins", {
        userId: athleteId,
        date: d1,
        sleepQuality: 3,
        fatigueLevel: 2,
        sorenessLevel: 5,
        stressLevel: 2,
      });
      await ctx.db.insert("daily_wellness_checkins", {
        userId: athleteId,
        date: d3,
        sleepQuality: 4,
        fatigueLevel: 1,
        sorenessLevel: 0, // explicit 0 must be preserved (not coalesced to null)
        stressLevel: 1,
      });

      return { coachId, athleteId, d1, d2, d3 };
    });

    const res = await t
      .withIdentity({ subject: coachId })
      .query(api.coach.athleteDetail, { athleteUserId: athleteId });

    const byDate = new Map(
      res.recent_sessions.map((s: { date: string; soreness_level: number | null }) => [
        s.date,
        s.soreness_level,
      ]),
    );
    expect(res.recent_sessions.length).toBe(3);
    expect(byDate.get(d1)).toBe(5); // joined
    expect(byDate.get(d2)).toBeNull(); // no checkin → null
    expect(byDate.get(d3)).toBe(0); // explicit 0 preserved
  });
});

describe("feedActivity.unreadActivityCount — bounded per-post reads (Fix 2)", () => {
  async function seedViewerAndPost(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const viewerId = await ctx.db.insert("users", {} as any);
      const gymId = await ctx.db.insert("gyms", {
        name: "Gym",
        ownerUserId: viewerId,
        inviteCode: "GYM00001",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("gym_members", {
        gymId,
        userId: viewerId,
        memberRole: "athlete",
        status: "active",
        shareData: true,
        joinedAt: Date.now(),
      });
      // No lastActivitySeenAt → watermark defaults to 0, so all events count.
      await ctx.db.insert("profiles", {
        ...athleteProfileFields(viewerId),
        displayName: "Viewer",
      });
      const postId = await ctx.db.insert("session_media", {
        userId: viewerId,
        gymId,
        kind: "photo",
        capturedAt: isoDaysAgo(1),
      });
      return { viewerId, gymId, postId };
    });
  }

  it("counts others' likes/comments/reactions and excludes the viewer's own", async () => {
    const t = convexTest(schema);
    const { viewerId, gymId, postId } = await seedViewerAndPost(t);

    await t.run(async (ctx) => {
      const other1 = await ctx.db.insert("users", {} as any);
      const other2 = await ctx.db.insert("users", {} as any);
      // 2 likes by others + 1 self-like (excluded)
      await ctx.db.insert("feed_likes", { postId, postOwnerId: viewerId, userId: other1 });
      await ctx.db.insert("feed_likes", { postId, postOwnerId: viewerId, userId: other2 });
      await ctx.db.insert("feed_likes", { postId, postOwnerId: viewerId, userId: viewerId });
      // 1 comment by another
      await ctx.db.insert("feed_comments", {
        postId,
        postOwnerId: viewerId,
        userId: other1,
        body: "nice",
      });
      // 1 reaction by another (explicit createdAt > 0 watermark)
      await ctx.db.insert("feed_reactions", {
        postId,
        userId: other2,
        key: "fire",
        createdAt: Date.now(),
      });
    });

    const count = await t
      .withIdentity({ subject: viewerId })
      .query(api.feedActivity.unreadActivityCount, { gymId });

    // 2 likes + 1 comment + 1 reaction = 4; the self-like is excluded.
    expect(count).toBe(4);
  });

  it("bounds a viral post's reads at the display cap (count stays >=99 so the bell shows 99+)", async () => {
    const t = convexTest(schema);
    const { viewerId, gymId, postId } = await seedViewerAndPost(t);

    await t.run(async (ctx) => {
      // 130 likes from distinct other users — exceeds the 99 display cap.
      for (let i = 0; i < 130; i++) {
        const other = await ctx.db.insert("users", {} as any);
        await ctx.db.insert("feed_likes", { postId, postOwnerId: viewerId, userId: other });
      }
    });

    const count = await t
      .withIdentity({ subject: viewerId })
      .query(api.feedActivity.unreadActivityCount, { gymId });

    // The per-post read is capped at DISPLAY_CAP+1 = 100 (was unbounded before
    // the fix). The exact value past 99 is never shown — the bell renders 99+.
    expect(count).toBe(100);
    expect(count).toBeGreaterThan(99);
  });
});
