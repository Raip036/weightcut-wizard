"use node";

/**
 * Sparring To-Do List — hourly backstop sweep.
 *
 * The primary trigger for `generateSparringPlanIfReady` is the session-save
 * mutation in `fight_camp.ts` (added by a sibling agent). This cron is a
 * belt-and-braces backstop so plans still flow even if session notes are
 * written by a path the calendar mutation never reaches (bulk import, admin
 * data fix, Capacitor offline-queue flush).
 *
 * The sweep finds every (userId, sport) pair with a non-empty session note in
 * the last 30 days and schedules `generateSparringPlanIfReady` for each. That
 * action is idempotent — it short-circuits on `not_martial_art`, `not_pro`,
 * and `no_new` — so the sweep is safe to run frequently.
 */

import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number; pairs: number }> => {
    const since = Date.now() - LOOKBACK_MS;

    // Internal query so the DB read stays in v8 while this action stays in
    // node runtime.
    const pairs = await ctx.runQuery(
      internal.fight_camp.listSessionPairsWithNotesSince,
      { since },
    );

    let scheduled = 0;
    for (const { userId, sport } of pairs) {
      try {
        await ctx.scheduler.runAfter(
          0,
          internal.actions.sparringPlan.generate.generateSparringPlanIfReady,
          { userId, sport },
        );
        scheduled += 1;
      } catch (err) {
        console.warn(
          "sparringPlan.sweep: schedule failed for",
          userId,
          sport,
          err,
        );
      }
    }
    return { scheduled, pairs: pairs.length };
  },
});
