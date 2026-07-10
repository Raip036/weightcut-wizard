import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUserId } from "./lib/auth";
import { resolveActiveCampId } from "./fight_camp";

/**
 * Mastery Spine — public surface for the 3-land mastery mechanic.
 *
 * Public mutations:
 *   - markLanded   — increment landedCount by 1; award +15 XP; at 3 set masteredAt
 *
 * Public queries:
 *   - getMasteredTechniques — return mastered assignments (masteredAt != null), newest first
 */

const LAND_THRESHOLD = 3;
const LAND_XP = 15;
const CYCLE_BONUS_XP = 50;

// XP the user actually banked along the way, mirrored here purely so the
// cutscene can total it up. These MUST stay in step with the awards made in
// `training_missions.markItemCompleted` (20 per ticked item, 100 per finished
// mission) and with `LAND_XP` above. Nothing here awards anything.
const ITEM_XP = 20;
const MISSION_XP = 100;
const MASTERY_XP = LAND_XP * LAND_THRESHOLD; // 45 = 3 lands x 15

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Total XP the just-finished mastery cycle yielded, for the cutscene to count
 * up. There is no XP event ledger (`user_discipline_xp` stores running totals
 * only), so we re-derive it from the rows the cycle actually produced:
 *
 *   cycleXp = completedItems   * 20   (tick_item)
 *           + completedMissions * 100  (complete_mission)
 *           + masteredAssignments * 45 (3 lands x 15)
 *           + 50                       (cycle_complete bonus)
 *
 * Real counts only: never assume 3 items per mission or 3 missions per cycle.
 *
 * Scope. `graduate.ts` stamps `sourceMissionId` on every assignment it creates,
 * so one `get` resolves the mission whose `cycleId` names THIS cycle, and the
 * `by_user_cycle` index gives us its siblings. That matters because a long camp
 * runs several cycles per discipline: a camp-wide count would re-bill every
 * earlier cycle's XP into this one's total. Legacy assignments written before
 * `sourceMissionId` existed fall back to the camp + discipline graduated set,
 * which is the same scope `cycleComplete` itself uses.
 *
 * Bounded reads: <= 20 cycle missions (a notes window fans out to at most 3),
 * <= 50 fallback missions, and one indexed item read per mission. `siblings` is
 * already capped at 100 by the caller.
 */
async function computeCycleXp(
  ctx: MutationCtx,
  userId: Id<"users">,
  row: Doc<"sparring_assignments">,
  siblings: Doc<"sparring_assignments">[],
): Promise<number> {
  const graduatedSiblings = siblings.filter((s) => s.source === "graduated");

  const sourceMission = row.sourceMissionId
    ? await ctx.db.get(row.sourceMissionId)
    : null;
  const cycleId = sourceMission?.cycleId ?? null;

  const candidateMissions = cycleId
    ? await ctx.db
        .query("training_missions")
        .withIndex("by_user_cycle", (q) =>
          q.eq("userId", userId).eq("cycleId", cycleId),
        )
        .take(20)
    : (
        await ctx.db
          .query("training_missions")
          .withIndex("by_user_sport_status", (q) =>
            q
              .eq("userId", userId)
              .eq("sport", row.discipline)
              .eq("status", "completed"),
          )
          // Newest first: an un-graduated mission is minutes old at most, and
          // the current cycle's graduated ones are the freshest rows here.
          .order("desc")
          .take(50)
      ).filter((m) => m.campId === row.campId);

  const graduatedMissions = candidateMissions.filter(
    (m) => m.status === "completed" && m.graduatedAt != null,
  );
  const graduatedMissionIds = new Set<string>(
    graduatedMissions.map((m) => m._id),
  );

  const itemsPerMission = await Promise.all(
    graduatedMissions.map((m) =>
      ctx.db
        .query("training_mission_items")
        .withIndex("by_mission_position", (q) => q.eq("missionId", m._id))
        .collect(),
    ),
  );
  const completedItems = itemsPerMission
    .flat()
    .filter((item) => item.completed).length;

  // Without a cycleId we cannot tell one cycle's assignments from another's,
  // so count the whole camp + discipline graduated set (they are all mastered
  // at this point, which is what made the cycle complete).
  const masteredAssignments = cycleId
    ? graduatedSiblings.filter(
        (s) =>
          s._id === row._id ||
          (s.sourceMissionId != null &&
            graduatedMissionIds.has(s.sourceMissionId)),
      ).length
    : graduatedSiblings.length;

  return (
    completedItems * ITEM_XP +
    graduatedMissions.length * MISSION_XP +
    masteredAssignments * MASTERY_XP +
    CYCLE_BONUS_XP
  );
}

/**
 * Record a single live-sparring landing for the given assignment.
 *
 * - Ownership-checked: throws Forbidden if the row belongs to another user.
 * - No-op guard: if the row is already mastered, returns immediately without
 *   incrementing or awarding XP (prevents double-XP on rapid taps).
 * - Increments `landedCount` by 1 and bumps `updatedAt`.
 * - Schedules +15 XP via `internal.user_discipline_xp.awardXp` (fire-and-forget,
 *   matching `toggleAssignment` pattern — a scheduler hiccup cannot block the tap).
 * - When the new `landedCount >= 3`, sets `masteredAt = Date.now()`.
 *   The row will drop from the active list on the next query tick.
 * - Cycle-complete detection: when THIS land masters the final un-mastered
 *   graduated assignment for (userId, discipline), schedules a +50 XP bonus
 *   (reason: "cycle_complete") and returns `cycleComplete: true` alongside
 *   `cycleXp`: the total the cycle yielded, for the cutscene to count up.
 *   `cycleXp` is a DISPLAY value: it awards nothing, and is omitted when the
 *   cycle is not complete.
 *
 * Returns `{ landedCount, mastered, cycleComplete, cycleXp? }`.
 */
export const markLanded = mutation({
  args: { assignmentId: v.id("sparring_assignments") },
  handler: async (
    ctx,
    { assignmentId },
  ): Promise<{
    landedCount: number;
    mastered: boolean;
    cycleComplete: boolean;
    cycleXp?: number;
  }> => {
    const userId = await requireUserId(ctx);

    const row = await ctx.db.get(assignmentId);
    if (!row) throw new Error("Assignment not found");
    if (row.userId !== userId) throw new Error("Forbidden");

    // ── No-op guard: already mastered ───────────────────────────────────────
    // Prevents landing past 3 and avoids double XP on rapid taps.
    if (row.masteredAt != null) {
      return { landedCount: row.landedCount ?? 0, mastered: true, cycleComplete: false };
    }

    const now = Date.now();
    const nextLandedCount = (row.landedCount ?? 0) + 1;
    const mastered = nextLandedCount >= LAND_THRESHOLD;

    await ctx.db.patch(assignmentId, {
      landedCount: nextLandedCount,
      updatedAt: now,
      ...(mastered && { masteredAt: now }),
    });

    // XP — fire-and-forget so a scheduler/codegen hiccup never blocks the tap.
    try {
      await ctx.scheduler.runAfter(0, internal.user_discipline_xp.awardXp, {
        userId,
        sport: row.discipline,
        campId: row.campId,
        amount: LAND_XP,
        reason: "sparring_land",
      });
    } catch (err) {
      console.warn("mastery_spine: xp schedule failed", err);
    }

    // ── Cycle-complete detection ─────────────────────────────────────────────
    // Only check when THIS land just mastered the row.
    let cycleComplete = false;
    let cycleXp: number | undefined;
    if (mastered) {
      // Scope the sibling scan to THIS row's camp so a technique still pending
      // in another camp can't keep the current camp's cycle from completing.
      // Bounded .take avoids a full-table scan — typical discipline has <20 rows.
      const siblings = await ctx.db
        .query("sparring_assignments")
        .withIndex("by_user_camp_discipline", (q) =>
          q.eq("userId", userId).eq("campId", row.campId).eq("discipline", row.discipline),
        )
        .take(100);

      const remainingUnmastered = siblings.filter(
        (s) =>
          s.source === "graduated" &&
          s.masteredAt == null &&
          s._id !== assignmentId,
      );

      if (remainingUnmastered.length === 0) {
        cycleComplete = true;
        // Display only. It awards nothing; the scheduled bonus below does.
        cycleXp = await computeCycleXp(ctx, userId, row, siblings);
        try {
          await ctx.scheduler.runAfter(0, internal.user_discipline_xp.awardXp, {
            userId,
            sport: row.discipline,
            campId: row.campId,
            amount: CYCLE_BONUS_XP,
            reason: "cycle_complete",
          });
        } catch (err) {
          console.warn("mastery_spine: cycle_complete xp schedule failed", err);
        }
      }
    }

    return { landedCount: nextLandedCount, mastered, cycleComplete, cycleXp };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the current user's mastered sparring assignments (masteredAt != null),
 * newest first, bounded to 50 rows. Uses the `by_user_mastered` index so no
 * in-memory `.filter()` is needed.
 *
 * Convex indexes on optional fields: rows where `masteredAt` is undefined are
 * stored with value `undefined` (sorted before any number). We call `.order("desc")`
 * so the highest-epoch entries (most recently mastered) come first; rows without
 * masteredAt will appear last (effectively absent from meaningful results).
 * Caller can treat any row with `masteredAt != null` as genuinely mastered.
 */
export const getMasteredTechniques = query({
  args: { campId: v.optional(v.id("fight_camps")) },
  handler: async (ctx, { campId }): Promise<Doc<"sparring_assignments">[]> => {
    const userId = await requireUserId(ctx);

    const rows = campId
      ? await ctx.db
          .query("sparring_assignments")
          .withIndex("by_user_camp_mastered", (q) =>
            q.eq("userId", userId).eq("campId", campId),
          )
          .order("desc")
          .take(50)
      : await ctx.db
          .query("sparring_assignments")
          .withIndex("by_user_mastered", (q) => q.eq("userId", userId))
          .order("desc")
          .take(50);

    // Filter out rows that have no masteredAt (undefined sorts before numbers
    // in desc order, so they appear at the end — we strip them here).
    return rows.filter((r) => r.masteredAt != null);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared types for getMasteryFlow
// ─────────────────────────────────────────────────────────────────────────────

type MissionItem = Doc<"training_mission_items">;
type MissionWithItems = Doc<"training_missions"> & { items: MissionItem[] };

export type MasteryFlowEntry = {
  discipline: string;
  phase: "drill" | "graduating" | "spar" | "idle";
  missions: MissionWithItems[];
  assignments: Doc<"sparring_assignments">[];
};

/**
 * Unified query powering the MasterySpine widget.
 *
 * Returns one entry per discipline that has active missions, completed missions
 * still awaiting graduation, OR non-mastered graduated sparring assignments.
 * The backend derives the phase so the client never needs to compute it.
 *
 * Phase rules (per discipline, first match wins):
 *   "drill":      any active mission has at least one incomplete item
 *   "spar":       no incomplete drill items; non-mastered graduated assignments exist
 *   "graduating": the cycle's last drill is ticked and its sparring plan is
 *                 still being generated (completed missions, `graduatedAt` unset)
 *   "idle":       none of the above (normally excluded; included defensively)
 *
 * `spar` outranks `graduating` on purpose: a partially graduated cycle already
 * has assignments to show, so it must render those rather than a loader.
 *
 * Guarantees:
 *   - Uses indexes only; no .filter() on DB queries.
 *   - All reads are bounded (take / collect over index-scoped sets).
 *   - Mission items loaded in parallel per mission.
 */
export const getMasteryFlow = query({
  args: { campId: v.optional(v.id("fight_camps")) },
  handler: async (ctx, { campId }): Promise<MasteryFlowEntry[]> => {
    const userId = await requireUserId(ctx).catch(() => null as unknown as Id<"users">);
    if (!userId) return [];

    // ── 1. Missions, split two ways ────────────────────────────────────────
    //   • active:      the drill list the card renders
    //   • graduating:  completed but `graduatedAt` unset, the window
    //     between the last tick and the sparring plan landing. These keep the
    //     discipline in the flow but are never returned in `entry.missions`,
    //     so the drill list renders empty under the loader.
    let activeMissions: Doc<"training_missions">[];
    let graduatingMissions: Doc<"training_missions">[];

    if (campId) {
      // One read serves both splits. Bounded by the camp's own mission history
      // (a few dozen rows), which is what the active-mission read already
      // collected before the graduating split existed.
      const campMissions = await ctx.db
        .query("training_missions")
        .withIndex("by_user_camp", (q) =>
          q.eq("userId", userId).eq("campId", campId),
        )
        .collect();
      activeMissions = campMissions.filter((m) => m.status === "active");
      graduatingMissions = campMissions.filter(
        (m) => m.status === "completed" && m.graduatedAt == null,
      );
    } else {
      activeMissions = await ctx.db
        .query("training_missions")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", userId).eq("status", "active"),
        )
        .collect();
      // Completed missions accumulate for the life of the account, so this one
      // must be bounded: newest 100. A mission sits un-graduated for seconds
      // (or until the stuck-graduation sweep heals it), so the rows we want are
      // always among the most recent. `.order("desc")` is what makes the take
      // read the newest page rather than the oldest.
      graduatingMissions = (
        await ctx.db
          .query("training_missions")
          .withIndex("by_user_status", (q) =>
            q.eq("userId", userId).eq("status", "completed"),
          )
          .order("desc")
          .take(100)
      ).filter((m) => m.graduatedAt == null);
    }

    // Load items per mission in parallel, sorted by position.
    const missionsWithItems: MissionWithItems[] = await Promise.all(
      activeMissions.map(async (m) => {
        const items = await ctx.db
          .query("training_mission_items")
          .withIndex("by_mission_position", (q) => q.eq("missionId", m._id))
          .collect();
        items.sort((a, b) => a.position - b.position);
        return { ...m, items };
      }),
    );

    // Sort by lastActivityAt descending (most recently active first).
    missionsWithItems.sort((a, b) => b.lastActivityAt - a.lastActivityAt);

    // ── 2. Non-mastered graduated assignments ──────────────────────────────
    // Use the by_user(_camp) index — bounded read since a typical user has
    // <100 assignments total. Narrow to graduated + unmastered in JS.
    const allAssignments = campId
      ? await ctx.db
          .query("sparring_assignments")
          .withIndex("by_user_camp", (q) =>
            q.eq("userId", userId).eq("campId", campId),
          )
          .take(200)
      : await ctx.db
          .query("sparring_assignments")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(200);

    const activeAssignments = allAssignments.filter(
      (a) => a.source === "graduated" && a.masteredAt == null,
    );

    // ── 3. Group by discipline ─────────────────────────────────────────────
    const disciplineMap = new Map<
      string,
      { missions: MissionWithItems[]; assignments: Doc<"sparring_assignments">[] }
    >();

    const ensureEntry = (disc: string) => {
      if (!disciplineMap.has(disc)) {
        disciplineMap.set(disc, { missions: [], assignments: [] });
      }
      return disciplineMap.get(disc)!;
    };

    for (const m of missionsWithItems) {
      ensureEntry(m.sport).missions.push(m);
    }

    for (const a of activeAssignments) {
      ensureEntry(a.discipline).assignments.push(a);
    }

    // Register the graduating disciplines so the card stays mounted while its
    // sparring plan generates. Deliberately NOT pushed into `missions`.
    const graduatingDisciplines = new Set<string>();
    for (const m of graduatingMissions) {
      graduatingDisciplines.add(m.sport);
      ensureEntry(m.sport);
    }

    // ── 4. Derive phase per discipline and build result ────────────────────
    const result: MasteryFlowEntry[] = [];

    for (const [discipline, { missions, assignments }] of disciplineMap) {
      let phase: MasteryFlowEntry["phase"];
      const hasIncompleteDrill = missions.some((m) =>
        m.items.some((item) => !item.completed),
      );
      if (hasIncompleteDrill) {
        phase = "drill";
      } else if (assignments.length > 0) {
        phase = "spar";
      } else if (graduatingDisciplines.has(discipline)) {
        phase = "graduating";
      } else {
        phase = "idle";
      }

      result.push({ discipline, phase, missions, assignments });
    }

    return result;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Generation job markers (reactive "generating…" signal)
// ─────────────────────────────────────────────────────────────────────────────

/** A generation job older than this is treated as stale (crashed/abandoned)
 *  and ignored by `getGenerationStatus`, so the loader never hangs forever. */
const STALE_MS = 3 * 60 * 1000;

const generationKind = v.union(v.literal("drills"), v.literal("sparring"));

/**
 * Mark a mastery-generation job as in-flight for (userId, discipline, kind).
 *
 * Upsert semantics: if a job for the triple already exists, just refresh its
 * `startedAt` (so a re-run resets the stale clock); otherwise insert a fresh
 * row. Called from the generation actions via the scheduler at the start of
 * genuine work — never on an early idempotency-guard return.
 */
export const startGenerationJob = internalMutation({
  args: {
    userId: v.id("users"),
    discipline: v.string(),
    kind: generationKind,
  },
  handler: async (ctx, { userId, discipline, kind }): Promise<null> => {
    // Scope the marker to the active camp so two camps don't share a single
    // "generating…" row. Uses the camp-scoped triple index.
    const campId = await resolveActiveCampId(ctx, userId);
    const existing = await ctx.db
      .query("mastery_generation_jobs")
      .withIndex("by_user_camp_discipline_kind", (q) =>
        q
          .eq("userId", userId)
          .eq("campId", campId)
          .eq("discipline", discipline)
          .eq("kind", kind),
      )
      .take(1);

    const now = Date.now();
    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, { startedAt: now });
    } else {
      await ctx.db.insert("mastery_generation_jobs", {
        userId,
        campId,
        discipline,
        kind,
        startedAt: now,
      });
    }
    return null;
  },
});

/**
 * Clear the in-flight marker for (userId, discipline, kind). Deletes every
 * matching row (there should be at most one, but we sweep defensively).
 * Called from a `finally` in the owning action so the marker is always cleared
 * even when generation throws.
 */
export const endGenerationJob = internalMutation({
  args: {
    userId: v.id("users"),
    discipline: v.string(),
    kind: generationKind,
  },
  handler: async (ctx, { userId, discipline, kind }): Promise<null> => {
    // Clear the marker for the active camp's (discipline, kind). Sweep the
    // camp-scoped index defensively (at most one row expected).
    const campId = await resolveActiveCampId(ctx, userId);
    const rows = await ctx.db
      .query("mastery_generation_jobs")
      .withIndex("by_user_camp_discipline_kind", (q) =>
        q
          .eq("userId", userId)
          .eq("campId", campId)
          .eq("discipline", discipline)
          .eq("kind", kind),
      )
      .take(100);

    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});

/**
 * Reactive signal for the UI: which (discipline, kind) generations are
 * currently in-flight for the authed user. Returns `[]` when unauthed.
 *
 * Robustness: jobs whose `startedAt` is older than STALE_MS are skipped so a
 * crashed generation (that never reached its `finally`) can't make a loader
 * hang forever.
 */
export const getGenerationStatus = query({
  args: { campId: v.optional(v.id("fight_camps")) },
  handler: async (
    ctx,
    { campId },
  ): Promise<Array<{ discipline: string; kind: "drills" | "sparring" }>> => {
    const userId = await requireUserId(ctx).catch(
      () => null as unknown as Id<"users">,
    );
    if (!userId) return [];

    const rows = campId
      ? await ctx.db
          .query("mastery_generation_jobs")
          .withIndex("by_user_camp_discipline_kind", (q) =>
            q.eq("userId", userId).eq("campId", campId),
          )
          .take(100)
      : await ctx.db
          .query("mastery_generation_jobs")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(100);

    const cutoff = Date.now() - STALE_MS;
    return rows
      .filter((r) => r.startedAt >= cutoff)
      .map((r) => ({ discipline: r.discipline, kind: r.kind }));
  },
});

/** Orphan-job pruning window. Well past STALE_MS (3 min, the point
 *  `getGenerationStatus` already ignores a row), so pruning never races a
 *  legitimately in-flight generation. */
const ORPHAN_JOB_MS = 15 * 60 * 1000;

/**
 * Delete orphaned `mastery_generation_jobs` rows whose `startedAt` is older
 * than ORPHAN_JOB_MS. A row should be removed by its owning action's `finally`;
 * this is a backstop for the rare crash that never reached it, so the table
 * doesn't accumulate. Bounded: scans one page of the oldest rows (orphans sort
 * to the front by `_creationTime`); the 15-min cron drains any backlog over
 * successive runs. Called from the graduation sweep.
 */
export const pruneStaleGenerationJobs = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const cutoff = Date.now() - ORPHAN_JOB_MS;
    const rows = await ctx.db.query("mastery_generation_jobs").take(200);
    let deleted = 0;
    for (const r of rows) {
      if (r.startedAt < cutoff) {
        await ctx.db.delete(r._id);
        deleted += 1;
      }
    }
    return { deleted };
  },
});
