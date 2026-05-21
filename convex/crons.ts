/**
 * Convex cron jobs.
 *
 * Hourly reconcile-ai-outcomes: scans pending ai_decisions rows, compares
 * predicted vs actual user data, then writes the outcome + error_pct back
 * to each row. Replaces the pg_cron / Supabase scheduled function that
 * previously invoked `reconcile-ai-outcomes` over HTTP.
 */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "reconcile-ai-outcomes",
  { minuteUTC: 0 },
  internal.actions.reconcileAiOutcomes.run,
);

crons.hourly(
  "fight-form-score-daily",
  { minuteUTC: 5 },
  internal.fightFormScore.scheduleDailyRecomputeAcrossUsers,
);

// ──────────────────────────────────────────────────────────────────────
// Apple Health integration (spec §6)
//
// Nightly fan-out: re-rolls yesterday's daily health summary for every
// connected user (catches late-arriving Whoop/Oura sync data) and then
// refreshes the per-user rolling baselines + tier classification.
// Times are UTC — see spec §10.9 for the timezone-drift rationale.
// `crons.cron` is preferred over `crons.daily` per the Convex guidelines.
// ──────────────────────────────────────────────────────────────────────
crons.cron(
  "health-nightly-rollup",
  "0 4 * * *",
  internal.health.scheduleNightlyRollups,
);

crons.cron(
  "health-nightly-baselines",
  "30 4 * * *",
  internal.health.scheduleNightlyBaselines,
);

// ──────────────────────────────────────────────────────────────────────
// Training Missions — hourly backstop sweep.
//
// Generation is primarily triggered by the calendar save mutation. This
// sweep is a safety net so a mission still appears even if some other
// surface writes session notes that bypass the standard trigger. The
// action is idempotent (see actions/trainingMissions/sweep.ts).
// ──────────────────────────────────────────────────────────────────────
crons.hourly(
  "training-missions-sweep",
  { minuteUTC: 15 },
  internal.actions.trainingMissions.sweep.run,
);

export default crons;
