/**
 * Camp Compass — the Sunday weekly AI recovery report (Pro flagship).
 *
 * Two surfaces:
 *   1. `generateWeeklyReport` — public action. Called from the UI
 *      ("regenerate this week" button) AND from the cron fan-out below.
 *      Pro-gated. Idempotent via `upsertByWeek` on (userId, weekStartIso).
 *
 *   2. `runWeeklyForAllProUsers` — internalAction wired to the
 *      `crons.weekly("camp-compass-sunday", ...)` entry in
 *      `convex/crons.ts`. Iterates every currently-Pro user, computes
 *      the week-just-ended (Monday → Sunday in UTC), and dispatches the
 *      public action with a small concurrency cap so a single Groq
 *      hiccup doesn't tail the whole batch.
 *
 * Per-user errors are logged but never thrown — one user's failure must
 * not abort the rest of the cron fan-out (this is the failure mode the
 * spec calls out in §7.1).
 *
 * Spec: docs/superpowers/specs/2026-06-01-recovery-page-redesign-design.md §7.1
 */
"use node";

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { callGroqRaw } from "../../_shared/groq";
import { requireUserIdFromAction } from "../_helpers";
import { enforceFeatureGate } from "../../_shared/featureGates";
import { parseJSON } from "../../_shared/parseResponse";

// Per-provider model pick. Recovery features get OpenRouter models directly
// (not via the shared OPENROUTER_MODEL_MAP) so other features keep their
// current routing. Falls back to the canonical Groq model when LLM_PROVIDER
// is not openrouter.
//   - Weekly Sunday narrative report → DeepSeek V3.5 (strong reasoning,
//     ~30x cheaper than Claude Sonnet 4.5 for narrative+JSON output).
//     Verify the exact OpenRouter model ID before deploy.
const MODEL =
  (typeof process !== "undefined" && process.env?.LLM_PROVIDER?.toLowerCase() === "openrouter")
    ? "deepseek/deepseek-chat"
    : "openai/gpt-oss-120b";
const GROQ_TIMEOUT_MS = 30_000;
const CRON_BATCH_SIZE = 5;

// ───────────────────────────────────────────────────────────────────────
// Public action — generate (or refresh) this week's Camp Compass report
// ───────────────────────────────────────────────────────────────────────

/**
 * Generate this week's Camp Compass report for the calling user and
 * persist it to `recoveryReports`. Returns the resulting row id.
 *
 * `userId` is accepted as an explicit arg so the cron path can pass it
 * directly (no auth identity in cron context). When called from the
 * client the UI must still pass the user's own id — we double-check
 * against the authenticated identity and refuse mismatches.
 *
 * `weekStartIso` must be the YYYY-MM-DD of the Monday the report covers.
 * The action does NOT recompute it server-side because the cron and the
 * UI may legitimately disagree (UI: regenerate any historical week).
 */
export const generateWeeklyReport = action({
  args: {
    userId: v.id("users"),
    weekStartIso: v.string(),
  },
  handler: async (
    ctx,
    { userId, weekStartIso },
  ): Promise<Id<"recoveryReports">> => {
    // Auth: when called from the UI we require the caller match the
    // requested userId. The cron path is an internalAction → runAction
    // chain that bypasses the user-identity check (there is no
    // identity), but we still verify the userId resolves to a real
    // profile via the Pro feature-gate.
    const identity = await ctx.auth.getUserIdentity();
    if (identity) {
      const callerUserId = await requireUserIdFromAction(ctx);
      if (callerUserId !== userId) {
        throw new Error("Not authorized to generate a report for another user");
      }
    }
    // Pro gate. Throws PRO_FEATURE_REQUIRED:AI_RECOVERY_COACH for free
    // users — the existing client error-mapping turns that into a
    // paywall prompt without extra plumbing.
    await enforceFeatureGate(ctx, userId, "AI_RECOVERY_COACH");

    // 1. Single round-trip fetch of every input the prompt needs.
    const inputs = await ctx.runQuery(
      internal.recoveryReports.gatherCampCompassInputs,
      { userId },
    );

    // 2. Build the prompt.
    const prompt = buildCompassPrompt({ weekStartIso, ...inputs });

    // 3. Call Groq with structured JSON output. `callGroqRaw` wraps the
    //    fetch in an AbortController with a configurable timeout and
    //    normalises errors to `GroqError`.
    const response = await callGroqRaw({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
      max_tokens: 1200,
      timeoutMs: GROQ_TIMEOUT_MS,
    });

    const rawContent = response.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error("Camp Compass: empty Groq response");
    }
    const json = parseJSON(rawContent) as Record<string, unknown>;

    // 4. Validate / coerce the JSON shape. We accept whatever the model
    //    gives us and fill in safe defaults — a malformed response
    //    should still produce a usable row rather than a 500.
    const verdict =
      typeof json.verdict === "string" && json.verdict.trim().length > 0
        ? json.verdict.trim()
        : "Steady week. Keep stacking sessions.";
    const breakdown =
      typeof json.breakdown === "string" ? json.breakdown.trim() : "";
    const nextWeekActions = Array.isArray(json.nextWeekActions)
      ? json.nextWeekActions.slice(0, 3).map((a) => {
          const obj = (a ?? {}) as Record<string, unknown>;
          return {
            dayIso: typeof obj.dayIso === "string" ? obj.dayIso : weekStartIso,
            action: typeof obj.action === "string" ? obj.action : "",
          };
        })
      : [];
    const campArc =
      typeof json.campArc === "string" && json.campArc.trim().length > 0
        ? json.campArc.trim()
        : undefined;

    // 5. Upsert. `rawMetrics` is the debug snapshot the spec specifies
    //    will later seed audio-summary generation.
    const reportId: Id<"recoveryReports"> = await ctx.runMutation(
      internal.recoveryReports.upsertByWeek,
      {
        userId,
        weekStartIso,
        verdict,
        breakdown,
        nextWeekActions,
        campArc,
        rawMetrics: {
          sessionsCount: inputs.sessions.length,
          sleepLogsCount: inputs.sleepLogs.length,
          checkinsCount: inputs.checkins.length,
          hasBaseline: inputs.baseline !== null,
          hasActiveCamp: inputs.activeCamp !== null,
          model: MODEL,
        },
      },
    );

    return reportId;
  },
});

// ───────────────────────────────────────────────────────────────────────
// Internal action — Sunday cron entry point
// ───────────────────────────────────────────────────────────────────────

/**
 * Sunday 20:00 UTC cron. Iterates every currently-Pro user and dispatches
 * `generateWeeklyReport` for the just-completed week (the prior Monday).
 *
 * Concurrency is capped at `CRON_BATCH_SIZE` so we don't burst Groq's
 * rate limit on a Sunday-night kick. Each user's call is wrapped in a
 * try/catch — a single failure (Groq 429, malformed JSON, missing data)
 * gets logged and the batch moves on so the rest of the user base still
 * receives their report.
 */
export const runWeeklyForAllProUsers = internalAction({
  args: {},
  handler: async (ctx): Promise<{ attempted: number; succeeded: number }> => {
    const proUserIds: Array<Id<"users">> = await ctx.runQuery(
      internal.profiles_internal.listActiveProUserIds,
      {},
    );

    const weekStartIso = computeLastMondayIsoUtc(new Date());

    let succeeded = 0;
    for (let i = 0; i < proUserIds.length; i += CRON_BATCH_SIZE) {
      const chunk = proUserIds.slice(i, i + CRON_BATCH_SIZE);
      const results = await Promise.allSettled(
        chunk.map((uid) =>
          ctx.runAction(api.actions.recovery.campCompass.generateWeeklyReport, {
            userId: uid,
            weekStartIso,
          }),
        ),
      );
      results.forEach((r, idx) => {
        if (r.status === "fulfilled") {
          succeeded += 1;
        } else {
          console.error(
            "Camp Compass failed for user",
            chunk[idx],
            r.reason instanceof Error ? r.reason.message : r.reason,
          );
        }
      });
    }
    return { attempted: proUserIds.length, succeeded };
  },
});

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

/**
 * Returns YYYY-MM-DD of the Monday of the just-completed week (in UTC).
 *
 *  - If today is Sunday, "this week's Monday" is 6 days back, so "last
 *    Monday" is 13 days back. We want the week-just-ended, so 13.
 *  - More generally: dowMon0 = (UTCDay + 6) % 7 (Mon=0..Sun=6). The
 *    Monday of the just-completed week is `dowMon0 + 7` days back.
 *
 * Built in UTC so the cron's wall-clock interpretation doesn't drift on
 * DST boundaries (same rationale as the rest of the code base — see
 * `convex/fight_camp.ts:computeWeekStart`).
 */
function computeLastMondayIsoUtc(now: Date): string {
  const dowMon0 = (now.getUTCDay() + 6) % 7;
  const lastMonday = new Date(now);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - dowMon0 - 7);
  return lastMonday.toISOString().slice(0, 10);
}

// ───────────────────────────────────────────────────────────────────────
// Prompt construction
// ───────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a combat-sports recovery and performance coach writing a brief weekly recap for a fighter. Tone: direct, fight-culture native, no fluff. NO emojis. Output strict JSON.`;

type CompassInputs = {
  weekStartIso: string;
  sessions: Array<{
    date: string;
    sessionType: string;
    sessionTag: string | null;
    durationMinutes: number;
    rpe: number;
    intensity: string;
    rounds: number | null;
  }>;
  sleepLogs: Array<{ date: string; hours: number }>;
  checkins: Array<{
    date: string;
    hooperIndex: number | null;
    sorenessLevel: number;
    fatigueLevel: number;
    stressLevel: number;
    sleepHours: number | null;
  }>;
  baseline: {
    sleepHoursMean60d: number | null;
    hooperMean60d: number | null;
    dailyLoadMean14d: number | null;
    hooperCv14d: number | null;
  } | null;
  priorReports: Array<{ weekStartIso: string; verdict: string }>;
  activeCamp: {
    name: string;
    fightDate: string;
    eventName: string | null;
  } | null;
};

/**
 * Compose the user-side prompt. Reduces every input to compact line-per-row
 * bullets — the model can extract receipts (dates, RPE numbers, sleep
 * hours) without needing the full schema. Keeps the input window well
 * under the ~6k-token budget the spec calls for.
 */
function buildCompassPrompt(args: CompassInputs): string {
  const sessionLines = args.sessions
    .slice(-14)
    .map(
      (s) =>
        `${s.date} | ${s.sessionType}${s.sessionTag ? ` (${s.sessionTag})` : ""} | ${s.durationMinutes}min | RPE ${s.rpe} | ${s.intensity}${
          s.rounds ? ` | ${s.rounds} rounds` : ""
        }`,
    )
    .join("\n");

  const sleepLines = args.sleepLogs
    .slice(-7)
    .map((l) => `${l.date} | ${l.hours}h`)
    .join("\n");

  const wellnessLines = args.checkins
    .slice(-7)
    .map(
      (c) =>
        `${c.date} | Hooper ${c.hooperIndex ?? "-"} | soreness ${c.sorenessLevel} | fatigue ${c.fatigueLevel} | stress ${c.stressLevel}${
          c.sleepHours != null ? ` | sleep ${c.sleepHours}h` : ""
        }`,
    )
    .join("\n");

  const baselineLine = args.baseline
    ? [
        args.baseline.sleepHoursMean60d != null
          ? `sleep60d ${args.baseline.sleepHoursMean60d.toFixed(1)}h`
          : null,
        args.baseline.hooperMean60d != null
          ? `hooper60d ${args.baseline.hooperMean60d.toFixed(1)}`
          : null,
        args.baseline.dailyLoadMean14d != null
          ? `avgLoad14d ${Math.round(args.baseline.dailyLoadMean14d)}`
          : null,
        args.baseline.hooperCv14d != null
          ? `hooperCV14d ${args.baseline.hooperCv14d.toFixed(2)}`
          : null,
      ]
        .filter(Boolean)
        .join(" | ")
    : "(no baseline yet)";

  const priorReportLines = args.priorReports
    .map((r) => `Week of ${r.weekStartIso}: ${r.verdict}`)
    .join("\n");

  const campContext = args.activeCamp
    ? `In camp "${args.activeCamp.name}"${
        args.activeCamp.eventName ? ` (${args.activeCamp.eventName})` : ""
      } — fight date ${args.activeCamp.fightDate}.`
    : "Not currently in a fight camp.";

  return [
    `Weekly recap for week of ${args.weekStartIso}.`,
    "",
    campContext,
    "",
    `BASELINE: ${baselineLine}`,
    "",
    "SESSIONS (last 14, newest first):",
    sessionLines || "(none)",
    "",
    "SLEEP (last 7):",
    sleepLines || "(none)",
    "",
    "WELLNESS CHECK-INS (last 7):",
    wellnessLines || "(none)",
    "",
    "PRIOR WEEKS (most recent first):",
    priorReportLines || "(none)",
    "",
    "Return JSON with this exact shape:",
    "{",
    '  "verdict": "one sentence summary of the week",',
    '  "breakdown": "1-2 sentences diagnosing the week with specific receipts (cite dates, numbers, sessions)",',
    '  "nextWeekActions": [',
    '    {"dayIso": "YYYY-MM-DD", "action": "specific concrete action"},',
    '    {"dayIso": "YYYY-MM-DD", "action": "..."},',
    '    {"dayIso": "YYYY-MM-DD", "action": "..."}',
    "  ],",
    '  "campArc": "if in camp: 1 sentence comparing this week to camp arc; else omit"',
    "}",
    "No prose outside the JSON. No emojis.",
  ].join("\n");
}
