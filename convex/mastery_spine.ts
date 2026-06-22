import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUserId } from "./lib/auth";

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

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

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
 *   (reason: "cycle_complete") and returns `cycleComplete: true`.
 *
 * Returns `{ landedCount, mastered, cycleComplete }`.
 */
export const markLanded = mutation({
  args: { assignmentId: v.id("sparring_assignments") },
  handler: async (
    ctx,
    { assignmentId },
  ): Promise<{ landedCount: number; mastered: boolean; cycleComplete: boolean }> => {
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
        amount: LAND_XP,
        reason: "sparring_land",
      });
    } catch (err) {
      console.warn("mastery_spine: xp schedule failed", err);
    }

    // ── Cycle-complete detection ─────────────────────────────────────────────
    // Only check when THIS land just mastered the row.
    let cycleComplete = false;
    if (mastered) {
      // Use the by_user_discipline index; narrow to graduated+non-mastered in JS
      // (bounded .take avoids full-table scan — typical discipline has <20 rows).
      const siblings = await ctx.db
        .query("sparring_assignments")
        .withIndex("by_user_discipline", (q) =>
          q.eq("userId", userId).eq("discipline", row.discipline),
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
        try {
          await ctx.scheduler.runAfter(0, internal.user_discipline_xp.awardXp, {
            userId,
            sport: row.discipline,
            amount: 50,
            reason: "cycle_complete",
          });
        } catch (err) {
          console.warn("mastery_spine: cycle_complete xp schedule failed", err);
        }
      }
    }

    return { landedCount: nextLandedCount, mastered, cycleComplete };
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
  args: {},
  handler: async (ctx): Promise<Doc<"sparring_assignments">[]> => {
    const userId = await requireUserId(ctx);

    const rows = await ctx.db
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
  phase: "drill" | "spar" | "idle";
  missions: MissionWithItems[];
  assignments: Doc<"sparring_assignments">[];
};

/**
 * Unified query powering the MasterySpine widget.
 *
 * Returns one entry per discipline that has active missions OR non-mastered
 * graduated sparring assignments. The backend derives the phase so the
 * client never needs to compute it from raw data.
 *
 * Phase rules (per discipline):
 *   "drill" — any active mission has at least one incomplete item
 *   "spar"  — no incomplete drill items; non-mastered graduated assignments exist
 *   "idle"  — neither (normally excluded from results; included defensively)
 *
 * Guarantees:
 *   - Uses indexes only; no .filter() on DB queries.
 *   - All reads are bounded (take / collect over index-scoped sets).
 *   - Mission items loaded in parallel per mission.
 */
export const getMasteryFlow = query({
  args: {},
  handler: async (ctx): Promise<MasteryFlowEntry[]> => {
    const userId = await requireUserId(ctx).catch(() => null as unknown as Id<"users">);
    if (!userId) return [];

    // ── 1. Active missions (status "active") with items inline ─────────────
    const activeMissions = await ctx.db
      .query("training_missions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "active"),
      )
      .collect();

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
    // Use the by_user index — bounded read since a typical user has <100
    // assignments total. Narrow to graduated + unmastered in JS.
    const allAssignments = await ctx.db
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

    // ── 4. Derive phase per discipline and build result ────────────────────
    const result: MasteryFlowEntry[] = [];

    for (const [discipline, { missions, assignments }] of disciplineMap) {
      // Derive phase: "drill" if any mission has an incomplete item.
      let phase: "drill" | "spar" | "idle";
      const hasIncompleteDrill = missions.some((m) =>
        m.items.some((item) => !item.completed),
      );
      if (hasIncompleteDrill) {
        phase = "drill";
      } else if (assignments.length > 0) {
        phase = "spar";
      } else {
        phase = "idle";
      }

      result.push({ discipline, phase, missions, assignments });
    }

    return result;
  },
});
