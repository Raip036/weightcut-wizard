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

/**
 * Graduation self-heal sweep — 15-minute backstop.
 *
 * Graduation (`graduateCycleToSparring`) is scheduled only from the final drill
 * tick (`markItemCompleted`). Convex does not auto-retry a failed scheduled
 * action, so a throw (e.g. a Groq outage in the legacy path) leaves a discipline
 * stuck at phase "spar" with completed-but-ungraduated missions and 0 sparring
 * assignments, with nothing to re-schedule it. This is the graduation analogue
 * of the drills sweep above.
 *
 * Bounded like the drills sweep: the candidate set is the distinct users with a
 * session note in the last 30 days (`listSessionPairsWithNotesSince`), never all
 * users. For each, an internal query returns the stuck cycles and we re-schedule
 * `graduateCycleToSparring` per cycle. Idempotent — a re-run over a cycle that
 * has since graduated upserts safely and skips already-graduated missions. Also
 * prunes orphaned `mastery_generation_jobs` so that table can't accumulate.
 */
export const graduationSweep = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ scheduled: number; users: number; prunedJobs: number }> => {
    const since = Date.now() - LOOKBACK_MS;

    const pairs = await ctx.runQuery(
      internal.fight_camp.listSessionPairsWithNotesSince,
      { since },
    );

    // Distinct users with recent activity — bounded by the 30d lookback.
    const userIds = Array.from(new Set(pairs.map((p) => p.userId)));

    let scheduled = 0;
    for (const userId of userIds) {
      let stuck: Array<{ discipline: string; cycleId: string }>;
      try {
        stuck = await ctx.runQuery(
          internal.training_missions.listStuckGraduationCycles,
          { userId },
        );
      } catch (err) {
        console.warn(
          "trainingMissions.graduationSweep: detect failed for",
          userId,
          err,
        );
        continue;
      }
      for (const { discipline, cycleId } of stuck) {
        try {
          await ctx.scheduler.runAfter(
            0,
            internal.actions.trainingMissions.graduate.graduateCycleToSparring,
            { userId, discipline, cycleId },
          );
          scheduled += 1;
        } catch (err) {
          console.warn(
            "trainingMissions.graduationSweep: schedule failed for",
            userId,
            discipline,
            err,
          );
        }
      }
    }

    // Prune orphaned generation-job markers (cheap, bounded, best-effort).
    let prunedJobs = 0;
    try {
      const res = await ctx.runMutation(
        internal.mastery_spine.pruneStaleGenerationJobs,
        {},
      );
      prunedJobs = res.deleted;
    } catch (err) {
      console.warn("trainingMissions.graduationSweep: prune jobs failed", err);
    }

    return { scheduled, users: userIds.length, prunedJobs };
  },
});
