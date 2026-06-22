"use node";

/**
 * extractIssues — Model B issue extractor (Task 2.2).
 *
 * One cheap `llama-3.1-8b-instant` call that reads the concatenated session
 * notes for a discipline window and returns ≤3 distinct coaching issues, each
 * paired with the focal technique. Called by `generateMissionIfReady` before
 * the per-issue GENERATE→VERIFY loop.
 *
 * Contract:
 *   - Always returns at least one entry (fallback = whole-window issue) so
 *     the caller never regresses to zero missions.
 *   - Em dashes stripped on every string field.
 *   - Cap enforced at 3 entries before returning.
 */

import { z } from "zod";
import { callGroqWithRetry } from "../../_shared/groq";
import { stripEmDashes } from "../../_shared/parseResponse";

// ── Zod schema ────────────────────────────────────────────────────────────────

const IssueArraySchema = z
  .array(
    z.object({
      /** One-sentence description of the coaching problem. */
      issue: z.string().min(3).max(220),
      /** The focal technique (move/position/concept) at the centre of the issue. */
      technique: z.string().min(2).max(80),
    }),
  )
  .min(1)
  .max(3);

type IssueArray = z.infer<typeof IssueArraySchema>;

// ── System prompt ─────────────────────────────────────────────────────────────

const EXTRACT_ISSUES_SYSTEM_PROMPT = `
You are a precision martial-arts coaching assistant.
Given one or more training session notes, identify UP TO THREE distinct,
actionable coaching problems the athlete is struggling with. Each problem
must be specific (cite concrete evidence from the notes) and different from
the others (no paraphrasing the same issue twice).

Respond with ONLY a JSON array. Each element:
  { "issue": "<one concise sentence describing the problem>",
    "technique": "<the focal technique, move, or position>" }

Rules:
- Maximum 3 elements. Fewer is better than duplicates.
- Order by severity / how clearly evidenced in the notes (most critical first).
- Do NOT use em dashes or en dashes anywhere.
- Do NOT include markdown, explanation, or any key other than "issue" and "technique".
`.trim();

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Extract ≤3 distinct coaching issues from a concatenated notes block.
 *
 * @param notes - Sanitized, joined session notes for the window (may contain
 *                multiple sessions separated by `---`).
 * @returns Array of 1-3 `{ issue, technique }` objects. On any failure, falls
 *          back to a single entry whose `issue` is the whole notes block
 *          (truncated) so the caller is never left with zero missions.
 */
export async function extractIssues({
  notes,
}: {
  notes: string;
}): Promise<IssueArray> {
  const fallback: IssueArray = [
    {
      issue: stripEmDashes(notes.slice(0, 200)).trim() || "Improve overall technique",
      technique: "general technique",
    },
  ];

  try {
    const raw = await callGroqWithRetry({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: EXTRACT_ISSUES_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Session notes:\n<user_input>${notes}</user_input>`,
        },
      ],
      temperature: 0.25,
      max_tokens: 600,
      response_format: { type: "json_object" },
      timeoutMs: 12000,
      // The model returns an array at the top level; callGroqWithRetry passes
      // the parsed JSON directly to safeParse, but the JSON object wrapper
      // means we need to unwrap it. Groq's json_object mode wraps arrays in
      // {"issues": [...]} so we accept both shapes via the transform below.
      schema: z
        .union([
          // Model returned {"issues": [...]} wrapper
          z.object({ issues: IssueArraySchema }).transform((v) => v.issues),
          // Model returned the array directly
          IssueArraySchema,
        ])
        .transform((v) => v),
      maxRetries: 1,
    });

    // Strip em dashes on every string field and cap at 3.
    const cleaned: IssueArray = (raw as IssueArray)
      .slice(0, 3)
      .map((entry) => ({
        issue: stripEmDashes(entry.issue).trim(),
        technique: stripEmDashes(entry.technique).trim(),
      }))
      .filter((e) => e.issue.length >= 3 && e.technique.length >= 2);

    return cleaned.length > 0 ? cleaned : fallback;
  } catch (err) {
    console.warn("trainingMissions.extractIssues: extraction failed, using fallback", err);
    return fallback;
  }
}
