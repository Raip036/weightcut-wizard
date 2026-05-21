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
