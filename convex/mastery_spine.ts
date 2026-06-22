import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUserId } from "./lib/auth";
import { SANDC, REST, normalizeLegacySession } from "./lib/sessionTypes";

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
  phase: "drill" | "graduating" | "spar" | "generating" | "idle";
  missions: MissionWithItems[];
  assignments: Doc<"sparring_assignments">[];
};

/**
 * Unified query powering the MasterySpine widget.
 *
 * Returns one entry per discipline that is in an active or transitional
 * mastery phase. The backend derives the phase so the client never needs
 * to compute it from raw data.
 *
 * Phase rules (per discipline, evaluated in priority order):
 *   "drill"      — any active mission has at least one incomplete item
 *   "graduating" — no active missions, but ≥1 completed mission with
 *                  graduatedAt == null (graduation action pending/running)
 *   "spar"       — non-mastered graduated assignments exist (drilling done,
 *                  sparring cycle live)
 *   "generating" — newest noted session for this discipline is newer than
 *                  the latest mission's notesWindowStart (or no mission at
 *                  all), and none of the above apply — initial generation
 *                  is pending. Martial-art disciplines only.
 *   "idle"       — none of the above (excluded from results)
 *
 * Guarantees:
 *   - Uses indexes only; no .filter() on DB queries.
 *   - All reads are bounded (take / collect over index-scoped sets).
 *   - Mission items loaded in parallel per active mission.
 *   - "generating" detection: take(50) on by_user_date (desc) + ≤N
 *     indexed point-lookups, one per distinct martial-art discipline seen.
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

    // ── 2. Completed missions that haven't graduated yet ───────────────────
    // "graduating" phase: status:"completed" + graduatedAt == null.
    // Uses the by_user_status index; the graduatedAt filter is in-process
    // (bounded: collect over one user's completed missions — typically small).
    const completedMissions = await ctx.db
      .query("training_missions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "completed"),
      )
      .collect();

    // Group pending-graduation missions by sport.
    const pendingGraduationBySport = new Map<string, MissionWithItems[]>();
    for (const m of completedMissions) {
      if (m.graduatedAt == null) {
        // Items are not needed for display in the graduating phase, but we
        // include the mission doc (with empty items) to match the return type
        // and give the UI context (title, rationale).
        const existing = pendingGraduationBySport.get(m.sport) ?? [];
        existing.push({ ...m, items: [] });
        pendingGraduationBySport.set(m.sport, existing);
      }
    }

    // ── 3. Non-mastered graduated assignments ──────────────────────────────
    // Use the by_user index — bounded read since a typical user has <100
    // assignments total. Narrow to graduated + unmastered in JS.
    const allAssignments = await ctx.db
      .query("sparring_assignments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(200);

    const activeAssignments = allAssignments.filter(
      (a) => a.source === "graduated" && a.masteredAt == null,
    );

    // ── 4. Build discipline map from drills, graduating, and spar ─────────
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

    // Seed graduating disciplines so they show even without active missions.
    for (const [sport] of pendingGraduationBySport) {
      ensureEntry(sport);
    }

    for (const a of activeAssignments) {
      ensureEntry(a.discipline).assignments.push(a);
    }

    // ── 5. "generating" phase detection ────────────────────────────────────
    // Detects the empty→drills gap: notes have been logged for a discipline
    // but the first mission hasn't been generated yet (or the watermark
    // hasn't been consumed yet).
    //
    // Strategy (bounded):
    //   a) Scan the most-recent 50 fight_camp_calendar rows for this user
    //      (by_user_date index, desc). This covers ~6–8 weeks of typical
    //      fighters (5-7 sessions/week).
    //   b) Identify distinct martial-art disciplines among those rows that
    //      have non-empty notes or techniquesNotes.
    //   c) For each candidate discipline NOT already in disciplineMap, do
    //      ONE indexed lookup of the latest mission watermark
    //      (by_user_sport_status collect for the sport, pick most recent).
    //      If no mission exists, OR if the newest noted session's
    //      _creationTime > latest mission's notesWindowStart, include as
    //      "generating".
    //   Skip "S&C" and "Rest" — they never generate missions.

    const NON_MARTIAL_PRIMARY: ReadonlySet<string> = new Set([SANDC, REST]);

    // Take recent calendar entries — desc by date string (YYYY-MM-DD sorts
    // lexicographically == chronologically). Bounded at 50 rows.
    const recentCalendar = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);

    // Build: sport → newest _creationTime of a row with notes.
    const newestNotedSessionTime = new Map<string, number>();
    for (const row of recentCalendar) {
      const hasNotes =
        (typeof row.notes === "string" && row.notes.trim().length > 0) ||
        (typeof row.techniquesNotes === "string" &&
          row.techniquesNotes.trim().length > 0);
      if (!hasNotes) continue;
      const primary = normalizeLegacySession(row.sessionType, row.sessionTag).primary;
      if (NON_MARTIAL_PRIMARY.has(primary)) continue;
      const existing = newestNotedSessionTime.get(primary);
      if (existing == null || row._creationTime > existing) {
        newestNotedSessionTime.set(primary, row._creationTime);
      }
    }

    // For disciplines with notes that are NOT already in the discipline map
    // (i.e. no active mission, no graduating mission, no assignments), check
    // whether their watermark is behind the newest noted session.
    const generatingCandidates: string[] = [];
    for (const [sport, newestTime] of newestNotedSessionTime) {
      if (disciplineMap.has(sport)) continue; // already handled by drill/graduating/spar

      // Look up the latest mission for this sport (any status).
      const sportMissions = await ctx.db
        .query("training_missions")
        .withIndex("by_user_sport_status", (q) =>
          q.eq("userId", userId).eq("sport", sport),
        )
        .collect();

      if (sportMissions.length === 0) {
        // No mission at all — generation hasn't run yet.
        generatingCandidates.push(sport);
      } else {
        // Find the mission with the highest watermark.
        const latestWatermark = Math.max(
          ...sportMissions.map((m) => m.notesWindowStart),
        );
        if (newestTime > latestWatermark) {
          // Newest noted session is beyond the consumed watermark — generation
          // is pending (or running).
          generatingCandidates.push(sport);
        }
      }
    }

    // ── 6. Derive phase per discipline and build result ────────────────────
    const result: MasteryFlowEntry[] = [];

    // Phase priority: drill → graduating → spar, then "generating" separately.
    for (const [discipline, { missions, assignments }] of disciplineMap) {
      const hasIncompleteDrill = missions.some((m) =>
        m.items.some((item) => !item.completed),
      );

      let phase: "drill" | "graduating" | "spar" | "generating" | "idle";

      if (hasIncompleteDrill) {
        phase = "drill";
      } else {
        const pendingGrad = pendingGraduationBySport.get(discipline) ?? [];
        if (pendingGrad.length > 0) {
          phase = "graduating";
        } else if (assignments.length > 0) {
          phase = "spar";
        } else {
          phase = "idle";
        }
      }

      if (phase === "idle") continue; // exclude idle disciplines

      // For graduating phase, surface the pending-graduation missions rather
      // than the (empty) active-mission list.
      const phaseMissions =
        phase === "graduating"
          ? (pendingGraduationBySport.get(discipline) ?? [])
          : missions;

      result.push({ discipline, phase, missions: phaseMissions, assignments });
    }

    // Add "generating" entries (always have no missions / assignments yet).
    for (const sport of generatingCandidates) {
      result.push({ discipline: sport, phase: "generating", missions: [], assignments: [] });
    }

    // ── 7. Sort: drill/graduating first, then spar, then generating ────────
    const PHASE_ORDER: Record<MasteryFlowEntry["phase"], number> = {
      drill: 0,
      graduating: 1,
      spar: 2,
      generating: 3,
      idle: 4,
    };
    result.sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase]);

    return result;
  },
});
