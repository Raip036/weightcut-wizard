/**
 * Training Coach Paths orchestrator action.
 *
 * Single entry point `run({ trigger, ... })` branches into six stages.
 * Pro-only — gated via `AI_TRAINING_COACH_PATHS`.
 *
 * Trigger → effect map:
 *   - sessionSave   : extract candidates from a session's notes; also pre-
 *                     filter stall language against active paths.
 *   - manualRefresh : re-runs extract on the last 7 days of notes (rate-
 *                     limited at the call site).
 *   - goalCreated   : generates a 5-8 step curriculum for a path just
 *                     created via createGoalPath / acceptPathProposal.
 *   - coachPushed   : same as goalCreated but flagged as coach-prescribed.
 *   - stepFeedback  : on 2 consecutive "off" feedbacks, fire plateau eval.
 */
"use node";

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requireUserIdFromAction } from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";
import {
  extractCandidates,
  normalizeTechnique,
} from "./_trainingCoach/extractCandidates";
import { generateSteps } from "./_trainingCoach/generateSteps";
import {
  evaluatePlateau,
  detectStallInNotes,
} from "./_trainingCoach/evaluatePlateau";
import { proposeFollowUps } from "./_trainingCoach/completePath";

// Shared arg validators for the public + internal entry points.
const plannerArgs = {
  trigger: v.union(
    v.literal("sessionSave"),
    v.literal("manualRefresh"),
    v.literal("goalCreated"),
    v.literal("coachPushed"),
    v.literal("stepFeedback"),
  ),
  sessionId: v.optional(v.id("fight_camp_calendar")),
  pathId: v.optional(v.id("training_paths")),
  feedbackPathId: v.optional(v.id("training_paths")),
};

type PlannerArgs = {
  trigger:
    | "sessionSave"
    | "manualRefresh"
    | "goalCreated"
    | "coachPushed"
    | "stepFeedback";
  sessionId?: Id<"fight_camp_calendar">;
  pathId?: Id<"training_paths">;
  feedbackPathId?: Id<"training_paths">;
};

export const run = action({
  args: plannerArgs,
  handler: async (ctx, args): Promise<void> => {
    const userId = await requireUserIdFromAction(ctx);
    await runPlanner(ctx, userId, args);
  },
});

/**
 * Internal variant for scheduled (background) invocation. Scheduled Convex
 * functions run WITHOUT the scheduling context's auth identity, so the
 * mutations in fight_camp.ts / training_paths.ts that fire this planner must
 * pass the resolved userId explicitly. Routing those triggers through the
 * public `run` was the cause of the "Not authenticated" crash.
 */
export const _runInternal = internalAction({
  args: { userId: v.id("users"), ...plannerArgs },
  handler: async (ctx, { userId, ...args }): Promise<void> => {
    await runPlanner(ctx, userId, args);
  },
});

async function runPlanner(
  ctx: ActionCtx,
  userId: Id<"users">,
  args: PlannerArgs,
): Promise<void> {
  await enforceFeatureGate(ctx, userId, "AI_TRAINING_COACH_PATHS");

  if (args.trigger === "sessionSave" && args.sessionId) {
    await handleSessionSave(ctx, args.sessionId);
  } else if (args.trigger === "manualRefresh") {
    await handleManualRefresh(ctx, userId);
  } else if (
    (args.trigger === "goalCreated" || args.trigger === "coachPushed") &&
    args.pathId
  ) {
    await handleGenerateForPath(ctx, args.pathId);
  } else if (args.trigger === "stepFeedback" && args.feedbackPathId) {
    await handleFeedbackPlateau(ctx, args.feedbackPathId);
  }
}

async function handleSessionSave(
  ctx: { runQuery: any; runMutation: any; scheduler: any },
  sessionId: any,
): Promise<void> {
  const session = await ctx.runQuery(
    internal.training_paths.getSessionForPlanner,
    { sessionId },
  );
  if (!session?.notes) return;
  const candidates = await extractCandidates({ notes: session.notes });
  if (candidates.length > 0) {
    await ctx.runMutation(
      internal.training_paths.upsertProposalsFromCandidates,
      {
        userId: session.userId,
        sessionDate: session.date,
        candidates: candidates.map((c) => ({
          technique: c.technique,
          techniqueNormalized: normalizeTechnique(c.technique),
          sport: c.sport,
        })),
      },
    );
  }
  const activePaths = await ctx.runQuery(
    internal.training_paths.getActivePathsInternal,
    { userId: session.userId },
  );
  for (const p of activePaths) {
    if (detectStallInNotes(session.notes, p.goal)) {
      await ctx.runMutation(internal.training_paths.appendNotesContext, {
        pathId: p._id,
        excerpt: session.notes,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.actions.trainingCoachPlanner._evaluatePlateauForPath,
        { pathId: p._id, signal: "note stall language" },
      );
    }
  }
}

async function handleManualRefresh(
  ctx: { runQuery: any; runMutation: any },
  userId: any,
): Promise<void> {
  const recent = await ctx.runQuery(internal.training_paths.recentNotesText, {
    userId,
    days: 7,
  });
  if (!recent) return;
  const candidates = await extractCandidates({ notes: recent });
  await ctx.runMutation(internal.training_paths.upsertProposalsFromCandidates, {
    userId,
    sessionDate: new Date().toISOString().slice(0, 10),
    candidates: candidates.map((c) => ({
      technique: c.technique,
      techniqueNormalized: normalizeTechnique(c.technique),
      sport: c.sport,
    })),
  });
}

async function handleGenerateForPath(
  ctx: { runQuery: any; runMutation: any },
  pathId: any,
): Promise<void> {
  const ctxInputs = await ctx.runQuery(
    internal.training_paths.getPathContextForGeneration,
    { pathId },
  );
  if (!ctxInputs) return;
  const result = await generateSteps({
    sport: ctxInputs.sport,
    goal: ctxInputs.goal,
    notes: ctxInputs.notesContext ?? "",
    daysToFight: ctxInputs.daysToFight,
    firstName: ctxInputs.firstName,
  });
  if (result.kind === "refused" || result.kind === "error") {
    await ctx.runMutation(internal.training_paths.markPathArchived, {
      pathId,
      reason: result.kind === "refused" ? result.reason : result.message,
    });
    return;
  }
  await ctx.runMutation(internal.training_paths.persistSteps, {
    pathId,
    steps: result.steps.map((s) => ({
      position: s.position,
      prescription: s.prescription,
      wizardLine: s.wizardLine,
      details: s.details,
      targetSport: s.targetSport,
      expectedSessions: 1,
    })),
  });
}

async function handleFeedbackPlateau(
  ctx: { runQuery: any; scheduler: any },
  pathId: any,
): Promise<void> {
  const recent = await ctx.runQuery(internal.training_paths.recentFeedback, {
    pathId,
    limit: 2,
  });
  if (recent.length < 2) return;
  if (!recent.every((r: { feedback: string }) => r.feedback === "off")) return;
  await ctx.scheduler.runAfter(
    0,
    internal.actions.trainingCoachPlanner._evaluatePlateauForPath,
    { pathId, signal: "2 consecutive off feedbacks" },
  );
}

export const _evaluatePlateauForPath = internalAction({
  args: {
    pathId: v.id("training_paths"),
    signal: v.string(),
  },
  handler: async (ctx, { pathId, signal }): Promise<void> => {
    const inputs = await ctx.runQuery(
      internal.training_paths.getPathContextForGeneration,
      { pathId },
    );
    if (!inputs) return;
    const remedialCount = await ctx.runQuery(
      internal.training_paths.countRemedialSteps,
      { pathId },
    );
    if (remedialCount >= 2) {
      await ctx.runMutation(internal.training_paths.markPrerequisiteBanner, {
        pathId,
        reason: "third plateau",
      });
      return;
    }
    const result = await evaluatePlateau({
      technique: inputs.goal,
      stallSignal: signal,
    });
    if (result.kind === "remedial") {
      await ctx.runMutation(internal.training_paths.insertRemedialStep, {
        pathId,
        step: result.step,
      });
    }
  },
});

export const _completePathFollowUps = internalAction({
  args: { pathId: v.id("training_paths") },
  handler: async (ctx, { pathId }): Promise<void> => {
    const inputs = await ctx.runQuery(
      internal.training_paths.getPathContextForGeneration,
      { pathId },
    );
    if (!inputs) return;
    const result = await proposeFollowUps({
      technique: inputs.goal,
      sport: inputs.sport,
    });
    if (result.kind === "ok") {
      await ctx.runMutation(
        internal.training_paths.upsertProposalsFromCandidates,
        {
          userId: inputs.userId,
          sessionDate: new Date().toISOString().slice(0, 10),
          candidates: [
            {
              technique: result.relatedPath.technique,
              techniqueNormalized: normalizeTechnique(
                result.relatedPath.technique,
              ),
              sport: result.relatedPath.sport,
            },
            {
              technique: result.defensePath.technique,
              techniqueNormalized: normalizeTechnique(
                result.defensePath.technique,
              ),
              sport: result.defensePath.sport,
            },
          ],
        },
      );
    }
  },
});
