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
 *   9. callGroqWithRetry(...) -> Zod-validated JSON.
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
import { enforceFeatureGate } from "../../_shared/featureGates";
import { logDecision } from "../_helpers";
import { GENERATE_MISSION_PROMPT } from "./prompts";

// ───────────────────────────────────────────────────────────────────────
// Zod schema — mirrors the spec's exact constraints (items length 3..8,
// per-item text 5..140 chars, etc). callGroqWithRetry will retry once
// with validation feedback before bubbling up.
// ───────────────────────────────────────────────────────────────────────

const MissionSchema = z.object({
  title: z.string().min(3).max(60),
  rationale: z.string().min(10).max(400),
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
    .max(8),
});

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

    // 9: Groq call with Zod validation. callGroqWithRetry handles the
    //    one-shot feedback injection retry on schema fail.
    let parsed: z.infer<typeof MissionSchema>;
    try {
      parsed = await callGroqWithRetry({
        model: "openai/gpt-oss-120b",
        messages: [
          {
            role: "system",
            content: GENERATE_MISSION_PROMPT.replace("{sport}", sport),
          },
          { role: "user", content: userMsg },
        ],
        temperature: 0.4,
        max_tokens: 1500,
        response_format: { type: "json_object" },
        timeoutMs: 15000,
        schema: MissionSchema,
      });
    } catch (err) {
      // Don't insert anything on failure — the user sees no change and
      // can hit "Refresh mission" to retry. We still record the failure
      // in the action log via logDecision below would be misleading
      // (no output to log), so just return.
      const message =
        err instanceof GroqError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      return { error: message };
    }

    // 10: Persist. The mutation handles:
    //       - marking any prior active mission completed (status flip
    //         + completedAt) when its items are all done,
    //       - inserting the new mission row with notesWindowStart=now,
    //       - inserting each item with strict position 0..N.
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
      },
    );

    // 11: Audit log (fire-and-forget).
    logDecision(ctx, {
      userId,
      feature: "AI_TRAINING_COACH_PATHS",
      inputSnapshot: {
        sport,
        noteCount: noteRows.length,
        cursor,
      },
      outputJson: {
        missionId,
        title: parsed.title,
        itemCount: parsed.items.length,
      },
      model: "openai/gpt-oss-120b",
    });

    // 12.
    return { created: missionId };
  },
});
