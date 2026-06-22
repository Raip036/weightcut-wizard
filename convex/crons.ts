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

// ──────────────────────────────────────────────────────────────────────
// Camp Compass — Sunday 20:00 UTC weekly recovery report.
//
// Flagship Pro feature (spec §7.1). Iterates every currently-Pro user
// and generates the report for the week-just-ended. The fan-out caps
// concurrency at 5 to stay inside Groq's rate limit; per-user errors
// are logged but don't fail the whole cron. The action itself is
// idempotent — re-running the cron upserts by (userId, weekStartIso)
// so a manual re-run after a partial Groq outage simply patches the
// rows that already succeeded.
// ──────────────────────────────────────────────────────────────────────
crons.weekly(
  "camp-compass-sunday",
  { dayOfWeek: "sunday", hourUTC: 20, minuteUTC: 0 },
  internal.actions.recovery.campCompass.runWeeklyForAllProUsers,
);

// ──────────────────────────────────────────────────────────────────────
// Subscription reconciliation — daily 03:00 UTC safety net (fix F6).
//
// Re-verifies, against the RevenueCat REST API, the subscriptions of users
// whose stored `subscriptionExpiresAt` sits near the boundary (expired ≤2d
// ago, or expiring ≤1d ahead). Catches MISSED `RENEWAL` webhooks so a paying
// user self-heals without reopening the app, and confirms genuine
// expirations. Idempotent — `activatePremiumVerified`'s stale-expiry guard
// makes a re-run a no-op when nothing changed. Runs at 03:00 UTC, a low-
// traffic hour not already used by the 00:00 / 04:00 / 04:30 jobs above.
// ──────────────────────────────────────────────────────────────────────
crons.cron(
  "reconcile-subscriptions-daily",
  "0 3 * * *",
  internal.actions.reconcileSubscriptions.runDaily,
);

export default crons;
