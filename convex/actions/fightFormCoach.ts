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

/** Structured return shape. `summary` is prose; `actions` tie to pillars. */
const FightFormCoachSchema = z.object({
  summary: z.string().min(1).max(400),
  actions: z
    .array(
      z.object({
        pillar: z.string().min(1).max(60),
        action: z.string().min(1).max(200),
      }),
    )
    .min(0)
    .max(4),
});

type FightFormCoaching = z.infer<typeof FightFormCoachSchema>;

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
    const systemPrompt = buildSystemPrompt(facts);

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

  lines.push("");
  lines.push("PILLARS (value, weight, points contributed):");
  for (const p of args.pillars) {
    lines.push(
      `- ${p.label}: value ${p.value}, weight ${p.weightPct}%, contributes ${p.contributionPts} pts. ${p.reason}`,
    );
  }

  if (args.ceilings && args.ceilings.length > 0) {
    lines.push("");
    lines.push("ACTIVE CEILINGS (a rule is capping the score):");
    for (const c of args.ceilings) {
      lines.push(`- ${c.ruleId}: caps score at ${c.cap}`);
    }
  }

  return lines.join("\n");
}

// ── Prompt builder ──────────────────────────────────────────────────────────

function buildSystemPrompt(facts: string): string {
  return `You are the "Fight Form Coach" - a concise fight-camp readiness coach reading an athlete's FightForm readiness score.

${SECOND_PERSON_DIRECTIVE}

${PROMPT_INJECTION_GUARD_INSTRUCTION}

Output ONLY valid JSON matching this shape:
{ "summary": string, "actions": [{ "pillar": string, "action": string }] }

RULES (non-negotiable):
- Use ONLY the numbers in DETERMINISTIC FACTS below. NEVER invent, estimate, or recompute any figure. Quote the real values ("recovery is contributing only 6 of 30 points").
- "summary": 1-2 sentences on what is DRIVING and LIMITING the score this phase. Reference the TOP DRIVER and TOP LIMITER and the phase / days to fight when present. Never more than 2 sentences.
- "actions": 2-4 specific, concrete next-actions tied to the WEAKEST pillars (the TOP LIMITER and the lowest-contribution pillars). Each has a "pillar" (the pillar label it targets) and a one-sentence "action" the athlete can do next. Make them concrete, not generic.
- If an ACTIVE CEILING is present, call it out in the summary as the thing holding the score down and make an action address it directly.
- BANNED: paragraphs, motivational fluff, repeating raw figures inside every action, em-dashes (—) or en-dashes (–) anywhere. Use commas or periods.

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
