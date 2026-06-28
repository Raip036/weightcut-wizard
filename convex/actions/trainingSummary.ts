/**
 * Weekly Training Recap — INCREMENTAL, per-session generation.
 *
 * The recap used to regenerate the WHOLE week on every run: it re-read every
 * session's notes and re-wrote every technique's detail + steps with
 * gpt-oss-120b, even for sessions already summarised on a prior run. That
 * burned tokens re-creating work the `training_techniques` log only dedupes
 * AFTER the model has already paid for it.
 *
 * Now generation is per-session and cached:
 *   - Each session's takeaways are cached on the `training_summaries` row
 *     (server-only `sessionCache`), keyed by session id + a content fingerprint.
 *   - On run we diff the week: sessions whose content is unchanged are reused
 *     for free; only NEW or EDITED sessions get an LLM call.
 *   - Each dirty-session call also returns a cheap, refreshed week headline +
 *     watch-out (fed the already-captured technique names + the prior watch-out),
 *     so the week-level summary stays fresh at near-zero extra cost.
 *   - The week recap = the union of all sessions' cached takeaways, deduped.
 *
 * Persists into:
 *   - `training_summaries` for the headline + stats + debrief snapshot + the
 *     per-session cache.
 *   - `training_techniques` (via upsertFromDebrief) for the all-time technique
 *     log, which keeps its own per-technique dedup as a safety net.
 */
"use node";

import { v } from "convex/values";
import { z } from "zod";
import { createHash } from "node:crypto";
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

const MODEL = "openai/gpt-oss-120b";

// ───────────────────────────────────────────────────────────────────────
// LLM output schema (one session at a time). Stats are server-computed.
// ───────────────────────────────────────────────────────────────────────

const TakeawaySchema = z.object({
  discipline: z.string().min(1).max(40),
  technique: z.string().min(2).max(120),
  cue: z.string().max(60).optional(),
  detail: z.string().min(4).max(200),
  // Cap is a sanity backstop, not a style gate — keep it generous so a slightly
  // long but valid step never hard-fails generation (the prompt asks for tight
  // steps for the UI; the model occasionally runs over a tight cap).
  steps: z.array(z.string().min(1).max(160)).min(2).max(6),
  sourceSessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// One LLM call processes ONE session: 1-2 takeaways for that session plus a
// refreshed whole-week headline and optional watch-out.
const SessionLLMOutSchema = z.object({
  weekHeadline: z.string().min(8).max(160),
  takeaways: z.array(TakeawaySchema).min(1).max(2),
  watchOut: z.string().max(200).optional(),
});

type Takeaway = z.infer<typeof TakeawaySchema>;

// Server-only per-session cache entry stored on the training_summaries row.
interface SessionCacheEntry {
  sessionId: string;
  fingerprint: string;
  takeaways: Takeaway[];
}

// ───────────────────────────────────────────────────────────────────────
// Stats math (server-side; LLM is not asked for these)
// ───────────────────────────────────────────────────────────────────────

interface WeekSession {
  id: string;
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
  techniques_notes?: string | null;
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

  // Top discipline = mode of session_type (by count). Ties broken by total
  // minutes spent in that discipline.
  const byType = new Map<string, { count: number; minutes: number }>();
  for (const s of sessions) {
    if (!s.session_type) continue;
    const cur = byType.get(s.session_type) ?? { count: 0, minutes: 0 };
    cur.count += 1;
    cur.minutes += s.duration_minutes ?? 0;
    byType.set(s.session_type, cur);
  }
  let topDiscipline = "·";
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

  // RPE / sleep averages — filter out 0 / null / NaN so an unfilled field
  // doesn't drag the average toward zero. Round to 1 decimal.
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
// Fingerprints
// ───────────────────────────────────────────────────────────────────────

/** Per-session content fingerprint — the cache key. Changes when (and only
 *  when) the session's notes/techniques content changes. */
function sessionContentFingerprint(
  notes: string | null | undefined,
  techniques: string | null | undefined,
): string {
  const basis = `${(notes ?? "").trim()}␟${(techniques ?? "").trim()}`;
  return createHash("sha1").update(basis).digest("hex");
}

/** Week-level fingerprint that drives the client's "Update / Up to date"
 *  button. MUST stay byte-identical to `computeFingerprint` in
 *  src/components/fightcamp/TrainingSummarySection.tsx. */
function weekNotesFingerprint(sessionsWithNotes: WeekSession[]): string {
  return [...sessionsWithNotes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => `${s.id}:${s.notes ?? ""}:${s.techniques_notes ?? ""}`)
    .join("|");
}

/** Dedup key mirroring training_techniques.normalizeTechniqueKey. */
function normalizeKey(discipline: string, technique: string): string {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  return `${norm(discipline)}::${norm(technique)}`;
}

// ───────────────────────────────────────────────────────────────────────
// Per-session generation
// ───────────────────────────────────────────────────────────────────────

function buildSessionBlock(s: WeekSession): string {
  const cleanTechniques = sanitizeUserText(s.techniques_notes ?? "", {
    maxLength: 800,
    raw: true,
  });
  const cleanReflection = sanitizeUserText(s.notes ?? "", {
    maxLength: 800,
    raw: true,
  });
  const discipline = `${s.session_type}${s.session_tag ? ` (${s.session_tag})` : ""}`;
  const lines = [`${s.date} | ${discipline} | ${s.duration_minutes}min`];
  if (cleanTechniques.trim().length > 0) {
    lines.push(`Techniques: <user_input>${cleanTechniques}</user_input>`);
  }
  if (cleanReflection.trim().length > 0) {
    lines.push(`Reflection: <user_input>${cleanReflection}</user_input>`);
  }
  return lines.join("\n");
}

const SESSION_SYSTEM_PROMPT = `You write ONE entry of a weekly training debrief for a combat-sports athlete, from a SINGLE training session's notes. Return a refreshed one-line weekHeadline for the whole week, 1 to 2 "takeaways" distilled from THIS session, and an optional "watchOut".

TERMINOLOGY. You are a coach writing for a serious athlete. Use precise, professional terminology for the EXACT sport of this session; never vague layman wording.
- Name techniques by their real names. Boxing: slip, roll/weave, parry, pull counter, check hook, jab, cross, lead/rear hook, uppercut. Muay Thai: teep, switch kick, checking, clinch, sweep, dump, spinning elbow, horizontal/uppercut elbow. BJJ/grappling: scissor sweep, hip-bump sweep, guard retention, single/double leg, back take, armbar, triangle, kimura. Wrestling: underhook, snap down, sprawl, level change, high crotch. MMA blends these.
- Describe execution mechanically and CORRECTLY. Never write an imprecise cue like "tilt your head" for a slip; a slip is a small rotation of the torso and hips that moves the head just off the centre line. Use the language a coach holding pads would actually use.
- Respect SIDES and STANCE when the note states them. If the athlete wrote "caught the left kick" or "left-leg catch", reflect that exact side throughout the technique and steps (e.g. "Catch the opponent's left kick with your right arm"). Never invent a side that was not stated.

The session may provide a "Techniques" block (the combos/positions/drills they drilled, the primary source for takeaways) and a "Reflection" block (what went well / to improve, the primary source for watchOut). Either block may be absent. If there is no Techniques block, still mine techniques from the Reflection block.

Each takeaway distils ONE concrete technique drilled in THIS session:
- "discipline": the session_type EXACTLY as given. Do not rename it.
- "technique": the precise, correctly-named move (e.g. "Spinning elbow off a caught kick", "Scissor sweep").
- "cue": OPTIONAL single mnemonic of at most 4 words ("Catch-Switch-Spin"). Omit if there is no clean one.
- "detail": ONE short line (<=140 chars, second person) saying what the technique is and when to use it. A summary, NOT the steps; do not repeat the steps here.
- "steps": an ORDERED array of 2 to 6 short imperative steps that EXECUTE the technique. Each step is one tight line (aim for under ~110 chars), verb-led, second person, concrete and mechanically correct, so they read cleanly as a numbered list.
- "sourceSessionDate": the YYYY-MM-DD date of this session.

"weekHeadline": one sentence (<=140 chars, second person) summarising the week's training focus. Use the list of already-captured techniques you are given PLUS this session so it reflects the whole week, not just this one session.

"watchOut" (optional): a single recurring issue the notes reveal (a habit that keeps costing them). Omit entirely if none is clear. Do NOT invent one.

Pull ONLY from the notes provided. DO NOT write generic motivation. DO NOT prescribe forward-looking training plans in detail/watchOut (the Training Coach feature owns prescriptions); the "steps" array describes how to EXECUTE a technique the athlete already drilled, which is required and allowed. NEVER include calendar dates, day names, or week references inside technique/detail/cue/steps/watchOut; dates live only in sourceSessionDate.

${SECOND_PERSON_DIRECTIVE}

${PROMPT_INJECTION_GUARD_INSTRUCTION}

Return ONLY valid JSON in this EXACT shape:
{
  "weekHeadline": "one sentence summarising the week's training focus (<= 140 chars, second person)",
  "takeaways": [
    { "discipline": "Muay Thai", "technique": "Spinning elbow off a caught kick", "cue": "Catch-Switch-Spin", "detail": "A counter that turns a caught low kick into a fight-ending elbow.", "steps": ["Catch the left kick with your right arm", "Trap it against your hip and switch your hands", "Step across with your lead foot", "Spin, turning your eyes to the target first", "Drive the point of the elbow up and through"], "sourceSessionDate": "2026-05-19" }
  ],
  "watchOut": "Your left hook keeps dropping when you reset your stance."
}`;

async function generateForSession(
  session: WeekSession,
  knownTechniqueNames: string[],
  priorWatchOut: string | undefined,
): Promise<z.infer<typeof SessionLLMOutSchema>> {
  const known =
    knownTechniqueNames.length > 0
      ? `Techniques already captured this week (do NOT repeat these unless this session genuinely adds a new variation): ${knownTechniqueNames.join(", ")}.`
      : "No techniques have been captured yet this week.";
  const prior = priorWatchOut
    ? `Previously noted watch-out: "${priorWatchOut}". Keep it if it still holds, or replace it if this session reveals a clearer recurring issue.`
    : "No prior watch-out.";

  const userPrompt = `${known}\n${prior}\n\nHere is the training session to debrief:\n\n${buildSessionBlock(session)}`;

  return await callGroqWithRetry({
    model: MODEL,
    messages: [
      { role: "system", content: SESSION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 1400,
    response_format: { type: "json_object" },
    schema: SessionLLMOutSchema,
    timeoutMs: 15_000,
  });
}

// ───────────────────────────────────────────────────────────────────────
// Persistence
// ───────────────────────────────────────────────────────────────────────

async function persistSummary(
  ctx: ActionCtx,
  weekStart: string,
  sessionsWithNotes: WeekSession[],
  sessionCache: SessionCacheEntry[],
  summaryData: unknown,
) {
  try {
    await ctx.runMutation(api.fight_camp.upsertSummary, {
      weekStart,
      sessionIds: sessionsWithNotes.map((s) => s.id),
      notesFingerprint: weekNotesFingerprint(sessionsWithNotes),
      summaryData,
      sessionCache,
    });
  } catch (err) {
    // Best-effort: surface the recap to the caller even if persistence fails.
    console.warn("[trainingSummary] upsertSummary failed", err);
  }
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

  // A session is recap-worthy if EITHER its reflection or its techniques log
  // has content (technique-only logs are the primary source for takeaways).
  const sessionsWithNotes = allSessions.filter(
    (s) =>
      (typeof s?.notes === "string" && s.notes.trim().length > 0) ||
      (typeof s?.techniques_notes === "string" &&
        s.techniques_notes.trim().length > 0),
  );

  // Stats come from ALL sessions — a note-less session still counts as volume.
  const stats = computeStats(allSessions);

  // Prior recap state: the server-only per-session cache + last headline/watch-out.
  const prior = await ctx.runQuery(
    internal.actions_internal.fetchWeekRecapCache,
    { userId, weekStart },
  );
  const priorCache = (prior?.sessionCache ?? []) as SessionCacheEntry[];
  const priorSummary = (prior?.summaryData ?? null) as
    | { weekHeadline?: string; debrief?: { watchOut?: string } }
    | null;
  const cacheBySession = new Map(priorCache.map((e) => [e.sessionId, e]));

  if (sessionsWithNotes.length === 0) {
    // No notes → no debrief. Return stats + a calm placeholder and clear any
    // stale per-session cache so deleted content doesn't linger.
    const empty = {
      weekHeadline:
        allSessions.length === 0
          ? "No training logged this week."
          : "Add session notes to unlock your weekly debrief.",
      stats,
      debrief: {
        takeaways: [] as Takeaway[],
        watchOut: undefined as string | undefined,
      },
    };
    await persistSummary(ctx, weekStart, sessionsWithNotes, [], empty);
    return empty;
  }

  // Partition: reuse cache hits for free, regenerate only new/changed sessions.
  const newCache: SessionCacheEntry[] = [];
  const dirty: WeekSession[] = [];
  for (const s of sessionsWithNotes) {
    const fp = sessionContentFingerprint(s.notes, s.techniques_notes);
    const hit = cacheBySession.get(s.id);
    if (hit && hit.fingerprint === fp) {
      newCache.push({ sessionId: s.id, fingerprint: fp, takeaways: hit.takeaways });
    } else {
      dirty.push(s);
    }
  }

  // Headline + watch-out carry over from the last run; each dirty session
  // refreshes them cheaply (it is handed the known names + prior watch-out).
  let headline = priorSummary?.weekHeadline ?? "";
  let watchOut = priorSummary?.debrief?.watchOut;
  let knownNames = newCache.flatMap((e) => e.takeaways.map((t) => t.technique));

  for (const s of dirty) {
    let out: z.infer<typeof SessionLLMOutSchema>;
    try {
      out = await generateForSession(s, knownNames, watchOut);
    } catch (err) {
      if (err instanceof GroqError) throw err;
      throw new Error(
        err instanceof Error ? err.message : "AI returned malformed summary",
      );
    }
    headline = out.weekHeadline;
    if (out.watchOut) watchOut = out.watchOut;
    newCache.push({
      sessionId: s.id,
      fingerprint: sessionContentFingerprint(s.notes, s.techniques_notes),
      takeaways: out.takeaways,
    });
    knownNames = knownNames.concat(out.takeaways.map((t) => t.technique));
  }

  // Assemble the week pool: order by session date, dedupe by technique so two
  // sessions drilling the same move show once.
  const dateById = new Map(sessionsWithNotes.map((s) => [s.id, s.date]));
  const orderedCache = [...newCache].sort((a, b) =>
    (dateById.get(a.sessionId) ?? "").localeCompare(dateById.get(b.sessionId) ?? ""),
  );
  const seen = new Set<string>();
  const pool: Takeaway[] = [];
  for (const entry of orderedCache) {
    for (const t of entry.takeaways) {
      const key = normalizeKey(t.discipline, t.technique);
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(t);
    }
  }

  if (!headline) headline = "Your training week in review.";

  const summaryData = {
    weekHeadline: headline,
    stats,
    debrief: { takeaways: pool, watchOut },
  };

  await persistSummary(ctx, weekStart, sessionsWithNotes, newCache, summaryData);

  // All-time technique log (idempotent per technique; its own dedup is a net).
  try {
    await ctx.runMutation(internal.training_techniques.upsertFromDebrief, {
      userId,
      weekStart,
      takeaways: pool,
    });
  } catch (err) {
    console.warn("[trainingSummary] upsertFromDebrief failed", err);
  }

  await logDecision(ctx, {
    userId,
    feature: "training_summary",
    inputSnapshot: {
      weekStart,
      sessionCount: allSessions.length,
      notesCount: sessionsWithNotes.length,
      dirtyCount: dirty.length,
      reusedCount: sessionsWithNotes.length - dirty.length,
    },
    outputJson: summaryData,
    model: MODEL,
  });

  return summaryData;
}
