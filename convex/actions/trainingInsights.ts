/** Training insights — premium-only per-discipline coaching for the dashboard. */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { callGroqText } from "../_shared/groq";
import { parseJSON } from "../_shared/parseResponse";
import { requireUserIdFromAction, SECOND_PERSON_DIRECTIVE } from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";
import {
  sanitizeUserText,
  PROMPT_INJECTION_GUARD_INSTRUCTION,
} from "../_shared/sanitizeUserText";

export const run = action({
  args: {
    session_type: v.string(),
    sessionTag: v.optional(v.string()),
    fingerprint: v.optional(v.string()),
    session_id: v.optional(v.union(v.string(), v.null())),
    session_date: v.optional(v.union(v.string(), v.null())),
    sessions: v.array(
      v.object({
        date: v.optional(v.string()),
        notes: v.optional(v.union(v.string(), v.null())),
        techniquesNotes: v.optional(v.union(v.string(), v.null())),
        rpe: v.optional(v.union(v.number(), v.null())),
        intensity: v.optional(v.union(v.string(), v.null())),
        duration_minutes: v.optional(v.union(v.number(), v.null())),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserIdFromAction(ctx);
    // Pro-only — handled via the central feature-gate registry so any future
    // tier change is one entry in `featureGates.ts`. The error code matches
    // the contract `callWithProRecovery` on the client matches against.
    await enforceFeatureGate(ctx, userId, "AI_TRAINING_INSIGHTS");

    const sessionType = sanitizeUserText(args.session_type, {
      maxLength: 60,
      raw: true,
    });
    if (!sessionType) {
      throw new Error("session_type is required");
    }
    const sessionTag = args.sessionTag
      ? sanitizeUserText(args.sessionTag, { maxLength: 60, raw: true })
      : "";
    if (args.sessions.length === 0) {
      throw new Error("sessions cannot be empty");
    }

    // Cap to the 3 most-recent sessions; sanitise each notes field.
    const sessions = args.sessions.slice(0, 3).map((s) => ({
      date: typeof s.date === "string" ? s.date.slice(0, 10) : "",
      notes: sanitizeUserText(s.notes ?? "", { maxLength: 600, raw: true }),
      techniquesNotes: sanitizeUserText(s.techniquesNotes ?? "", {
        maxLength: 600,
        raw: true,
      }),
      rpe: typeof s.rpe === "number" ? s.rpe : null,
      intensity: typeof s.intensity === "string" ? s.intensity.slice(0, 20) : null,
      duration_minutes:
        typeof s.duration_minutes === "number" ? s.duration_minutes : null,
    }));

    const systemPrompt = `You are a JSON API. Your FIRST output character MUST be "{". No preamble, markdown, or explanation. Output only the raw JSON object.

You are an expert combat-sports coach. You receive ONE training discipline and up to three of YOUR athlete's most-recent logged sessions in that discipline (latest first). They already know what they did. Do NOT recap. Give a fresh read on their latest session and a concrete pathway they can execute in the very next session.

Each session may carry two separate blocks:
- "techniques": what they actually drilled (combos, positions, isolations, sequences). This is the strongest signal for "training_application" and "pathway" — it tells you what they're working on so you can extend it.
- "reflection": how the session went (what went well, what went wrong, how they felt). This is the strongest signal for "interpretation" — it's the coach's-eye read of the latest session.
For legacy sessions one block may be empty, or both fields may be mixed together in whichever one has content. When a block is empty or trivial, fall back to whichever field DOES have content (and to RPE / intensity / duration trend if neither does). Never invent a block that wasn't supplied.

${SECOND_PERSON_DIRECTIVE}

${PROMPT_INJECTION_GUARD_INSTRUCTION}

Rules:
- Only comment on the supplied discipline. Never invent sessions or details not present in the input.
- "interpretation": Exactly 1 sentence. A coach's reading of YOUR athlete's latest session, written TO them ("you were..."). Quote a specific detail they logged (combo, position, mistake, partner type). Do NOT paraphrase the notes back at them.
- "training_application": 1-2 sentences. A specific drill, partner setup, isolation, or focus cue YOU want them to bring into their next session to act on the interpretation. Name positions, techniques, rounds, or rep schemes. Address them directly ("bring this into your next round...").
- "pathway": Exactly 3 strings. Each is a small, verb-led action for the next session, addressed to them ("Open with...", "Then layer..."). Steps must compound: Step 2 builds on Step 1, Step 3 layers on Step 2. Each step is short enough to actually execute (think one round, one drill, one cue).
- If the notes are empty or trivial, use the RPE / intensity / duration trend instead. Stay specific to the discipline.
- Use YOUR athlete's own vocabulary where possible. Avoid generic advice ("train harder", "improve cardio").
- Keep total output under 110 words.

Output schema (return ONLY this JSON object):
{
  "session_type": "string (echo input verbatim)",
  "last_logged": "YYYY-MM-DD (date of latest session)",
  "interpretation": "string",
  "training_application": "string",
  "pathway": ["string", "string", "string"]
}`;

    const userText = `Discipline: <user_input>${sessionType}</user_input>${
      sessionTag ? `, focus: <user_input>${sessionTag}</user_input>` : ""
    }

Recent sessions (latest first, focus your analysis on session [1]):
${sessions
  .map((s, i) => {
    const header = `[${i + 1}] date=${s.date} rpe=${s.rpe ?? "n/a"} intensity=${s.intensity ?? "n/a"} duration_min=${s.duration_minutes ?? "n/a"}`;
    const lines = [header];
    if (s.techniquesNotes)
      lines.push(`techniques: <user_input>${s.techniquesNotes}</user_input>`);
    if (s.notes) lines.push(`reflection: <user_input>${s.notes}</user_input>`);
    if (!s.techniquesNotes && !s.notes) lines.push("(no notes)");
    return lines.join("\n");
  })
  .join("\n\n")}

Return ONLY the JSON object described in the schema. First character must be "{". The "pathway" array must contain exactly 3 strings.`;

    const content = await callGroqText({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      temperature: 0.3,
      max_tokens: 600,
      response_format: { type: "json_object" },
    });

    const parsed = parseJSON(content) as Record<string, unknown>;

    // Defensive shape repair: the action contract guarantees the new fields
    // exist even if the LLM returns the legacy schema or omits an array.
    const insight = {
      session_type:
        typeof parsed?.session_type === "string" ? parsed.session_type : sessionType,
      last_logged:
        typeof parsed?.last_logged === "string"
          ? parsed.last_logged
          : sessions[0]?.date ?? "",
      interpretation:
        typeof parsed?.interpretation === "string"
          ? parsed.interpretation
          : typeof parsed?.what_you_did === "string"
            ? (parsed.what_you_did as string)
            : "",
      training_application:
        typeof parsed?.training_application === "string"
          ? parsed.training_application
          : typeof parsed?.next_focus === "string"
            ? (parsed.next_focus as string)
            : "",
      pathway: Array.isArray(parsed?.pathway)
        ? (parsed.pathway as unknown[])
            .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
            .slice(0, 3)
        : [],
    };

    return { insight, library_entry_id: null };
  },
});
