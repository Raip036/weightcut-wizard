/**
 * Weekly Training Recap — coach-voice debrief + all-time technique log.
 *
 * Pulls the user's `fight_camp_calendar` rows for the requested week,
 * computes a small stats strip server-side (LLMs are unreliable at
 * counting), and asks Groq's gpt-oss-120b for a weekly debrief: a
 * one-line headline plus up to 4 concrete takeaways (and an optional
 * "watchOut") distilled from the session notes. Persists into:
 *   - `training_summaries` (existing, schema-agnostic) for the
 *     headline + stats + debrief snapshot that drives the UI.
 *   - `training_techniques` (via upsertFromDebrief) for the all-time
 *     technique log accumulated from every week's takeaways.
 */
"use node";

import { v } from "convex/values";
import { z } from "zod";
import { action, type ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { callGroqWithRetry, GroqError } from "../_shared/groq";
import {
  logDecision,
  requireUserIdFromAction,
  SECOND_PERSON_DIRECTIVE,
} from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";
import {
  sanitizeUserText,
  PROMPT_INJECTION_GUARD_INSTRUCTION,
} from "../_shared/sanitizeUserText";

// ───────────────────────────────────────────────────────────────────────
// LLM output schema (debrief + headline only — stats are server-computed)
// ───────────────────────────────────────────────────────────────────────

const TakeawaySchema = z.object({
  discipline: z.string().min(1).max(40),
  technique: z.string().min(2).max(120),
  cue: z.string().max(60).optional(),
  detail: z.string().min(4).max(200),
  sourceSessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const LLMOutSchema = z.object({
  weekHeadline: z.string().min(8).max(160),
  debrief: z.object({
    takeaways: z.array(TakeawaySchema).min(1).max(4),
    watchOut: z.string().max(200).optional(),
  }),
});

// ───────────────────────────────────────────────────────────────────────
// Stats math (server-side; LLM is not asked for these)
// ───────────────────────────────────────────────────────────────────────

interface WeekSession {
  date: string;
  session_type: string;
  session_tag: string | null;
  intensity: string;
  intensity_level: number | null;
  duration_minutes: number;
  rpe: number;
  bodyweight: number | null;
  fatigue_level: number | null;
  soreness_level: number | null;
  sleep_hours: number | null;
  notes: string | null;
}

interface WeekStats {
  sessionsLogged: number;
  totalMinutes: number;
  topDiscipline: string;
  avgRpe?: number;
  avgSleepHours?: number;
}

function computeStats(sessions: WeekSession[]): WeekStats {
  const sessionsLogged = sessions.length;
  const totalMinutes = sessions.reduce(
    (acc, s) =>
      acc + (Number.isFinite(s.duration_minutes) ? s.duration_minutes : 0),
    0,
  );

  // Top discipline = mode of session_type (by count). Ties broken by
  // total minutes spent in that discipline — a coach who logs 2x 90-min
  // BJJ sessions beats 3x 20-min conditioning.
  const byType = new Map<string, { count: number; minutes: number }>();
  for (const s of sessions) {
    if (!s.session_type) continue;
    const cur = byType.get(s.session_type) ?? { count: 0, minutes: 0 };
    cur.count += 1;
    cur.minutes += s.duration_minutes ?? 0;
    byType.set(s.session_type, cur);
  }
  let topDiscipline = "—";
  let bestCount = -1;
  let bestMinutes = -1;
  for (const [type, agg] of byType.entries()) {
    if (
      agg.count > bestCount ||
      (agg.count === bestCount && agg.minutes > bestMinutes)
    ) {
      topDiscipline = type;
      bestCount = agg.count;
      bestMinutes = agg.minutes;
    }
  }

  // RPE / sleep averages — filter out 0 / null / NaN so an unfilled
  // field doesn't drag the average toward zero. Round to 1 decimal so
  // the strip renders cleanly with tabular-nums.
  const rpes = sessions
    .map((s) => s.rpe)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const sleeps = sessions
    .map((s) => s.sleep_hours)
    .filter((v): v is number => typeof v === "number" && v > 0);

  const avgRpe =
    rpes.length > 0
      ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10
      : undefined;
  const avgSleepHours =
    sleeps.length > 0
      ? Math.round((sleeps.reduce((a, b) => a + b, 0) / sleeps.length) * 10) /
        10
      : undefined;

  return {
    sessionsLogged,
    totalMinutes,
    topDiscipline,
    avgRpe,
    avgSleepHours,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Action
// ───────────────────────────────────────────────────────────────────────

export const run = action({
  args: { weekStart: v.string() },
  handler: async (ctx, { weekStart }) => {
    const userId = await requireUserIdFromAction(ctx);
    return runTrainingSummary(ctx, userId, weekStart);
  },
});

async function runTrainingSummary(
  ctx: ActionCtx,
  userId: Id<"users">,
  weekStart: string,
) {
  await enforceFeatureGate(ctx, userId, "AI_TRAINING_SUMMARY");

  const data = await ctx.runQuery(internal.actions_internal.fetchTrainingWeek, {
    userId,
    weekStart,
  });
  const allSessions = (data.sessions ?? []) as WeekSession[];

  // Only sessions with non-empty notes are useful for debrief mining.
  const sessionsWithNotes = allSessions.filter(
    (s) => typeof s?.notes === "string" && s.notes.trim().length > 0,
  );

  // Compute stats from ALL sessions (with or without notes) — a session
  // logged with no notes still counts toward the week's volume.
  const stats = computeStats(allSessions);

  if (sessionsWithNotes.length === 0) {
    // No notes → no debrief to generate, but we still return the stats
    // strip + a calm placeholder headline so the UI doesn't render a
    // jarring empty state when a user has just been logging sessions
    // without notes.
    return {
      weekHeadline:
        allSessions.length === 0
          ? "No training logged this week."
          : "Add session notes to unlock your weekly debrief.",
      stats,
      debrief: {
        takeaways: [] as Array<{
          discipline: string; technique: string; cue?: string;
          detail: string; sourceSessionDate?: string;
        }>,
        watchOut: undefined as string | undefined,
      },
    };
  }

  // Build the sessions block the LLM sees. Sanitize every notes blob
  // so a prompt-injection payload inside a fighter's free-text can't
  // hijack the system prompt.
  const disciplinesTrained = Array.from(
    new Set(sessionsWithNotes.map((s) => s.session_type).filter(Boolean)),
  );
  const sessionsText = sessionsWithNotes
    .map((s) => {
      const cleanNotes = sanitizeUserText(s.notes ?? "", {
        maxLength: 800,
        raw: true,
      });
      const discipline = `${s.session_type}${s.session_tag ? ` (${s.session_tag})` : ""}`;
      return `${s.date} | ${discipline} | ${s.duration_minutes}min | Notes: <user_input>${cleanNotes}</user_input>`;
    })
    .join("\n");

    const systemPrompt = `You write a WEEKLY TRAINING DEBRIEF for a combat-sports athlete from their own session notes. Output two things: a one-sentence weekHeadline summarising the week's focus, and a "debrief" with up to 4 "takeaways" plus an optional "watchOut".

Each takeaway distils ONE concrete thing the athlete drilled or learned this week, pulled from their notes:
- "discipline": the session_type EXACTLY as given (Boxing is not Muay Thai). Do not merge or rename disciplines.
- "technique": the specific move/skill (e.g. "Scissor sweep", "Check hook").
- "cue": OPTIONAL single mnemonic of at most 4 words ("Hook-Push-Tilt"). Omit if there isn't a clean one.
- "detail": one line, second person, that captures the actual lesson/cue from the notes (<=200 chars).
- "sourceSessionDate": YYYY-MM-DD of the session it came from, when one note clearly seeded it. Metadata only.

"watchOut" (optional): a single recurring issue the notes reveal (e.g. a habit that keeps costing them). Omit it entirely if the notes show no clear recurring problem. Do NOT invent one.

Pull ONLY from the notes below. DO NOT write generic motivation. DO NOT prescribe next steps or step-by-step instructions (the Training Coach feature owns forward-looking prescriptions). NEVER include calendar dates, day names, or week references inside technique/detail/cue/watchOut — dates live only in sourceSessionDate.

${SECOND_PERSON_DIRECTIVE}

${PROMPT_INJECTION_GUARD_INSTRUCTION}

Return ONLY valid JSON in this EXACT shape:
{
  "weekHeadline": "one sentence summarising the week's training focus (<= 140 chars, second person)",
  "debrief": {
    "takeaways": [
      { "discipline": "BJJ", "technique": "Scissor sweep", "cue": "Hook-Push-Tilt", "detail": "Hook the far ankle, push the near knee through, tilt them onto the open side.", "sourceSessionDate": "2026-05-19" }
    ],
    "watchOut": "Your left hook keeps dropping when you reset your stance."
  }
}`;

  const userPrompt = `Here are my training sessions from this week. Give me a debrief of what I worked on:\n\n${sessionsText}`;

  // Heavy reasoning model — debrief quality (distilling messy notes into a
  // crisp headline + concrete takeaways with mnemonic cues) was poor on
  // llama-3.1-8b-instant in spec testing. gpt-oss-120b handles the
  // notes-to-takeaway distillation cleanly.
  const MODEL = "openai/gpt-oss-120b";
  let llmOut: z.infer<typeof LLMOutSchema>;
  try {
    llmOut = await callGroqWithRetry({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 1800,
      response_format: { type: "json_object" },
      schema: LLMOutSchema,
      timeoutMs: 15_000,
    });
  } catch (err) {
    // GroqError already carries a stable code for the client; rethrow.
    if (err instanceof GroqError) throw err;
    throw new Error(
      err instanceof Error ? err.message : "AI returned malformed summary",
    );
  }

  const summaryData = {
    weekHeadline: llmOut.weekHeadline,
    stats,
    debrief: llmOut.debrief,
  };

  // Persist (a) the recap snapshot in `training_summaries` and (b) each
  // takeaway into the all-time `training_techniques` log (below). The
  // existing `notesFingerprint` / `sessionIds` columns are populated from
  // the server-known rows so the frontend's change-detection (which keys
  // on `notesFingerprint`) keeps working unchanged.
  const sessionIds = sessionsWithNotes.map((s) => s.date);
  const notesFingerprint = sessionsWithNotes
    .map((s) => `${s.date}|${(s.notes ?? "").trim().length}`)
    .sort()
    .join(";");

  try {
    await ctx.runMutation(api.fight_camp.upsertSummary, {
      weekStart,
      sessionIds,
      notesFingerprint,
      summaryData,
    });
  } catch (err) {
    // Saving is best-effort from the action's perspective — surface
    // the LLM result to the caller even if persistence fails so the
    // user sees their cards. The auto-summary cron will retry on the
    // next session save.
    console.warn("[trainingSummary] upsertSummary failed", err);
  }

  try {
    await ctx.runMutation(internal.training_techniques.upsertFromDebrief, {
      userId,
      weekStart,
      takeaways: llmOut.debrief.takeaways,
    });
  } catch (err) {
    console.warn("[trainingSummary] upsertFromDebrief failed", err);
  }

  // Audit trail — feature name stays "training_summary" so existing
  // `ai_decisions` analytics filters still work.
  await logDecision(ctx, {
    userId,
    feature: "training_summary",
    inputSnapshot: {
      weekStart,
      sessionCount: allSessions.length,
      notesCount: sessionsWithNotes.length,
      disciplinesTrained,
    },
    outputJson: summaryData,
    model: MODEL,
  });

  return summaryData;
}
