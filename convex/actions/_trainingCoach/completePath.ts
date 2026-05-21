/**
 * Stage 6 of the planner: when a path finishes, propose TWO follow-up
 * paths — a related offensive next step and an inverse defense path.
 * The orchestrator surfaces both as PathProposalBanners (user opts in).
 */
import { callGroqText } from "../../_shared/groq";
import { parseJSON } from "../../_shared/parseResponse";
import { COMPLETE_PATH_PROMPT_TEMPLATE } from "./prompts";

export type ProposalSeed = {
  technique: string;
  sport: string;
  goal: string;
};

export type ProposeFollowUpsResult =
  | { kind: "ok"; relatedPath: ProposalSeed; defensePath: ProposalSeed }
  | { kind: "error"; message: string };

function validSeed(s: unknown): s is ProposalSeed {
  if (typeof s !== "object" || s === null) return false;
  const r = s as Record<string, unknown>;
  return (
    typeof r.technique === "string" &&
    r.technique.length > 0 &&
    typeof r.sport === "string" &&
    typeof r.goal === "string" &&
    r.goal.length > 0
  );
}

export async function proposeFollowUps(args: {
  technique: string;
  sport: string;
}): Promise<ProposeFollowUpsResult> {
  const prompt = COMPLETE_PATH_PROMPT_TEMPLATE.replace("${technique}", args.technique);
  let raw: string;
  try {
    raw = await callGroqText({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: `Sport: ${args.sport}\nTechnique: ${args.technique}`,
        },
      ],
      temperature: 0.4,
      max_tokens: 600,
      response_format: { type: "json_object" },
    });
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : "groq failed" };
  }
  let parsed: { relatedPath?: unknown; defensePath?: unknown };
  try {
    parsed = parseJSON(raw);
  } catch {
    return { kind: "error", message: "unparseable" };
  }
  if (!validSeed(parsed?.relatedPath) || !validSeed(parsed?.defensePath)) {
    return { kind: "error", message: "missing or invalid path proposals" };
  }
  return {
    kind: "ok",
    relatedPath: parsed.relatedPath,
    defensePath: parsed.defensePath,
  };
}
