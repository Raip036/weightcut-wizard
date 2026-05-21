/**
 * Stage 5 of the planner: detect plateaus and synthesize a single remedial
 * step that addresses the most likely root cause.
 *
 * Two signal sources feed this stage:
 *  - High-signal: 2 consecutive "off" feedbacks on the same path
 *  - Low-signal: stall-language regex hits in recent notes
 *
 * `detectStallInNotes` is the cheap pre-filter for the low-signal path;
 * the LLM confirms by writing the actual remedial step.
 */
import { callGroqText } from "../../_shared/groq";
import { parseJSON } from "../../_shared/parseResponse";
import { EVALUATE_PLATEAU_PROMPT_TEMPLATE } from "./prompts";

const STALL_PATTERNS: RegExp[] = [
  /couldn'?t\s+(?:finish|get|land|hit)/i,
  /got\s+countered/i,
  /kept\s+(?:sweeping|losing|getting)/i,
  /still\s+struggling/i,
  /can'?t\s+seem\s+to/i,
  /failed\s+to/i,
  /\bnot\s+landing\b/i,
];

export function detectStallInNotes(notes: string, technique: string): boolean {
  const lower = notes.toLowerCase();
  if (!lower.includes(technique.toLowerCase())) return false;
  return STALL_PATTERNS.some((re) => re.test(notes));
}

export type RemedialStep = {
  prescription: string;
  wizardLine: string;
  details: { why: string; how: string[]; pitfalls: string[] };
};

export type EvaluatePlateauResult =
  | { kind: "remedial"; step: RemedialStep; stallReason: string }
  | { kind: "error"; message: string };

export async function evaluatePlateau(args: {
  technique: string;
  stallSignal: string;
}): Promise<EvaluatePlateauResult> {
  const prompt = EVALUATE_PLATEAU_PROMPT_TEMPLATE.replace(
    "${stallSignal}",
    args.stallSignal,
  );
  let raw: string;
  try {
    raw = await callGroqText({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `Technique: ${args.technique}` },
      ],
      temperature: 0.3,
      max_tokens: 700,
      response_format: { type: "json_object" },
    });
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : "groq failed" };
  }
  let parsed: { remedialStep?: RemedialStep; stallReason?: string };
  try {
    parsed = parseJSON(raw);
  } catch {
    return { kind: "error", message: "unparseable" };
  }
  const step = parsed?.remedialStep;
  if (
    !step ||
    !step.prescription ||
    !step.wizardLine ||
    !step.details ||
    !step.details.why ||
    !Array.isArray(step.details.how) ||
    step.details.how.length === 0
  ) {
    return { kind: "error", message: "invalid remedial step shape" };
  }
  return {
    kind: "remedial",
    step,
    stallReason: parsed?.stallReason ?? "stalled progress",
  };
}
