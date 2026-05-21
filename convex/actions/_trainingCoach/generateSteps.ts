"use node";

/**
 * Stage 3 of the planner: generate the full 5-8 step curriculum for a
 * given technique/goal. Uses the heavy `gpt-oss-120b` model and validates
 * the LLM's JSON against a strict shape — incomplete outputs are rejected
 * (the implementer-level Convex caller then patches the path to archived).
 */
import { callGroqText } from "../../_shared/groq";
import { parseJSON } from "../../_shared/parseResponse";
import { sanitizeUserText } from "../../_shared/sanitizeUserText";
import { GENERATE_STEPS_PROMPT } from "./prompts";

export type GeneratedStep = {
  position: number;
  prescription: string;
  wizardLine: string;
  details: { why: string; how: string[]; pitfalls: string[] };
  targetSport: string;
  expectedSessions: 1;
};

export type GenerateStepsResult =
  | { kind: "steps"; steps: GeneratedStep[] }
  | { kind: "refused"; reason: string }
  | { kind: "error"; message: string };

function validateStep(s: unknown): s is GeneratedStep {
  if (typeof s !== "object" || s === null) return false;
  const r = s as Record<string, unknown>;
  if (typeof r.position !== "number") return false;
  if (typeof r.prescription !== "string" || r.prescription.length === 0) return false;
  if (typeof r.wizardLine !== "string" || r.wizardLine.length === 0) return false;
  if (typeof r.details !== "object" || r.details === null) return false;
  const d = r.details as Record<string, unknown>;
  if (typeof d.why !== "string") return false;
  if (!Array.isArray(d.how) || d.how.length === 0) return false;
  if (!Array.isArray(d.pitfalls)) return false;
  if (typeof r.targetSport !== "string") return false;
  return true;
}

export async function generateSteps(args: {
  sport: string;
  goal: string;
  notes: string;
  daysToFight: number | null;
  firstName: string;
}): Promise<GenerateStepsResult> {
  const cleanNotes = sanitizeUserText(args.notes, { maxLength: 1500, raw: true });
  const userMsg = [
    `Sport: ${args.sport}`,
    `Goal: ${args.goal}`,
    `User first name: ${args.firstName}`,
    args.daysToFight != null ? `daysToFight: ${args.daysToFight}` : "",
    `Recent notes: <user_input>${cleanNotes}</user_input>`,
  ]
    .filter(Boolean)
    .join("\n");

  let raw: string;
  try {
    raw = await callGroqText({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: GENERATE_STEPS_PROMPT },
        { role: "user", content: userMsg },
      ],
      temperature: 0.4,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    });
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : "groq failed" };
  }
  let parsed: { steps?: unknown; refusedReason?: string };
  try {
    parsed = parseJSON(raw);
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : "unparseable" };
  }
  if (parsed?.refusedReason) {
    return { kind: "refused", reason: parsed.refusedReason };
  }
  const steps = parsed?.steps;
  if (!Array.isArray(steps) || steps.length < 5 || steps.length > 8) {
    return {
      kind: "error",
      message: `expected 5-8 steps, got ${Array.isArray(steps) ? steps.length : "non-array"}`,
    };
  }
  for (const s of steps) {
    if (!validateStep(s)) {
      const pos = (s as { position?: number })?.position;
      return { kind: "error", message: `invalid step shape at position ${pos}` };
    }
  }
  return { kind: "steps", steps: steps as GeneratedStep[] };
}