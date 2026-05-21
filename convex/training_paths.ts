/**
 * Queries and mutations for the Training Coach Paths feature.
 *
 * Multi-step improvement paths per technique/combo/goal. Paths advance
 * automatically as `training_technique_logs` rows match a step's target
 * technique. Plateau loop-back and follow-up generation live in the
 * `actions/trainingCoachPlanner.ts` orchestrator; this file is pure CRUD.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
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

/** Placeholder for the real acceptPathProposal — wired in the orchestrator
 *  task. Exists so the widget UI compiles before the planner lands. */
export const acceptPathProposalStub = mutation({
  args: { proposalId: v.id("training_path_proposals") },
  handler: async () => {
    throw new Error("Not implemented yet — wired in the orchestrator task");
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
    // Plateau trigger wired in via the orchestrator task.
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
