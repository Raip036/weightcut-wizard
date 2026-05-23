"use node";

/**
 * Stage 1 of the Training Coach Paths planner: read raw session notes,
 * extract candidate techniques the user mentioned learning/practicing.
 *
 * Uses the cheap llama-3.1-8b-instant model because the task is structured
 * extraction, not reasoning.
 */
import { callGroqText } from "../../_shared/groq";
import { parseJSON } from "../../_shared/parseResponse";
import { sanitizeUserText } from "../../_shared/sanitizeUserText";
import { EXTRACT_CANDIDATES_PROMPT } from "./prompts";

export type Candidate = {
  technique: string;
  sport: string;
  confidence: number;
};

export async function extractCandidates(args: {
  notes: string;
}): Promise<Candidate[]> {
  const cleanNotes = sanitizeUserText(args.notes, { maxLength: 1500, raw: true });
  let raw: string;
  try {
    raw = await callGroqText({
      // Heavy-tier model — candidate extraction quality directly drives
      // downstream training-coach pipeline quality. On OpenRouter this
      // resolves to qwen3-235b via OPENROUTER_MODEL_MAP; on Groq direct
      // it stays as gpt-oss-120b.
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: EXTRACT_CANDIDATES_PROMPT },
        { role: "user", content: `<user_input>${cleanNotes}</user_input>` },
      ],
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: "json_object" },
    });
  } catch {
    return [];
  }
  let parsed: { candidates?: Candidate[] };
  try {
    parsed = parseJSON<{ candidates?: Candidate[] }>(raw);
  } catch {
    return [];
  }
  if (!parsed?.candidates || !Array.isArray(parsed.candidates)) return [];
  return parsed.candidates
    .filter((c) => c && typeof c.technique === "string" && typeof c.sport === "string")
    .map((c) => ({
      technique: c.technique.trim(),
      sport: c.sport.trim(),
      confidence: typeof c.confidence === "number" ? c.confidence : 0.5,
    }));
}

export function normalizeTechnique(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}