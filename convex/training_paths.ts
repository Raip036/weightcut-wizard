/**
 * Queries and mutations for the Training Coach Paths feature.
 *
 * Multi-step improvement paths per technique/combo/goal. Paths advance
 * automatically as `training_technique_logs` rows match a step's target
 * technique. Plateau loop-back and follow-up generation live in the
 * `actions/trainingCoachPlanner.ts` orchestrator; this file is pure CRUD.
 */
import { query } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import { effectiveTier } from "./_shared/tier";

const ACTIVE_CAP = 3 as const;

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
