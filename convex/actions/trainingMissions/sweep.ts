"use node";

/**
 * Training Missions — hourly backstop sweep.
 *
 * The primary trigger for `generateMissionIfReady` is the session-save
 * mutation in `fight_camp.ts`. This cron is a belt-and-braces backstop
 * so missions still flow even if some path writes session notes by a
 * code path the calendar mutation never reaches (e.g. a future bulk
 * import, an admin-side data fix, a Capacitor offline-queue flush).
 *
 * The sweep finds every (userId, sport) pair with a non-empty session
 * note in the last 30 days and schedules `generateMissionIfReady` for
 * each. The action itself is idempotent — it short-circuits on
 *   - `prior_incomplete` (active mission has unchecked items)  → queue
 *   - `no_new_notes`     (notesWindowStart already advanced)   → no-op
 * so the sweep is safe to run frequently.
 */

import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number; pairs: number }> => {
    const since = Date.now() - LOOKBACK_MS;

    // The lookup runs as an internal query so the action stays in node
    // runtime while the DB read stays in v8.
    const pairs = await ctx.runQuery(
      internal.fight_camp.listSessionPairsWithNotesSince,
      { since },
    );

    let scheduled = 0;
    for (const { userId, sport } of pairs) {
      try {
        await ctx.scheduler.runAfter(
          0,
          internal.actions.trainingMissions.generate.generateMissionIfReady,
          { userId, sport },
        );
        scheduled += 1;
      } catch (err) {
        console.warn(
          "trainingMissions.sweep: schedule failed for",
          userId,
          sport,
          err,
        );
      }
    }
    return { scheduled, pairs: pairs.length };
  },
});
