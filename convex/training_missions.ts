import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUserId } from "./lib/auth";
import { effectiveTier } from "./_shared/tier";

/**
 * Training Missions — per-discipline AI-generated linear checklists driven
 * by the user's session notes. See
 * `docs/superpowers/specs/2026-05-21-training-missions-design.md`.
 *
 * Public surface (called from React):
 *   - getActiveMissions       — stack of active missions, items inline
 *   - getMissionFeatureStatus — Pro/free state for the widget gating
 *   - markItemCompleted       — tick an item; schedules regen if mission done
 *   - refreshMission          — manual "Generate next mission" button
 *
 * Internal surface (called from the `generateMissionIfReady` action):
 *   - getLatestForSport       — single (user, sport) mission + items
 *   - insertMissionInternal   — atomic persist + prior-mission completion
 */

// ───────────────────────────────────────────────────────────────────────────
// Shared types
// ───────────────────────────────────────────────────────────────────────────

type Mission = Doc<"training_missions">;
type MissionItem = Doc<"training_mission_items">;
type MissionWithItems = Mission & { items: MissionItem[] };

// ───────────────────────────────────────────────────────────────────────────
// Public queries
// ───────────────────────────────────────────────────────────────────────────

/**
 * Active missions for the current user, ordered by last activity (most
 * recently ticked first). Items are included inline so the widget renders
 * with a single round-trip.
 */
export const getActiveMissions = query({
  args: {},
  handler: async (ctx): Promise<MissionWithItems[]> => {
    const userId = await requireUserId(ctx).catch(() => null);
    if (!userId) return [];

    const missions = await ctx.db
      .query("training_missions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "active"),
      )
      .collect();

    // Pull items per mission in parallel; sort by position.
    const enriched = await Promise.all(
      missions.map(async (m) => {
        const items = await ctx.db
          .query("training_mission_items")
          .withIndex("by_mission_position", (q) => q.eq("missionId", m._id))
          .collect();
        items.sort((a, b) => a.position - b.position);
        return { ...m, items };
      }),
    );

    enriched.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    return enriched;
  },
});

/**
 * Pro/free state used by the widget to decide whether to render
 * `<MissionStack />` or `<LockedMissionCard />`. Mirrors the shape of
 * `pathSlotUsage` from the legacy training_paths.ts so the UI's logic is
 * identical.
 */
export const getMissionFeatureStatus = query({
  args: {},
  handler: async (ctx): Promise<{ isPro: boolean }> => {
    const userId = await requireUserId(ctx).catch(() => null);
    if (!userId) return { isPro: false };
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return { isPro: effectiveTier(profile) === "pro" };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Public mutations
// ───────────────────────────────────────────────────────────────────────────

/**
 * Mark one mission item as completed. If this tick makes ALL items in the
 * mission completed, schedule `generateMissionIfReady` so the next mission
 * is created from any notes that have accumulated since this one started.
 *
 * Returns `missionCompleted: true` to the caller so the UI can fire the
 * Mission Complete dialog immediately, rather than waiting on a re-query
 * round-trip.
 */
export const markItemCompleted = mutation({
  args: {
    itemId: v.id("training_mission_items"),
    // Optional — defaults to `true` (tick). Pass `false` to untick an
    // item the user accidentally ticked. Unticking never schedules the
    // generator action; the action is idempotent and self-skips when
    // the prior mission has any incomplete items.
    completed: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { itemId, completed: rawCompleted },
  ): Promise<{ missionCompleted: boolean; xpAwarded: number }> => {
    const userId = await requireUserId(ctx);
    const completed = rawCompleted ?? true;

    const item = await ctx.db.get(itemId);
    if (!item) throw new Error("Item not found");

    const mission = await ctx.db.get(item.missionId);
    if (!mission) throw new Error("Mission not found");
    if (mission.userId !== userId) throw new Error("Forbidden");

    // Idempotent — no-op if the requested state already matches.
    if (item.completed === completed) {
      const allItems = await ctx.db
        .query("training_mission_items")
        .withIndex("by_mission_position", (q) =>
          q.eq("missionId", mission._id),
        )
        .collect();
      return {
        missionCompleted: allItems.every((i) => i.completed),
        xpAwarded: 0,
      };
    }

    const now = Date.now();
    await ctx.db.patch(itemId, {
      completed,
      completedAt: completed ? now : undefined,
    });
    await ctx.db.patch(mission._id, { lastActivityAt: now });

    // Recheck siblings — did this change complete the mission?
    const siblings = await ctx.db
      .query("training_mission_items")
      .withIndex("by_mission_position", (q) => q.eq("missionId", mission._id))
      .collect();
    const missionCompleted = siblings.every(
      (i) => (i._id === itemId ? completed : i.completed),
    );

    // XP — only awarded when ticking INTO completed (never on untick) and
    // only when the mission knows its sport (defensive — should always be
    // set, but skip cleanly if not). Fire-and-forget: schedule with delay
    // 0 so the award lands in a follow-up mutation that can't block the
    // tick.
    let xpAwarded = 0;
    if (completed && mission.sport) {
      xpAwarded = 20 + (missionCompleted ? 100 : 0);
      try {
        await ctx.scheduler.runAfter(
          0,
          internal.user_discipline_xp.awardXp,
          {
            userId,
            sport: mission.sport,
            amount: 20,
            reason: "tick_item",
          },
        );
        if (missionCompleted) {
          await ctx.scheduler.runAfter(
            0,
            internal.user_discipline_xp.awardXp,
            {
              userId,
              sport: mission.sport,
              amount: 100,
              reason: "complete_mission",
            },
          );
        }
      } catch (err) {
        console.warn("training_missions: xp schedule failed", err);
      }
    }

    if (completed && missionCompleted) {
      // Only schedule the generator when transitioning the mission INTO
      // the completed state. Unticking can't trigger generation.
      try {
        await ctx.scheduler.runAfter(
          0,
          internal.actions.trainingMissions.generate.generateMissionIfReady,
          { userId, sport: mission.sport },
        );
      } catch (err) {
        console.warn("training_missions: schedule failed", err);
      }
    }

    return { missionCompleted, xpAwarded };
  },
});

/**
 * Manual "Generate next mission" button. Always safe — the action
 * self-skips when the prior mission is incomplete or there are no new
 * notes. Returns nothing; the widget reacts to the resulting query
 * invalidation.
 */
export const refreshMission = mutation({
  args: { sport: v.string() },
  handler: async (ctx, { sport }): Promise<{ scheduled: true }> => {
    const userId = await requireUserId(ctx);
    try {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.trainingMissions.generate.generateMissionIfReady,
        { userId, sport },
      );
    } catch (err) {
      console.warn("training_missions.refreshMission: schedule failed", err);
    }
    return { scheduled: true };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Internal — called by the generator action
// ───────────────────────────────────────────────────────────────────────────

/**
 * Single (user, sport) lookup — returns the latest mission (any status) plus
 * its items. The action uses this to decide whether to skip, complete, or
 * fall through to generating a new mission.
 */
export const getLatestForSport = internalQuery({
  args: { userId: v.id("users"), sport: v.string() },
  handler: async (
    ctx,
    { userId, sport },
  ): Promise<MissionWithItems | null> => {
    // The by_user_sport_status index is keyed (userId, sport, status) so
    // we can't index-scan "any status" — collect all rows for this pair
    // and pick the most recent. In practice this is at most a few rows
    // per (user, sport) pair (one active + completed history).
    const missions = await ctx.db
      .query("training_missions")
      .withIndex("by_user_sport_status", (q) =>
        q.eq("userId", userId).eq("sport", sport),
      )
      .collect();
    if (missions.length === 0) return null;

    missions.sort((a, b) => b.createdAt - a.createdAt);
    const latest = missions[0];

    const items = await ctx.db
      .query("training_mission_items")
      .withIndex("by_mission_position", (q) => q.eq("missionId", latest._id))
      .collect();
    items.sort((a, b) => a.position - b.position);

    return { ...latest, items };
  },
});

/**
 * Atomic persist: marks any predecessor active mission as `completed`,
 * then inserts the new mission row plus all items at strict positions
 * 0..N-1. Returns the new mission id.
 *
 * The action calls this AFTER validating the Groq response — by the time
 * we land here, the payload is trustworthy.
 */
export const insertMissionInternal = internalMutation({
  args: {
    userId: v.id("users"),
    sport: v.string(),
    title: v.string(),
    rationale: v.string(),
    sourceSessionIds: v.array(v.id("fight_camp_calendar")),
    items: v.array(
      v.object({
        text: v.string(),
        technique: v.optional(v.string()),
        drillType: v.optional(
          v.union(
            v.literal("solo"),
            v.literal("partner"),
            v.literal("live"),
            v.literal("shadow"),
          ),
        ),
        durationMin: v.optional(v.number()),
      }),
    ),
    notesWindowStart: v.number(),
  },
  handler: async (
    ctx,
    {
      userId,
      sport,
      title,
      rationale,
      sourceSessionIds,
      items,
      notesWindowStart,
    },
  ): Promise<Id<"training_missions">> => {
    const now = Date.now();

    // Mark any existing active mission for this (user, sport) as
    // completed — the action only reaches this point if either there
    // was no prior mission or its items were all checked.
    const prior = await ctx.db
      .query("training_missions")
      .withIndex("by_user_sport_status", (q) =>
        q.eq("userId", userId).eq("sport", sport).eq("status", "active"),
      )
      .collect();
    for (const p of prior) {
      await ctx.db.patch(p._id, { status: "completed", completedAt: now });
    }

    const missionId = await ctx.db.insert("training_missions", {
      userId,
      sport,
      status: "active",
      title,
      rationale,
      sourceSessionIds,
      notesWindowStart,
      createdAt: now,
      lastActivityAt: now,
    });

    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      await ctx.db.insert("training_mission_items", {
        missionId,
        position: i,
        text: it.text,
        technique: it.technique,
        drillType: it.drillType,
        durationMin: it.durationMin,
        completed: false,
      });
    }

    return missionId;
  },
});

// ───────────────────────────────────────────────────────────────────────────
// TEMP — visual QA seed. Remove before shipping.
// ───────────────────────────────────────────────────────────────────────────

import { mutation as _mutation } from "./_generated/server";

export const _devSeedSampleMission = _mutation({
  args: { sport: v.optional(v.string()) },
  handler: async (ctx, { sport }): Promise<{ missionId: Id<"training_missions"> }> => {
    const userId = await requireUserId(ctx);
    const sportKey = sport ?? "BJJ";
    const now = Date.now();
    const missionId = await ctx.db.insert("training_missions", {
      userId,
      sport: sportKey,
      status: "active",
      title: "Sharpen guard retention",
      rationale:
        "Notes from your last two sessions flagged frame timing on the second hip escape and a stalled scissor sweep. Here's a progression to lock it in.",
      sourceSessionIds: [],
      notesWindowStart: now,
      createdAt: now,
      lastActivityAt: now,
    });
    const items = [
      { text: "Solo drill: 3x10 reps of the inside-elbow frame on each side", drillType: "solo" as const, durationMin: 10 },
      { text: "Drill scissor sweep from closed guard 3x8 per side with a partner", technique: "scissor sweep", drillType: "partner" as const, durationMin: 15 },
      { text: "Add a hip-bump fake before the scissor sweep to pull a reaction", technique: "scissor sweep", drillType: "partner" as const },
      { text: "Live spar 3 rounds — retain closed guard against passes", drillType: "live" as const, durationMin: 18 },
      { text: "Review one Lachlan Giles guard retention video and journal one takeaway" },
    ];
    for (let i = 0; i < items.length; i += 1) {
      await ctx.db.insert("training_mission_items", {
        missionId,
        position: i,
        text: items[i].text,
        technique: items[i].technique,
        drillType: items[i].drillType,
        durationMin: items[i].durationMin,
        completed: false,
      });
    }
    return { missionId };
  },
});
