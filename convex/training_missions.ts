import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUserId } from "./lib/auth";
import { effectiveTier } from "./_shared/tier";
import { resolveActiveCampId } from "./fight_camp";

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
 * mission completed, archive the mission and schedule graduation if all
 * missions in the cycle are now complete.
 *
 * Returns `missionCompleted: true` to the caller so the UI can fire the
 * Mission Complete dialog immediately, rather than waiting on a re-query
 * round-trip. Also returns `allMissionsComplete: true` when every active
 * mission for this discipline has been finished (cycle graduation fires).
 */
export const markItemCompleted = mutation({
  args: {
    itemId: v.id("training_mission_items"),
    // Optional — defaults to `true` (tick). Pass `false` to untick an
    // item the user accidentally ticked. Unticking never schedules
    // graduation; it re-opens the mission to active.
    completed: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { itemId, completed: rawCompleted },
  ): Promise<{
    missionCompleted: boolean;
    xpAwarded: number;
    allMissionsComplete: boolean;
  }> => {
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
        allMissionsComplete: false,
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

    // Auto-archive the mission once every item is ticked, so it falls
    // out of `getActiveMissions` and the widget stops showing it as soon
    // as the user clears the celebration dialog. Unticking the last item
    // re-opens the mission so the user can finish it again.
    if (completed && missionCompleted && mission.status === "active") {
      await ctx.db.patch(mission._id, {
        status: "completed",
        completedAt: now,
      });
    } else if (!completed && mission.status === "completed") {
      await ctx.db.patch(mission._id, {
        status: "active",
        completedAt: undefined,
      });
    }

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
            campId: mission.campId,
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
              campId: mission.campId,
              amount: 100,
              reason: "complete_mission",
            },
          );
        }
      } catch (err) {
        console.warn("training_missions: xp schedule failed", err);
      }
    }

    // ── Aggregate gate + graduation schedule ──────────────────────────────
    // Only runs on the completing tick (missionCompleted true, completed true).
    // Untick must NOT schedule graduation — it re-opens the mission to active
    // (handled above) so the cycle stays in progress.
    let allMissionsComplete = false;
    if (completed && missionCompleted) {
      // At this point the mission has been archived to status:"completed"
      // (the patch above). Query remaining ACTIVE missions for (userId, sport)
      // to see if this was the last one in the cycle.
      const remaining = await ctx.db
        .query("training_missions")
        .withIndex("by_user_sport_status", (q) =>
          q.eq("userId", userId).eq("sport", mission.sport).eq("status", "active"),
        )
        .take(1);

      allMissionsComplete = remaining.length === 0;

      if (allMissionsComplete) {
        if (mission.cycleId != null) {
          try {
            await ctx.scheduler.runAfter(
              0,
              internal.actions.trainingMissions.graduate.graduateCycleToSparring,
              {
                userId,
                discipline: mission.sport,
                cycleId: mission.cycleId,
              },
            );
          } catch (err) {
            console.warn("training_missions: graduation schedule failed", err);
          }
        } else {
          // Legacy mission without a cycleId — skip graduation gracefully.
          console.warn(
            "training_missions: cycle complete but mission has no cycleId — graduation skipped",
            { missionId: mission._id },
          );
        }
      }
    }

    return { missionCompleted, xpAwarded, allMissionsComplete };
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
 * Recent mission history for a (user, sport), newest first, with each
 * mission's items projected down to {text, completed}. Feeds the generator's
 * "PRIOR MISSIONS" prompt block so a new mission PROGRESSES the work instead
 * of re-issuing drills the athlete already completed (improvement #2).
 */
export const getRecentMissionHistory = internalQuery({
  args: { userId: v.id("users"), sport: v.string(), limit: v.number() },
  handler: async (
    ctx,
    { userId, sport, limit },
  ): Promise<
    Array<{
      title: string;
      rationale: string;
      status: string;
      createdAt: number;
      items: Array<{ text: string; completed: boolean }>;
    }>
  > => {
    const missions = await ctx.db
      .query("training_missions")
      .withIndex("by_user_sport_status", (q) =>
        q.eq("userId", userId).eq("sport", sport),
      )
      .collect();
    if (missions.length === 0) return [];

    missions.sort((a, b) => b.createdAt - a.createdAt);
    const recent = missions.slice(0, Math.max(0, limit));

    return await Promise.all(
      recent.map(async (m) => {
        const items = await ctx.db
          .query("training_mission_items")
          .withIndex("by_mission_position", (q) => q.eq("missionId", m._id))
          .collect();
        items.sort((a, b) => a.position - b.position);
        return {
          title: m.title,
          rationale: m.rationale,
          status: m.status,
          createdAt: m.createdAt,
          items: items.map((it) => ({
            text: it.text,
            completed: it.completed,
          })),
        };
      }),
    );
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
    focusTechnique: v.optional(v.string()),
    focusTechniqueNormalized: v.optional(v.string()),
    cycleId: v.optional(v.string()),
    // Strategic objective + pre-generated sparring plan (generated alongside the
    // drills from the same diagnosis). Stored so graduation can reveal the plan
    // deterministically without re-deriving (and inverting) it from the name.
    objective: v.optional(v.string()),
    sparringPlan: v.optional(
      v.object({
        objective: v.string(),
        whenToUse: v.string(),
        setups: v.array(v.string()),
        counters: v.array(v.string()),
        combinations: v.array(v.string()),
      }),
    ),
    // When true, skip the "mark prior active missions completed" step. Used
    // by the Model B batch generator (Task 2.2) which inserts multiple
    // missions sharing one cycleId — the second/third insert must NOT mark
    // the first mission (inserted moments earlier in the same batch) as
    // completed.
    skipMarkPrior: v.optional(v.boolean()),
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
      focusTechnique,
      focusTechniqueNormalized,
      cycleId,
      objective,
      sparringPlan,
      skipMarkPrior,
    },
  ): Promise<Id<"training_missions">> => {
    const now = Date.now();

    // Mark any existing active mission for this (user, sport) as
    // completed — the action only reaches this point if either there
    // was no prior mission or its items were all checked.
    // Skip this step when inserting batch missions that share a cycleId
    // so sibling missions inserted earlier in the same batch are not
    // inadvertently completed.
    if (!skipMarkPrior) {
      const prior = await ctx.db
        .query("training_missions")
        .withIndex("by_user_sport_status", (q) =>
          q.eq("userId", userId).eq("sport", sport).eq("status", "active"),
        )
        .collect();
      for (const p of prior) {
        await ctx.db.patch(p._id, { status: "completed", completedAt: now });
      }
    }

    // Attribute the mission (and the XP it later yields) to the active camp.
    const campId = await resolveActiveCampId(ctx, userId);

    const missionId = await ctx.db.insert("training_missions", {
      userId,
      campId,
      sport,
      status: "active",
      title,
      rationale,
      sourceSessionIds,
      notesWindowStart,
      createdAt: now,
      lastActivityAt: now,
      focusTechnique,
      focusTechniqueNormalized,
      cycleId,
      objective,
      sparringPlan,
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

// ── Model B helpers (Task 2.2) ────────────────────────────────────────────────

/**
 * Returns all active missions for (userId, sport) via the
 * `by_user_sport_status` index. Used by `generateMissionIfReady` for the
 * frozen-cycle guard: if this returns any rows, the current cycle is still
 * in progress and no new generation should start.
 */
export const listActiveMissionsForSport = internalQuery({
  args: { userId: v.id("users"), sport: v.string() },
  handler: async (ctx, { userId, sport }) => {
    return await ctx.db
      .query("training_missions")
      .withIndex("by_user_sport_status", (q) =>
        q.eq("userId", userId).eq("sport", sport).eq("status", "active"),
      )
      .take(1);
  },
});

/**
 * Point-lookup: is there an active mission for (userId, sport) whose
 * `focusTechniqueNormalized` matches the given key?
 *
 * Used by the per-issue dedupe loop in `generateMissionIfReady` as a safety
 * net after the frozen-cycle guard (which already prevents entering if ANY
 * active mission exists). This catches the edge case where two issues in the
 * same batch resolve to the same normalised technique.
 */
export const findActiveMissionByTechnique = internalQuery({
  args: {
    userId: v.id("users"),
    sport: v.string(),
    focusTechniqueNormalized: v.string(),
  },
  handler: async (ctx, { userId, sport, focusTechniqueNormalized }) => {
    // Scan active missions for this sport and check focusTechniqueNormalized.
    // No compound index on (userId, sport, status, focusTechniqueNormalized),
    // so we use the existing by_user_sport_status index and filter in-process.
    // safe: bounded by the frozen-cycle guard to <=3 active missions per
    // (user, sport) — the take(4) gives one slot of headroom while keeping
    // the read explicitly bounded.
    const active = await ctx.db
      .query("training_missions")
      .withIndex("by_user_sport_status", (q) =>
        q.eq("userId", userId).eq("sport", sport).eq("status", "active"),
      )
      .take(4);
    return active.find((m) => m.focusTechniqueNormalized === focusTechniqueNormalized) ?? null;
  },
});

/**
 * Advance a mission's `notesWindowStart` watermark to `to`. Used by the
 * Model B generator's all-deduped path: when every extracted issue is
 * deduped (no mission inserted), we still need to mark the notes window as
 * consumed so the hourly sweep doesn't re-extract the same notes forever.
 * Actions cannot patch the DB directly, hence this internal mutation.
 */
export const advanceNotesWatermark = internalMutation({
  args: {
    missionId: v.id("training_missions"),
    to: v.number(),
  },
  handler: async (ctx, { missionId, to }) => {
    await ctx.db.patch(missionId, { notesWindowStart: to });
  },
});

// ── Mastery Spine helpers (Task 2.4) ──────────────────────────────────────────

/**
 * Stamp `graduatedAt` on a mission so `graduateCycleToSparring` is idempotent.
 * Actions cannot write to the DB directly; this internal mutation bridges that.
 */
export const patchMissionGraduatedAt = internalMutation({
  args: {
    missionId: v.id("training_missions"),
    graduatedAt: v.number(),
  },
  handler: async (ctx, { missionId, graduatedAt }) => {
    await ctx.db.patch(missionId, { graduatedAt });
  },
});

/**
 * Return all missions for a given cycleId, projected to the fields needed by
 * `graduateCycleToSparring`: id, status, graduatedAt, focusTechnique,
 * focusTechniqueNormalized.
 *
 * Uses the `by_user_cycle` index (userId, cycleId). cycleId is optional on
 * the mission row, so a null/missing cycleId will never match and returns [].
 */
export const listCycleMissions = internalQuery({
  args: {
    userId: v.id("users"),
    cycleId: v.string(),
  },
  handler: async (ctx, { userId, cycleId }) => {
    const rows = await ctx.db
      .query("training_missions")
      .withIndex("by_user_cycle", (q) =>
        q.eq("userId", userId).eq("cycleId", cycleId),
      )
      .collect();
    return rows.map((m) => ({
      _id: m._id,
      campId: m.campId ?? null,
      status: m.status,
      graduatedAt: m.graduatedAt ?? null,
      focusTechnique: m.focusTechnique ?? null,
      focusTechniqueNormalized: m.focusTechniqueNormalized ?? null,
      objective: m.objective ?? null,
      sparringPlan: m.sparringPlan ?? null,
    }));
  },
});

/**
 * Read `timesLogged` from `training_techniques` for a given
 * (userId, techniqueNormalized). Returns 0 if no row exists.
 * Used by `graduateCycleToSparring` (Task 2.4).
 */
export const readTimesLogged = internalQuery({
  args: {
    userId: v.id("users"),
    techniqueNormalized: v.string(),
  },
  handler: async (ctx, { userId, techniqueNormalized }): Promise<number> => {
    const row = await ctx.db
      .query("training_techniques")
      .withIndex("by_user_norm", (q) =>
        q.eq("userId", userId).eq("techniqueNormalized", techniqueNormalized),
      )
      .first();
    return row?.timesLogged ?? 0;
  },
});

// ── Graduation self-heal (stuck-cycle detector + reschedule) ──────────────────
//
// Graduation (`graduateCycleToSparring`) is scheduled ONLY from
// `markItemCompleted` when the last drill of a cycle is ticked. Convex does not
// auto-retry a failed scheduled action, so if that run throws (e.g. a Groq
// outage in the legacy path) the discipline is left stuck at phase "spar" with
// completed-but-ungraduated missions and 0 sparring assignments — and nothing
// re-schedules it. The drills path self-heals via the hourly sweep; this is the
// equivalent backstop for graduation.
//
// A cycle is "stuck" when, for a (userId, discipline/sport, campId):
//   • it has graduation-ELIGIBLE completed missions — exactly the filter
//     `graduateCycleToSparring` uses: status "completed", `graduatedAt` unset,
//     `focusTechnique` + `focusTechniqueNormalized` set — plus `cycleId` set
//     (which `markItemCompleted` requires before it ever schedules), AND
//   • NO active mission remains for that discipline (mirrors the
//     `allMissionsComplete` gate in `markItemCompleted` and the client's
//     phase !== "drill").
// `graduatedAt` is stamped by `graduateCycleToSparring` only AFTER it upserts
// each mission's sparring assignment, so an un-graduated eligible mission is by
// definition one with no sparring row yet — i.e. the discipline reads as phase
// "spar" with 0 graduated assignments. Re-running `graduateCycleToSparring` is
// safe: it upserts (dedup by normalised technique) and skips already-graduated
// missions.

/**
 * Find every "stuck graduation" cycle for a single user. Bounded reads only.
 * Returns one `{ discipline, cycleId }` per stuck cycle (deduped by cycleId).
 * Shared by the auth-scoped `retryStuckGraduation` mutation and the cron
 * `graduationSweep` action (via `listStuckGraduationCycles`).
 */
async function collectStuckGraduationCycles(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Array<{ discipline: string; cycleId: string }>> {
  // Completed missions for the user. Bounded — un-graduated ones are the
  // anomaly, so the filter below narrows sharply; the cap keeps the read safe
  // even for a heavy history.
  const completed = await ctx.db
    .query("training_missions")
    .withIndex("by_user_status", (q) =>
      q.eq("userId", userId).eq("status", "completed"),
    )
    .take(500);

  // Group graduation-eligible, un-graduated completed missions by cycleId.
  const byCycle = new Map<string, { discipline: string }>();
  for (const m of completed) {
    if (
      m.graduatedAt == null &&
      m.cycleId != null &&
      m.focusTechnique != null &&
      m.focusTechniqueNormalized != null
    ) {
      if (!byCycle.has(m.cycleId)) {
        byCycle.set(m.cycleId, { discipline: m.sport });
      }
    }
  }
  if (byCycle.size === 0) return [];

  const stuck: Array<{ discipline: string; cycleId: string }> = [];
  // Cache active-mission presence per sport so we don't re-query per cycle.
  const activeBySport = new Map<string, boolean>();
  for (const [cycleId, { discipline }] of byCycle) {
    let hasActive = activeBySport.get(discipline);
    if (hasActive === undefined) {
      const active = await ctx.db
        .query("training_missions")
        .withIndex("by_user_sport_status", (q) =>
          q.eq("userId", userId).eq("sport", discipline).eq("status", "active"),
        )
        .take(1);
      hasActive = active.length > 0;
      activeBySport.set(discipline, hasActive);
    }
    // Still drilling — phase "drill", graduation not yet due. Not stuck.
    if (hasActive) continue;
    stuck.push({ discipline, cycleId });
  }
  return stuck;
}

/**
 * Internal read: stuck-graduation cycles for a user. Called by the cron
 * `graduationSweep` action (which cannot touch the DB directly).
 */
export const listStuckGraduationCycles = internalQuery({
  args: { userId: v.id("users") },
  handler: async (
    ctx,
    { userId },
  ): Promise<Array<{ discipline: string; cycleId: string }>> => {
    return await collectStuckGraduationCycles(ctx, userId);
  },
});

/**
 * Auth-scoped fast heal: the client calls this the moment the Mastery Spine
 * detects a discipline stuck at phase "spar" with 0 assignments, so a stuck
 * graduation resolves on return instead of waiting for the next cron. Runs the
 * SAME detection + reschedule for the CURRENT user only (never accepts a
 * userId). Idempotent — re-running `graduateCycleToSparring` upserts safely.
 */
export const retryStuckGraduation = mutation({
  args: {},
  handler: async (ctx): Promise<{ rescheduled: number }> => {
    const userId = await requireUserId(ctx);
    const stuck = await collectStuckGraduationCycles(ctx, userId);
    let rescheduled = 0;
    for (const { discipline, cycleId } of stuck) {
      try {
        await ctx.scheduler.runAfter(
          0,
          internal.actions.trainingMissions.graduate.graduateCycleToSparring,
          { userId, discipline, cycleId },
        );
        rescheduled += 1;
      } catch (err) {
        console.warn("training_missions.retryStuckGraduation: schedule failed", err);
      }
    }
    return { rescheduled };
  },
});

