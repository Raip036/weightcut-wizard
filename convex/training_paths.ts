/**
 * Queries and mutations for the Training Coach Paths feature.
 *
 * Multi-step improvement paths per technique/combo/goal. Paths advance
 * automatically as `training_technique_logs` rows match a step's target
 * technique. Plateau loop-back and follow-up generation live in the
 * `actions/trainingCoachPlanner.ts` orchestrator; this file is pure CRUD.
 */
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
import { requireUserId } from "./lib/auth";
import { effectiveTier } from "./_shared/tier";

const ACTIVE_CAP = 3 as const;
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export const pathSlotUsage = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const allPaths = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId))
      .collect();
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      active: allPaths.filter((p) => p.status === "active").length,
      max: ACTIVE_CAP,
      queued: allPaths.filter((p) => p.status === "queued").length,
      paused: allPaths.filter((p) => p.status === "paused").length,
      isPro: effectiveTier(profile) === "pro",
    };
  },
});

// ── Proposal CRUD ────────────────────────────────────────────────────

export const getActivePathProposals = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("training_path_proposals")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "pending"),
      )
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const snoozePathProposal = mutation({
  args: { proposalId: v.id("training_path_proposals") },
  handler: async (ctx, { proposalId }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(proposalId);
    if (!row || row.userId !== userId) throw new Error("Not authorized");
    await ctx.db.patch(proposalId, {
      status: "snoozed",
      snoozedUntil: Date.now() + SNOOZE_MS,
    });
  },
});

export const declinePathProposal = mutation({
  args: { proposalId: v.id("training_path_proposals") },
  handler: async (ctx, { proposalId }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(proposalId);
    if (!row || row.userId !== userId) throw new Error("Not authorized");
    await ctx.db.patch(proposalId, {
      status: "declined",
      declineCount: row.declineCount + 1,
    });
  },
});

/** Promotes a pending proposal into an `active` (or `queued`) path and
 *  schedules step generation. Public mutation called from the widget's
 *  PathProposalBanner Accept button. */
export const acceptPathProposal = mutation({
  args: { proposalId: v.id("training_path_proposals") },
  handler: async (ctx, { proposalId }): Promise<Id<"training_paths">> => {
    const userId = await requireUserId(ctx);
    const prop = await ctx.db.get(proposalId);
    if (!prop || prop.userId !== userId) throw new Error("Not authorized");
    const all = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId))
      .collect();
    const status =
      all.filter((p) => p.status === "active").length >= ACTIVE_CAP
        ? "queued"
        : "active";
    const pathId = await ctx.db.insert("training_paths", {
      userId,
      sport: prop.sport,
      goal: prop.technique,
      goalType: "note" as const,
      status,
      createdAt: Date.now(),
      lastAdvancedAt: Date.now(),
    });
    await ctx.db.patch(proposalId, { status: "accepted" });
    await ctx.scheduler.runAfter(
      0,
      // Public action — accessed via `api` so internal `run` calls work even
      // though it's user-callable too (e.g. manualRefresh from the widget).
      api.actions.trainingCoachPlanner.run,
      { trigger: "goalCreated", pathId },
    );
    return pathId;
  },
});

/** Creates a goal-driven path from the conversational NewGoalDialog. */
export const createGoalPath = mutation({
  args: { sport: v.string(), goal: v.string() },
  handler: async (ctx, { sport, goal }): Promise<Id<"training_paths">> => {
    const userId = await requireUserId(ctx);
    if (!goal.trim()) throw new Error("Goal cannot be empty");
    const all = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId))
      .collect();
    const status =
      all.filter((p) => p.status === "active").length >= ACTIVE_CAP
        ? "queued"
        : "active";
    const pathId = await ctx.db.insert("training_paths", {
      userId,
      sport,
      goal: goal.trim(),
      goalType: "goal" as const,
      status,
      createdAt: Date.now(),
      lastAdvancedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      // Public action — accessed via `api` so internal `run` calls work even
      // though it's user-callable too (e.g. manualRefresh from the widget).
      api.actions.trainingCoachPlanner.run,
      { trigger: "goalCreated", pathId },
    );
    return pathId;
  },
});

/** Coach pushes a path to an athlete from /coach/athletes/:id. Doesn't
 *  count against the soft cap (coach intent wins). */
export const prescribePath = mutation({
  args: {
    athleteId: v.id("users"),
    sport: v.string(),
    goal: v.string(),
  },
  handler: async (ctx, { athleteId, sport, goal }): Promise<Id<"training_paths">> => {
    const coachId = await requireUserId(ctx);
    if (!goal.trim()) throw new Error("Goal cannot be empty");
    const pathId = await ctx.db.insert("training_paths", {
      userId: athleteId,
      sport,
      goal: goal.trim(),
      goalType: "coach" as const,
      sourceCoachId: coachId,
      status: "active",
      createdAt: Date.now(),
      lastAdvancedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      // Public action — accessed via `api` so internal `run` calls work even
      // though it's user-callable too (e.g. manualRefresh from the widget).
      api.actions.trainingCoachPlanner.run,
      { trigger: "coachPushed", pathId },
    );
    return pathId;
  },
});

// ── Internal helpers for the orchestrator action ─────────────────────

export const getSessionForPlanner = internalQuery({
  args: { sessionId: v.id("fight_camp_calendar") },
  handler: async (ctx, { sessionId }) => {
    const s = await ctx.db.get(sessionId);
    if (!s) return null;
    return { notes: s.notes ?? "", date: s.date, userId: s.userId };
  },
});

export const getActivePathsInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "active"),
      )
      .collect();
  },
});

export const recentNotesText = internalQuery({
  args: { userId: v.id("users"), days: v.number() },
  handler: async (ctx, { userId, days }) => {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const rows = await ctx.db
      .query("fight_camp_calendar")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", cutoff))
      .collect();
    return rows.map((r) => r.notes ?? "").filter((n) => n.length > 0).join("\n");
  },
});

export const recentFeedback = internalQuery({
  args: { pathId: v.id("training_paths"), limit: v.number() },
  handler: async (ctx, { pathId, limit }) => {
    return await ctx.db
      .query("training_path_feedback")
      .withIndex("by_path_at", (q) => q.eq("pathId", pathId))
      .order("desc")
      .take(limit);
  },
});

export const countRemedialSteps = internalQuery({
  args: { pathId: v.id("training_paths") },
  handler: async (ctx, { pathId }) => {
    const rows = await ctx.db
      .query("training_path_steps")
      .withIndex("by_path_position", (q) => q.eq("pathId", pathId))
      .collect();
    return rows.filter((r) => r.state === "remedial").length;
  },
});

export const getPathContextForGeneration = internalQuery({
  args: { pathId: v.id("training_paths") },
  handler: async (ctx, { pathId }) => {
    const path = await ctx.db.get(pathId);
    if (!path) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", path.userId))
      .first();
    let daysToFight: number | null = null;
    const camps = await ctx.db
      .query("fight_camps")
      .withIndex("by_user", (q) => q.eq("userId", path.userId))
      .collect();
    const activeCamp = camps.find((c) => !c.isCompleted);
    if (activeCamp?.fightDate) {
      const d = new Date(activeCamp.fightDate).getTime();
      daysToFight = Math.max(0, Math.ceil((d - Date.now()) / 86_400_000));
    }
    const firstName =
      profile?.displayName?.split(" ")[0] ?? "athlete";
    return {
      userId: path.userId,
      sport: path.sport,
      goal: path.goal,
      notesContext: path.notesContext ?? null,
      daysToFight,
      firstName,
    };
  },
});

function normalizeGoal(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const PENDING_BANNER_CAP = 3;
const DECLINED_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export const upsertProposalsFromCandidates = internalMutation({
  args: {
    userId: v.id("users"),
    sessionDate: v.string(),
    candidates: v.array(
      v.object({
        technique: v.string(),
        techniqueNormalized: v.string(),
        sport: v.string(),
      }),
    ),
  },
  handler: async (ctx, { userId, candidates }) => {
    const activeAndQueued = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId))
      .collect();
    const activeNormalized = new Set(
      activeAndQueued
        .filter((p) => p.status === "active" || p.status === "queued")
        .map((p) => normalizeGoal(p.goal)),
    );
    const currentPending = await ctx.db
      .query("training_path_proposals")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "pending"),
      )
      .collect();
    let pendingCount = currentPending.length;
    for (const c of candidates) {
      if (pendingCount >= PENDING_BANNER_CAP) break;
      if (activeNormalized.has(c.techniqueNormalized)) continue;
      const existing = await ctx.db
        .query("training_path_proposals")
        .withIndex("by_user_normalized", (q) =>
          q.eq("userId", userId).eq("techniqueNormalized", c.techniqueNormalized),
        )
        .first();
      if (existing && existing.status === "pending") continue;
      if (
        existing &&
        existing.status === "declined" &&
        existing.declineCount >= 3 &&
        Date.now() - existing.createdAt < DECLINED_COOLDOWN_MS
      ) {
        continue;
      }
      await ctx.db.insert("training_path_proposals", {
        userId,
        technique: c.technique,
        techniqueNormalized: c.techniqueNormalized,
        sport: c.sport,
        status: "pending",
        declineCount: existing?.declineCount ?? 0,
        createdAt: Date.now(),
      });
      pendingCount += 1;
    }
  },
});

export const appendNotesContext = internalMutation({
  args: { pathId: v.id("training_paths"), excerpt: v.string() },
  handler: async (ctx, { pathId, excerpt }) => {
    const p = await ctx.db.get(pathId);
    if (!p) return;
    const next = (p.notesContext ?? "") + "\n---\n" + excerpt;
    await ctx.db.patch(pathId, { notesContext: next.slice(-4000) });
  },
});

export const persistSteps = internalMutation({
  args: {
    pathId: v.id("training_paths"),
    steps: v.array(
      v.object({
        position: v.number(),
        prescription: v.string(),
        wizardLine: v.string(),
        details: v.object({
          why: v.string(),
          how: v.array(v.string()),
          pitfalls: v.array(v.string()),
        }),
        targetSport: v.string(),
        expectedSessions: v.number(),
      }),
    ),
  },
  handler: async (ctx, { pathId, steps }) => {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      await ctx.db.insert("training_path_steps", {
        pathId,
        position: i + 1,
        state: i === 0 ? "current" : "upcoming",
        prescription: s.prescription,
        wizardLine: s.wizardLine,
        details: s.details,
        targetSport: s.targetSport,
        expectedSessions: s.expectedSessions ?? 1,
      });
    }
    await ctx.db.patch(pathId, { lastAdvancedAt: Date.now() });
  },
});

export const markPathArchived = internalMutation({
  args: { pathId: v.id("training_paths"), reason: v.string() },
  handler: async (ctx, { pathId }) => {
    await ctx.db.patch(pathId, { status: "archived" });
  },
});

export const insertRemedialStep = internalMutation({
  args: {
    pathId: v.id("training_paths"),
    step: v.object({
      prescription: v.string(),
      wizardLine: v.string(),
      details: v.object({
        why: v.string(),
        how: v.array(v.string()),
        pitfalls: v.array(v.string()),
      }),
    }),
  },
  handler: async (ctx, { pathId, step }) => {
    const steps = await ctx.db
      .query("training_path_steps")
      .withIndex("by_path_position", (q) => q.eq("pathId", pathId))
      .collect();
    const sorted = steps.sort((a, b) => a.position - b.position);
    const currentIdx = sorted.findIndex((s) => s.state === "current");
    if (currentIdx === -1) return;
    const current = sorted[currentIdx];
    const prevPos = currentIdx === 0 ? 0 : sorted[currentIdx - 1].position;
    const remedialPos = (prevPos + current.position) / 2;
    await ctx.db.insert("training_path_steps", {
      pathId,
      position: remedialPos,
      state: "current",
      prescription: step.prescription,
      wizardLine: step.wizardLine,
      details: step.details,
      targetSport: current.targetSport,
      expectedSessions: 1,
    });
    await ctx.db.patch(current._id, { state: "upcoming" });
  },
});

/** When third+ plateau hits, surface a "step back to prerequisite" banner.
 *  v1 stores a sentinel in `notesContext`; the widget reads it to render
 *  the banner without a separate table. */
export const markPrerequisiteBanner = internalMutation({
  args: { pathId: v.id("training_paths"), reason: v.string() },
  handler: async (ctx, { pathId }) => {
    const p = await ctx.db.get(pathId);
    if (!p) return;
    await ctx.db.patch(pathId, {
      notesContext: (p.notesContext ?? "") + "\n[PREREQUISITE_BANNER]",
    });
  },
});

/** Advances the current step on a path when a matching technique log
 *  lands. Called from `convex/techniques.logTechnique` after the log
 *  inserts. */
export const advanceStepOnTechniqueLog = internalMutation({
  args: {
    userId: v.id("users"),
    techniqueName: v.string(),
    sport: v.string(),
  },
  handler: async (ctx, { userId, techniqueName, sport }) => {
    const activePaths = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "active"),
      )
      .collect();
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const target = norm(techniqueName);
    for (const p of activePaths) {
      if (p.sport !== sport) continue;
      const goalNorm = norm(p.goal);
      if (!(goalNorm.includes(target) || target.includes(goalNorm))) continue;
      const steps = await ctx.db
        .query("training_path_steps")
        .withIndex("by_path_position", (q) => q.eq("pathId", p._id))
        .collect();
      const sorted = steps.sort((a, b) => a.position - b.position);
      const idx = sorted.findIndex((s) => s.state === "current");
      if (idx === -1) continue;
      const cur = sorted[idx];
      await ctx.db.patch(cur._id, {
        state: "completed",
        completedAt: Date.now(),
      });
      await ctx.db.patch(p._id, { lastAdvancedAt: Date.now() });
      const next = sorted[idx + 1];
      if (next) {
        await ctx.db.patch(next._id, { state: "current" });
      } else {
        await ctx.db.patch(p._id, { status: "completed" });
        await ctx.scheduler.runAfter(
          0,
          internal.actions.trainingCoachPlanner._completePathFollowUps,
          { pathId: p._id },
        );
      }
      break;
    }
  },
});

// ── Path lifecycle (pause / resume / archive) ────────────────────────

async function promoteQueuedIfSlot(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> {
  const allPaths = await ctx.db
    .query("training_paths")
    .withIndex("by_user_status", (q) => q.eq("userId", userId))
    .collect();
  const activeCount = allPaths.filter((p) => p.status === "active").length;
  if (activeCount >= ACTIVE_CAP) return;
  const nextQueued = allPaths
    .filter((p) => p.status === "queued")
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (nextQueued) {
    await ctx.db.patch(nextQueued._id, { status: "active" });
  }
}

export const pausePath = mutation({
  args: { pathId: v.id("training_paths") },
  handler: async (ctx, { pathId }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(pathId);
    if (!row || row.userId !== userId) throw new Error("Not authorized");
    await ctx.db.patch(pathId, { status: "paused" });
    await promoteQueuedIfSlot(ctx, userId);
  },
});

export const resumePath = mutation({
  args: { pathId: v.id("training_paths") },
  handler: async (ctx, { pathId }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(pathId);
    if (!row || row.userId !== userId) throw new Error("Not authorized");
    const allPaths = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId))
      .collect();
    const activeCount = allPaths.filter((p) => p.status === "active").length;
    const nextStatus = activeCount >= ACTIVE_CAP ? "queued" : "active";
    await ctx.db.patch(pathId, { status: nextStatus });
  },
});

export const archivePath = mutation({
  args: { pathId: v.id("training_paths") },
  handler: async (ctx, { pathId }) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db.get(pathId);
    if (!row || row.userId !== userId) throw new Error("Not authorized");
    await ctx.db.patch(pathId, { status: "archived" });
    await promoteQueuedIfSlot(ctx, userId);
  },
});

// ── Path + step queries (for widget) ──────────────────────────────────

export const getActivePaths = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "active"),
      )
      .collect();
    return rows.sort((a, b) => b.lastAdvancedAt - a.lastAdvancedAt);
  },
});

export const getQueuedPaths = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "queued"),
      )
      .collect();
  },
});

export const getPausedPaths = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "paused"),
      )
      .collect();
  },
});

export const getPathWithSteps = query({
  args: { pathId: v.id("training_paths") },
  handler: async (ctx, { pathId }) => {
    const userId = await requireUserId(ctx);
    const path = await ctx.db.get(pathId);
    if (!path || path.userId !== userId) throw new Error("Not authorized");
    const steps = await ctx.db
      .query("training_path_steps")
      .withIndex("by_path_position", (q) => q.eq("pathId", pathId))
      .collect();
    return {
      path,
      steps: steps.sort((a, b) => a.position - b.position),
    };
  },
});

export const getHeroStep = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const activePaths = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "active"),
      )
      .collect();
    if (activePaths.length === 0) return null;
    const hero = activePaths.sort(
      (a, b) => b.lastAdvancedAt - a.lastAdvancedAt,
    )[0];
    const steps = await ctx.db
      .query("training_path_steps")
      .withIndex("by_path_position", (q) => q.eq("pathId", hero._id))
      .collect();
    const sorted = steps.sort((a, b) => a.position - b.position);
    const currentIdx = sorted.findIndex((s) => s.state === "current");
    if (currentIdx === -1) return null;
    return {
      path: hero,
      currentStep: sorted[currentIdx],
      nextSteps: sorted.slice(currentIdx + 1, currentIdx + 3),
      totalSteps: sorted.length,
      stepNumber: currentIdx + 1,
    };
  },
});

// ── Step feedback ─────────────────────────────────────────────────────

export const submitStepFeedback = mutation({
  args: {
    stepId: v.id("training_path_steps"),
    feedback: v.union(v.literal("nailed"), v.literal("off")),
  },
  handler: async (ctx, { stepId, feedback }) => {
    const userId = await requireUserId(ctx);
    const step = await ctx.db.get(stepId);
    if (!step) throw new Error("Step not found");
    const path = await ctx.db.get(step.pathId);
    if (!path || path.userId !== userId) throw new Error("Not authorized");
    await ctx.db.patch(stepId, { completedFeedback: feedback });
    await ctx.db.insert("training_path_feedback", {
      pathId: step.pathId,
      stepId,
      userId,
      feedback,
      at: Date.now(),
    });
    if (feedback === "off") {
      await ctx.scheduler.runAfter(
        0,
        api.actions.trainingCoachPlanner.run,
        { trigger: "stepFeedback", feedbackPathId: step.pathId },
      );
    }
  },
});

export const getPendingFeedbackStep = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const paths = await ctx.db
      .query("training_paths")
      .withIndex("by_user_status", (q) => q.eq("userId", userId))
      .collect();
    for (const p of paths) {
      const steps = await ctx.db
        .query("training_path_steps")
        .withIndex("by_path_position", (q) => q.eq("pathId", p._id))
        .collect();
      const candidate = steps
        .filter(
          (s) =>
            s.state === "completed" &&
            s.completedAt != null &&
            s.completedFeedback == null,
        )
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
      if (
        candidate &&
        Date.now() - (candidate.completedAt ?? 0) < 24 * 60 * 60 * 1000
      ) {
        return candidate;
      }
    }
    return null;
  },
});
