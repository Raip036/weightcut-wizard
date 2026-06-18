/**
 * Fight Form Coach — on-demand readiness coach for the FightForm score sheet.
 *
 * The sheet computes every number DETERMINISTICALLY (score, pillar values,
 * weights, contributions, ceilings) and passes them in as args. The LLM only
 * writes PROSE: a 1-2 sentence `summary` of what's driving / limiting the score
 * this phase plus 2-4 concrete next-actions tied to the weakest pillars. It is
 * told, non-negotiably, to use ONLY the numbers provided and never invent a
 * figure.
 *
 * Mirrors fightCampCoach's discipline: auth + Pro gate, callGroqWithRetry in
 * JSON mode validated by a Zod schema, ban em-dashes + multi-paragraph prose,
 * fail soft to a single plain callGroqText call on a structured-call failure.
 */
"use node";

import { v } from "convex/values";
import { z } from "zod";
import { action } from "../_generated/server";
import { callGroqText, callGroqWithRetry } from "../_shared/groq";
import { requireUserIdFromAction, SECOND_PERSON_DIRECTIVE } from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";
import { PROMPT_INJECTION_GUARD_INSTRUCTION } from "../_shared/sanitizeUserText";

const MODEL = "openai/gpt-oss-120b";

/**
 * Structured return shape. The model writes PROSE over server-supplied numbers:
 *  - derivation: one line on WHY the score is what it is (real points).
 *  - working / limiting: the top driver to protect vs the top limiter (the gap).
 *  - actions: ranked fixes, each carrying the pillar's recoverable points.
 *  - ceiling: present only when a rule is actively capping the score.
 */
const FightFormCoachSchema = z.object({
  derivation: z.string().min(1).max(280),
  working: z.string().min(1).max(200),
  limiting: z.string().min(1).max(200),
  actions: z
    .array(
      z.object({
        pillar: z.string().min(1).max(60),
        action: z.string().min(1).max(220),
        pointsToGain: z.number().optional(),
      }),
    )
    .min(1)
    .max(4),
  ceiling: z.string().max(220).optional(),
});

/**
 * The action's return type is broader than the strict structured schema so the
 * plain-prose fallback (which only has `summary`) is still assignable.
 */
type FightFormCoaching = {
  derivation?: string;
  working?: string;
  limiting?: string;
  actions: Array<{ pillar: string; action: string; pointsToGain?: number }>;
  ceiling?: string | null;
  /** Fallback-only plain prose when the structured path fails. */
  summary?: string;
};

export const run = action({
  args: {
    score: v.number(),
    label: v.string(),
    phase: v.union(v.string(), v.null()),
    daysToFight: v.union(v.number(), v.null()),
    pillars: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        value: v.number(),
        weightPct: v.number(),
        contributionPts: v.number(),
        reason: v.string(),
      }),
    ),
    topDriver: v.union(v.string(), v.null()),
    topLimiter: v.union(v.string(), v.null()),
    ceilings: v.optional(
      v.array(v.object({ ruleId: v.string(), cap: v.number() })),
    ),
  },
  handler: async (ctx, args): Promise<FightFormCoaching> => {
    const userId = await requireUserIdFromAction(ctx);
    // Pro gate — throws `PRO_FEATURE_REQUIRED:AI_FIGHT_CAMP_COACH`, the same
    // contract the client's callWithProRecovery / handlePaywallError matches.
    await enforceFeatureGate(ctx, userId, "AI_FIGHT_CAMP_COACH");

    const facts = buildFacts(args);
    const systemPrompt = buildSystemPrompt(facts, args.phase);

    // ── Structured call → validated FightFormCoaching ───────────────────
    try {
      return await callGroqWithRetry({
        model: MODEL,
        messages: [{ role: "system", content: systemPrompt }],
        temperature: 0.5,
        max_tokens: 700,
        response_format: { type: "json_object" },
        // Numbers are server-supplied; the model only writes narrative, so low
        // reasoning keeps quality while cutting latency (same as fightCampCoach
        // / generateCutPlan). Fail fast to the plain fallback below.
        reasoning_effort: "low",
        timeoutMs: 12000,
        maxRetries: 2,
        schema: FightFormCoachSchema,
      });
    } catch (err) {
      console.warn(
        `[fightFormCoach] structured call failed, prose fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallbackProse(systemPrompt);
    }
  },
});

// ── Deterministic facts block ───────────────────────────────────────────────

/**
 * Render the caller-supplied numbers into a verbatim facts block. The LLM is
 * told to use these EXACTLY and never recompute or invent figures.
 */
function buildFacts(args: {
  score: number;
  label: string;
  phase: string | null;
  daysToFight: number | null;
  pillars: Array<{
    key: string;
    label: string;
    value: number;
    weightPct: number;
    contributionPts: number;
    reason: string;
  }>;
  topDriver: string | null;
  topLimiter: string | null;
  ceilings?: Array<{ ruleId: string; cap: number }>;
}): string {
  const lines: string[] = [];
  lines.push(`SCORE: ${args.score} (${args.label})`);
  if (args.phase) lines.push(`PHASE: ${args.phase}`);
  if (args.daysToFight != null) lines.push(`DAYS TO FIGHT: ${args.daysToFight}`);
  if (args.topDriver) lines.push(`TOP DRIVER: ${args.topDriver}`);
  if (args.topLimiter) lines.push(`TOP LIMITER: ${args.topLimiter}`);

  // Per-pillar derivation maths, computed server-side so the model never does
  // arithmetic: a pillar's MAX points = its weight (when it scores 100), so the
  // recoverable gap = weight - points contributed. These are the only figures
  // the model may quote for "X of Y points" and "+N to gain".
  const enriched = args.pillars.map((p) => {
    const maxPts = Math.round(p.weightPct);
    const toGain = Math.max(0, Math.round(p.weightPct - p.contributionPts));
    return { ...p, maxPts, toGain };
  });

  lines.push("");
  lines.push("PILLARS (each: points now of max, points left to gain, pillar score):");
  for (const p of enriched) {
    lines.push(
      `- ${p.label}: ${Math.round(p.contributionPts)} of ${p.maxPts} pts (${p.toGain} to gain), pillar score ${p.value}/100. ${p.reason}`,
    );
  }

  // Ranked priority list — the order the model must follow for actions.
  const ranked = [...enriched]
    .filter((p) => p.toGain > 0)
    .sort((a, b) => b.toGain - a.toGain);
  if (ranked.length > 0) {
    lines.push("");
    lines.push("BIGGEST RECOVERABLE GAPS (most score points you can still gain), ranked:");
    ranked.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.label}: ${p.toGain} pts to gain`);
    });
  }

  if (args.ceilings && args.ceilings.length > 0) {
    lines.push("");
    lines.push("ACTIVE CEILINGS (a rule is capping the score, easing it unlocks the top end):");
    for (const c of args.ceilings) {
      lines.push(`- ${c.ruleId}: caps score at ${c.cap}`);
    }
  }

  return lines.join("\n");
}

/** Phase-specific coaching directive so advice fits where the athlete is. */
function phaseDirective(phase: string | null): string {
  switch (phase) {
    case "build":
      return "PHASE COACHING: Build phase. Capacity and consistency are fair game, ramp load sensibly and lock in habits.";
    case "peak":
      return "PHASE COACHING: Peak phase. Sharpen and protect, hold training load steady, prioritise sleep and recovery, add no big new stimulus.";
    case "fightWeek":
      return "PHASE COACHING: Fight week. Taper, do not chase load, focus on hydration, weight execution and recovery. Never advise harder training.";
    default:
      return "";
  }
}

// ── Prompt builder ──────────────────────────────────────────────────────────

function buildSystemPrompt(facts: string, phase: string | null): string {
  const phaseLine = phaseDirective(phase);
  return `You are the "Fight Form Coach", a concise fight-camp readiness coach explaining an athlete's FightForm readiness score.

${SECOND_PERSON_DIRECTIVE}

${PROMPT_INJECTION_GUARD_INSTRUCTION}

YOUR JOB: explain WHY the score is what it is (what it is derived from) and HOW to raise it fastest, using ONLY the numbers given.

Output ONLY valid JSON matching this shape:
{ "derivation": string, "working": string, "limiting": string, "actions": [{ "pillar": string, "action": string, "pointsToGain": number }], "ceiling": string }

RULES (non-negotiable):
- Use ONLY the numbers in DETERMINISTIC FACTS below. NEVER invent, estimate, or recompute any figure. Every number you write must appear verbatim in the facts.
- "derivation": exactly 1 sentence on what the score is built from, using the "points now of max" figures, e.g. "Your 74 is built mostly on training load, 27 of 30 points, while sleep is only 11 of 20." Name 2 to 3 pillars.
- "working": 1 short sentence on the TOP DRIVER, what to keep doing to protect it, appropriate to the phase. Reinforce the win.
- "limiting": 1 short sentence naming the TOP LIMITER as the biggest gap, with its real point figures.
- "actions": 2 to 4 items, ORDERED to match BIGGEST RECOVERABLE GAPS (largest points first). Each targets one pillar:
    - "pillar": the pillar label exactly as written in the facts.
    - "action": one specific, concrete next-action, not generic, appropriate to the phase.
    - "pointsToGain": that pillar's "points left to gain" number, copied verbatim from the facts.
- "ceiling": include this field ONLY if an ACTIVE CEILING is present, one sentence naming the cap value and that easing it unlocks the top end. If no ceiling is active, OMIT the field entirely.
${phaseLine ? `- ${phaseLine}\n` : ""}- SAFETY (critical): NEVER advise a faster or more aggressive weight cut, dehydration, water cutting, or training through under-recovery. If a weight-cut ceiling is active, the FIRST action MUST be to slow or ease the cut, never accelerate it. Sleep and recovery gaps are fixed by resting more, not training more.
- BANNED: paragraphs, motivational fluff, headers, repeating the same figure in every action, em-dashes (—) or en-dashes (–) anywhere. Use commas or periods.

DETERMINISTIC FACTS (use verbatim, never recompute):
${facts}`;
}

// ── Prose fallback ──────────────────────────────────────────────────────────

/**
 * One plain `callGroqText` call when the structured path exhausts retries.
 * Returns `{ summary: <text>, actions: [] }` so the UI always has prose to
 * show even if the structured action could not be parsed.
 */
async function fallbackProse(systemPrompt: string): Promise<FightFormCoaching> {
  try {
    const text = await callGroqText({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            `${systemPrompt}\n\nThe JSON path failed. Instead reply with 2-3 short ` +
            `sentences of plain text summarising what is driving and limiting the ` +
            `score and the single most important next action. No JSON, no headers, ` +
            `no em-dashes.`,
        },
      ],
      temperature: 0.5,
      max_tokens: 400,
      timeoutMs: 12000,
    });
    return { summary: text.trim(), actions: [] };
  } catch {
    return {
      summary:
        "I could not reach the coach right now. Your score and pillar breakdown are above, try again in a moment.",
      actions: [],
    };
  }
}
