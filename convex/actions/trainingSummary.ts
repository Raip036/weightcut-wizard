/**
 * Weekly Training Summary — retention-focused flashcards.
 *
 * Spec: docs/superpowers/specs/2026-05-21-training-summary-flashcards.md
 *
 * Pulls the user's `fight_camp_calendar` rows for the requested week,
 * computes a small stats strip server-side (LLMs are unreliable at
 * counting), and asks Groq's gpt-oss-120b for 3-6 recall flashcards
 * distilled from the session notes. Persists into two tables:
 *   - `training_summaries` (existing, schema-agnostic) for the
 *     headline + stats + cards snapshot that drives the UI.
 *   - `training_summary_cards` (new) for the per-card spaced-
 *     repetition state.
 */
"use node";

import { v } from "convex/values";
import { z } from "zod";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
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
// LLM output schema (cards + headline only — stats are server-computed)
// ───────────────────────────────────────────────────────────────────────

const CardSchema = z.object({
  sport: z.string().min(1).max(40),
  front: z.string().min(8).max(140),
  back: z.string().min(8).max(280),
  cue: z.string().max(60).optional(),
  sourceSessionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const LLMOutSchema = z.object({
  weekHeadline: z.string().min(8).max(160),
  cards: z.array(CardSchema).min(2).max(8),
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
    (acc, s) => acc + (Number.isFinite(s.duration_minutes) ? s.duration_minutes : 0),
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
    await enforceFeatureGate(ctx, userId, "AI_TRAINING_SUMMARY");

    const data = await ctx.runQuery(
      internal.actions_internal.fetchTrainingWeek,
      { userId, weekStart },
    );
    const allSessions = (data.sessions ?? []) as WeekSession[];

    // Only sessions with non-empty notes are useful for flashcard mining.
    const sessionsWithNotes = allSessions.filter(
      (s) => typeof s?.notes === "string" && s.notes.trim().length > 0,
    );

    // Compute stats from ALL sessions (with or without notes) — a session
    // logged with no notes still counts toward the week's volume.
    const stats = computeStats(allSessions);

    if (sessionsWithNotes.length === 0) {
      // No notes → no cards to generate, but we still return the stats
      // strip + a calm placeholder headline so the UI doesn't render a
      // jarring empty state when a user has just been logging sessions
      // without notes.
      return {
        weekHeadline:
          allSessions.length === 0
            ? "No training logged this week."
            : "Add session notes to unlock weekly flashcards.",
        stats,
        cards: [] as Array<{
          sport: string;
          front: string;
          back: string;
          cue?: string;
          sourceSessionDate?: string;
        }>,
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

    const systemPrompt = `You write FLASHCARDS for a combat-sports athlete to memorise what they trained this week. Each card has a "front" (a short recall PROMPT or QUESTION — never the answer) and a "back" (the answer/cue, 1-2 lines, second person, memorable). Optional "cue" is a single mnemonic phrase of at most 4 words ("Trap-Then-Tilt", "Frame-Bridge-Roll").

Pull cards from the athlete's own notes below — techniques mentioned, coach feedback, specific lessons. DO NOT write generic motivation. DO NOT prescribe next steps or step-by-step instructions (the Training Coach feature owns forward-looking prescriptions). The "front" MUST be retrievable from the "back" — it should be a recall prompt or question the back content actually answers.

CRITICAL — the flashcard content (front, back, cue) must test the TECHNIQUE ITSELF, never the date or day it was practiced. NEVER include calendar dates, day names ("Monday", "yesterday"), week references ("this week", "last session"), or any temporal framing inside the front, back, or cue fields. A user reviewing this card weeks later should be able to study it without any sense of when it was logged. Example BAD front: "On Tuesday's BJJ session, what was the sweep?" Example GOOD front: "Scissor sweep — what's the base-leg cue?". Dates only live in the separate "sourceSessionDate" metadata field, never in user-visible text.

Generate 3 to 6 cards, balanced across the disciplines actually trained this week (${disciplinesTrained.join(", ") || "the disciplines below"}). Use the session_type values EXACTLY as given for each card's "sport" field. Do not merge or rename disciplines (Boxing is not Muay Thai). Set "sourceSessionDate" to the YYYY-MM-DD of the session a card was distilled from when one note clearly seeded it — this is metadata only and is NOT shown to the athlete.

${SECOND_PERSON_DIRECTIVE}

${PROMPT_INJECTION_GUARD_INSTRUCTION}

Return ONLY valid JSON in this EXACT shape:
{
  "weekHeadline": "one sentence summarising the week's training focus (≤ 140 chars, second person)",
  "cards": [
    {
      "sport": "BJJ",
      "front": "Scissor sweep — what's the base-leg cue?",
      "back": "Hook the far ankle with your top leg, push the near knee through with your bottom shin, then tilt them onto the open side.",
      "cue": "Hook-Push-Tilt",
      "sourceSessionDate": "2026-05-19"
    }
  ]
}`;

    const userPrompt = `Here are my training sessions from this week. Write flashcards I can quiz myself on so I remember what I trained:\n\n${sessionsText}`;

    // Heavy reasoning model — flashcard quality (front is a true recall
    // prompt, back is memorable, cue is mnemonic-quality) was poor on
    // llama-3.1-8b-instant in spec testing. gpt-oss-120b handles the
    // pivot-from-notes-to-question phrasing cleanly.
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
      cards: llmOut.cards,
    };

    // Persist (a) the snapshot in `training_summaries` and (b) the per-
    // card SR state in `training_summary_cards`. The existing
    // `notesFingerprint` / `sessionIds` columns are populated from the
    // server-known rows so the frontend's change-detection (which keys
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
      await ctx.runMutation(
        internal.training_summary_cards.upsertCardsFromSummary,
        {
          userId,
          weekStart,
          cards: llmOut.cards,
        },
      );
    } catch (err) {
      console.warn("[trainingSummary] upsertCardsFromSummary failed", err);
    }

    // Audit trail — feature name stays "training_summary" so existing
    // `ai_decisions` analytics filters still work.
    logDecision(ctx, {
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
  },
});
