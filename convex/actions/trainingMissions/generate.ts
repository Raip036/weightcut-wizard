"use node";

/**
 * Training Missions generator action.
 *
 * Idempotent entry point: `generateMissionIfReady({ sport })`. Called from
 *   (a) `markItemCompleted` after the last item flips to completed,
 *   (b) `refreshMission` (manual refresh button),
 *   (c) session-save trigger in `fight_camp.ts` (added by a sibling
 *       agent — not by this file).
 *
 * The flow follows the spec at
 * `docs/superpowers/specs/2026-05-21-training-missions-design.md`
 * §"Generation flow", steps 1-12.
 *
 *   1. Resolve userId from auth.
 *   2. Find latest (userId, sport) mission of any status.
 *   3. If it exists, status=active, any item incomplete  -> skip.
 *   4. If it exists, status=active, all items complete   -> mark
 *      completed (via the insertMissionInternal mutation flow), continue.
 *   5. cursor = max(latest.notesWindowStart ?? 0, latest.createdAt ?? 0)
 *   6. Collect new notes since cursor; if 0 rows -> skip.
 *   7. Pro gate (throws PRO_FEATURE_REQUIRED:AI_TRAINING_COACH_PATHS).
 *   8. Sanitize and join notes (one block per session, '---' separator).
 *      Also gather prior-mission history (#2) and the curated technique
 *      reference for the discipline (#6).
 *   9. Three-stage LLM pipeline, each Zod-validated:
 *        a. DIAGNOSE (cheap model) — pinpoint the core problem (#5).
 *        b. GENERATE (strong model) — author exactly 3 drills from the
 *           diagnosis + technique reference + history.
 *        c. VERIFY (cheap model) — critique the drills; one regeneration
 *           pass if it flags problems (#7).
 *      Stages (a) and (c) are best-effort; generation falls back to its
 *      own self-diagnosis so the flow never regresses to "no mission".
 *  10. insertMissionInternal mutation persists the mission + items and
 *      patches any predecessor active mission to "completed". Returns
 *      the new mission's id.
 *  11. logDecision audit row.
 *  12. Return { created: missionId }.
 */

import { v } from "convex/values";
import { z } from "zod";
import type { Id } from "../../_generated/dataModel";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { callGroqWithRetry, GroqError } from "../../_shared/groq";
import {
  sanitizeUserText,
} from "../../_shared/sanitizeUserText";
import { stripEmDashes } from "../../_shared/parseResponse";
import { normalizeTechniqueKey } from "../../training_techniques";
import { enforceFeatureGate } from "../../_shared/featureGates";
import { logDecision } from "../_helpers";
import {
  GENERATE_MISSION_PROMPT,
  DIAGNOSE_MISSION_PROMPT,
  VERIFY_MISSION_PROMPT,
} from "./prompts";
import { buildGroundingBlock } from "./groundingReference";

// ───────────────────────────────────────────────────────────────────────
// Zod schema — mirrors the spec's exact constraints (items length
// exactly 3, per-item text 5..140 chars, etc). callGroqWithRetry will
// retry once with validation feedback before bubbling up.
// ───────────────────────────────────────────────────────────────────────

const MissionSchema = z.object({
  title: z.string().min(3).max(60),
  rationale: z.string().min(10).max(400),
  focusTechnique: z.string().min(2).max(60),
  items: z
    .array(
      z.object({
        text: z.string().min(5).max(140),
        technique: z.string().max(60).optional(),
        drillType: z
          .enum(["solo", "partner", "live", "shadow"])
          .optional(),
        durationMin: z.number().int().min(1).max(60).optional(),
      }),
    )
    .min(3)
    .max(3),
});

// Stage A (diagnose) output. Cheap model classifies the core problem so
// Stage B can build drills around a fixed, loggable diagnosis.
const DiagnosisSchema = z.object({
  category: z.enum([
    "technical",
    "conceptual",
    "conditioning",
    "mental",
    "tactical",
  ]),
  problem: z.string().min(3).max(220),
  failingComponent: z.string().min(3).max(180),
  targetTechnique: z.string().min(2).max(90),
  notesEvidence: z.string().min(2).max(220),
  confidence: z.enum(["low", "medium", "high"]),
});
type Diagnosis = z.infer<typeof DiagnosisSchema>;

// Stage C (verify) output. Cheap model critiques the 3 drills; a "revise"
// verdict triggers one regeneration pass with the issues fed back in.
const VerifySchema = z.object({
  verdict: z.enum(["pass", "revise"]),
  issues: z
    .array(
      z.object({
        index: z.number().int().min(0).max(2),
        problem: z.string().max(220),
      }),
    )
    .max(6)
    .default([]),
});
type MissionPayload = z.infer<typeof MissionSchema>;

/** Render the diagnosis as a prompt block for the generation stage. */
function formatDiagnosisBlock(d: Diagnosis): string {
  return [
    "=== DIAGNOSIS (treat as the finished result of STEP 1-2) ===",
    `Category: ${d.category}`,
    `Problem: ${d.problem}`,
    `Failing component: ${d.failingComponent}`,
    `Target technique / situation: ${d.targetTechnique}`,
    `From the notes: ${d.notesEvidence}`,
    `Confidence: ${d.confidence}`,
  ].join("\n");
}

/** Render recent missions (newest first) as a prompt block so the new
 *  mission progresses the work instead of repeating it. */
function formatHistoryBlock(
  history: Array<{
    title: string;
    rationale: string;
    items: Array<{ text: string; completed: boolean }>;
  }>,
): string {
  if (history.length === 0) return "";
  const lines: string[] = [
    "=== PRIOR MISSIONS (most recent first — progress these, never repeat a completed drill) ===",
  ];
  history.forEach((m, idx) => {
    lines.push(`${idx + 1}. "${m.title}"`);
    m.items.forEach((it) => {
      lines.push(`   [${it.completed ? "done" : "skipped"}] ${it.text}`);
    });
  });
  return lines.join("\n");
}

/** Render verifier issues as feedback for the one regeneration pass. */
function formatVerifierFeedback(
  issues: Array<{ index: number; problem: string }>,
): string {
  return [
    "=== REVISION REQUIRED — your previous drills had these problems; fix ALL of them while keeping EXACTLY 3 drills ===",
    ...issues.map((i) => `  - Drill ${i.index + 1}: ${i.problem}`),
  ].join("\n");
}

export const generateMissionIfReady = internalAction({
  args: { userId: v.id("users"), sport: v.string() },
  // Returns a discriminated outcome so the caller (a mutation that just
  // scheduled this) can log behaviour without re-querying. The action is
  // designed to be safe to re-invoke at any time — every short-circuit is
  // explicit.
  handler: async (
    ctx,
    { userId, sport },
  ): Promise<
    | { skipped: "prior_incomplete" }
    | { skipped: "no_new_notes" }
    | { created: Id<"training_missions"> }
    | { error: string }
  > => {

    // 1-3: Look up the latest mission for this (user, sport). Decide
    //      whether to short-circuit or continue based on its state.
    const latest = await ctx.runQuery(
      internal.training_missions.getLatestForSport,
      { userId, sport },
    );
    if (latest && latest.status === "active") {
      const anyIncomplete = latest.items.some((it) => !it.completed);
      if (anyIncomplete) {
        return { skipped: "prior_incomplete" };
      }
      // All items done — the mutation will mark the prior mission
      // completed when we persist the new one. Fall through.
    }

    // 4-5: Window cursor — never look at notes older than the prior
    //      mission's window start (or createdAt, whichever is later).
    const cursor = Math.max(
      latest?.notesWindowStart ?? 0,
      latest?.createdAt ?? 0,
    );

    // 6: Collect new notes for this sport since the cursor.
    const noteRows = await ctx.runQuery(
      internal.fight_camp.listNotesSince,
      { userId, sport, since: cursor },
    );
    if (noteRows.length === 0) {
      return { skipped: "no_new_notes" };
    }

    // 7: Pro gate. Throws PRO_FEATURE_REQUIRED:AI_TRAINING_COACH_PATHS
    //    which the client recovers via callWithProRecovery (paywall).
    //    Run AFTER the no-new-notes short-circuit so we don't pop the
    //    paywall on a no-op refresh.
    await enforceFeatureGate(ctx, userId, "AI_TRAINING_COACH_PATHS");

    // 8: Sanitize + join. `raw: true` so the per-note text doesn't get
    //    its own <user_input> wrapper — we wrap the whole concatenated
    //    block once below so the prompt-injection guard works against
    //    one well-defined tag.
    const sanitizedNotes = noteRows
      .map((r: { notes?: string }) =>
        sanitizeUserText(r.notes ?? "", { maxLength: 1500, raw: true }),
      )
      .filter((s: string) => s.length > 0)
      .join("\n---\n");

    if (!sanitizedNotes) {
      // Safety net — if every note sanitized to empty (all injection
      // markers, no real content) skip without burning a Groq call.
      return { skipped: "no_new_notes" };
    }

    const userMsg = [
      `Sport: ${sport}`,
      `Recent session notes (chronological, separated by ---):`,
      `<user_input>${sanitizedNotes}</user_input>`,
    ].join("\n");

    const fillSport = (tpl: string) => tpl.replace(/\{sport\}/g, sport);

    // 8b: Prior-mission history (improvement #2). Best-effort — an empty
    //     block just means the generator has no progression context.
    const history = await ctx
      .runQuery(internal.training_missions.getRecentMissionHistory, {
        userId,
        sport,
        limit: 3,
      })
      .catch(() => [] as never[]);
    const historyBlock = formatHistoryBlock(history);

    // 8c: Curated technique/combo reference for this discipline
    //     (improvement #6, anti-hallucination grounding).
    const groundingBlock = buildGroundingBlock(sport);

    // 9a: Stage A — DIAGNOSE (improvement #5). Cheap/fast model pinpoints
    //     the core problem. Best-effort: if it fails, the generation prompt
    //     still does its own diagnosis (STEP 1-2), so we never regress.
    let diagnosis: Diagnosis | null = null;
    try {
      diagnosis = await callGroqWithRetry({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: fillSport(DIAGNOSE_MISSION_PROMPT) },
          { role: "user", content: userMsg },
        ],
        temperature: 0.3,
        max_tokens: 400,
        response_format: { type: "json_object" },
        timeoutMs: 12000,
        schema: DiagnosisSchema,
        maxRetries: 1,
      });
    } catch (err) {
      console.warn("trainingMissions.generate: diagnose stage failed", err);
    }

    // 9b: Stage B — GENERATE (improvement #5, strong model). Augment the
    //     notes with the diagnosis, technique reference, and history.
    const diagnosisBlock = diagnosis ? formatDiagnosisBlock(diagnosis) : "";
    const genUserMsg = [
      diagnosisBlock,
      groundingBlock,
      historyBlock,
      userMsg,
    ]
      .filter((b) => b.length > 0)
      .join("\n\n");

    const generate = (extraSystem?: string): Promise<MissionPayload> =>
      callGroqWithRetry({
        model: "openai/gpt-oss-120b",
        messages: [
          {
            role: "system",
            content: extraSystem
              ? `${fillSport(GENERATE_MISSION_PROMPT)}\n\n${extraSystem}`
              : fillSport(GENERATE_MISSION_PROMPT),
          },
          { role: "user", content: genUserMsg },
        ],
        temperature: 0.4,
        max_tokens: 1500,
        response_format: { type: "json_object" },
        timeoutMs: 15000,
        schema: MissionSchema,
      });

    let parsed: MissionPayload;
    try {
      parsed = await generate();
    } catch (err) {
      // Don't insert anything on failure — the user sees no change and can
      // hit "Refresh mission" to retry.
      const message =
        err instanceof GroqError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      return { error: message };
    }

    // 9c: Stage C — VERIFY (improvement #7). Cheap model critiques the
    //     drills against the diagnosis; one regeneration pass on "revise".
    //     Best-effort: any verifier failure keeps the original drills.
    let verifyVerdict: "pass" | "revise" | "skipped" = "skipped";
    try {
      const review = await callGroqWithRetry({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: fillSport(VERIFY_MISSION_PROMPT) },
          {
            role: "user",
            content: [
              diagnosisBlock || "(no separate diagnosis provided)",
              "=== DRILLS TO REVIEW ===",
              parsed.items
                .map(
                  (it, i) =>
                    `${i + 1}. ${it.text}${
                      it.drillType ? ` [${it.drillType}]` : ""
                    }`,
                )
                .join("\n"),
            ].join("\n\n"),
          },
        ],
        temperature: 0.2,
        max_tokens: 500,
        response_format: { type: "json_object" },
        timeoutMs: 12000,
        schema: VerifySchema,
        maxRetries: 1,
      });
      verifyVerdict = review.verdict;
      if (review.verdict === "revise" && review.issues.length > 0) {
        try {
          parsed = await generate(formatVerifierFeedback(review.issues));
        } catch (err) {
          // Revision failed — keep the original (already schema-valid) drills.
          console.warn(
            "trainingMissions.generate: revision pass failed",
            err,
          );
        }
      }
    } catch (err) {
      console.warn("trainingMissions.generate: verify stage failed", err);
    }

    // 10: Persist. The mutation handles:
    //       - marking any prior active mission completed (status flip
    //         + completedAt) when its items are all done,
    //       - inserting the new mission row with notesWindowStart=now,
    //       - inserting each item with strict position 0..N.
    const focusTechnique = stripEmDashes(parsed.focusTechnique).slice(0, 60);
    const focusTechniqueNormalized = normalizeTechniqueKey(sport, focusTechnique);
    // cycleId scoped per-mission for now; Task 2.2 will share one cycleId
    // across a batch of missions for the same issue.
    const cycleId = `${sport}:${Date.now()}`;
    const missionId: Id<"training_missions"> = await ctx.runMutation(
      internal.training_missions.insertMissionInternal,
      {
        userId,
        sport,
        title: parsed.title,
        rationale: parsed.rationale,
        sourceSessionIds: noteRows.map(
          (r: { _id: Id<"fight_camp_calendar"> }) => r._id,
        ),
        items: parsed.items,
        notesWindowStart: Date.now(),
        focusTechnique,
        focusTechniqueNormalized,
        cycleId,
      },
    );

    // 11: Audit log (fire-and-forget).
    await logDecision(ctx, {
      userId,
      feature: "AI_TRAINING_COACH_PATHS",
      inputSnapshot: {
        sport,
        noteCount: noteRows.length,
        cursor,
        priorMissionCount: history.length,
        diagnosis: diagnosis ?? null,
      },
      outputJson: {
        missionId,
        title: parsed.title,
        itemCount: parsed.items.length,
        verifyVerdict,
      },
      model: "diagnose:llama-3.1-8b-instant+generate:openai/gpt-oss-120b",
    });

    // 12.
    return { created: missionId };
  },
});
