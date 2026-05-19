"use node";
/**
 * Shared utilities for Convex actions.
 *
 * - `requireUserIdFromAction` resolves the calling user's id via the auth
 *   internalQuery (actions can't read ctx.db directly).
 * - `loadAthleteSnapshot` fans out internal queries to build the
 *   AthleteSnapshot prompt block used by most AI features.
 * - `logDecision` is fire-and-forget audit logging into ai_decisions.
 * - `SECOND_PERSON_DIRECTIVE` keeps every AI feature's voice consistent.
 */

/**
 * Inserted into every AI system prompt that produces user-facing copy
 * so the wizard always addresses the user as "you" / "your" rather
 * than "the athlete" / "they". One place to tweak the tone for the
 * whole app.
 */
export const SECOND_PERSON_DIRECTIVE =
  `VOICE: Speak directly to the user as "you" / "your". Never refer to ` +
  `them in the third person ("the athlete", "the fighter", "they", ` +
  `"the user"). Write as if you are sitting across from them.`;

import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import {
  buildAthleteSnapshot,
  snapshotToPromptBlock,
  type AthleteSnapshot,
} from "../_shared/athleteSnapshot";

type SnapshotProfile = FunctionReturnType<
  typeof internal.actions_internal.fetchSnapshotData
>["profile"];

export async function requireUserIdFromAction(
  ctx: ActionCtx,
): Promise<Id<"users">> {
  const userId = await ctx.runQuery(internal.lib.auth.getMyUserId);
  if (!userId) throw new Error("Not authenticated");
  return userId as Id<"users">;
}

export async function loadAthleteSnapshot(
  ctx: ActionCtx,
  userId: Id<"users">,
): Promise<{ snapshot: AthleteSnapshot; block: string; profile: SnapshotProfile }> {
  const data = await ctx.runQuery(internal.actions_internal.fetchSnapshotData, {
    userId,
  });
  const snapshot = buildAthleteSnapshot({
    userId,
    profile: data.profile,
    weight14d: data.weight14d,
    mealTotals7d: data.mealTotals7d,
    sessions7d: data.sessions7d,
    sets7d: data.sets7d,
    sets3d: data.sets3d,
    sleep7d: data.sleep7d,
    hydration7d: data.hydration7d,
    wellness7d: data.wellness7d,
    fightCamp: data.fightCamp,
    todayWellness: data.todayWellness
      ? {
          soreness_level: data.todayWellness.soreness_level,
          fatigue_level: data.todayWellness.fatigue_level,
          sleep_hours: data.todayWellness.sleep_hours,
        }
      : null,
  });
  return {
    snapshot,
    block: snapshotToPromptBlock(snapshot),
    profile: data.profile,
  };
}

export function logDecision(
  ctx: ActionCtx,
  args: {
    userId: Id<"users">;
    feature: string;
    inputSnapshot: unknown;
    outputJson: unknown;
    predictionFacts?: Record<string, number>;
    model?: string;
  },
) {
  // Fire-and-forget; swallow errors so logging never blocks responses.
  void ctx
    .runMutation(internal.ai_decisions.recordDecision, args)
    .catch((e) => console.error("[logDecision] failed:", e));
}
