"use node";

/**
 * `graduateCycleToSparring` — when a cycle's missions are all complete, author
 * a sparring assignment for each mission's focusTechnique.
 *
 * Called by Task 2.3 (`markItemCompleted`) once per cycle completion.
 *
 * Flow:
 *  1. Load completed, not-yet-graduated missions for (userId, cycleId).
 *     If none → { skipped: "already_graduated" }.
 *  2. For each mission, one gpt-oss-120b Groq call produces whenToUse /
 *     setups / counters / combinations for focusTechnique. Em dashes stripped.
 *  3. Read timesLogged from training_techniques (by_user_norm). Default 0.
 *  4. Upsert a sparring_assignments row with source:"graduated", combinations,
 *     timesLogged, sourceMissionId, landedCount:0.
 *  5. Patch the mission graduatedAt = Date.now() (idempotency guard).
 *  6. Return { graduated: <count> }.
 */

import { v } from "convex/values";
import { z } from "zod";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { callGroqWithRetry, GroqError } from "../../_shared/groq";
import { sanitizeUserText } from "../../_shared/sanitizeUserText";
import { buildGroundingBlock } from "./groundingReference";
import { SPARRING_PLAN_SYSTEM_PROMPT } from "../sparringPlan/prompts";

// ── Zod schema — ONE assignment per mission, extended with combinations ──────

const GraduationAssignmentSchema = z.object({
  technique: z.string().min(1).max(80),
  whenToUse: z.string().min(3).max(140),
  setups: z.array(z.string().max(160)).min(1).max(2),
  counters: z.array(z.string().max(160)).min(1).max(2),
  combinations: z.array(z.string().max(200)).min(1).max(4),
});

const GraduationResponseSchema = z.object({
  assignments: z.array(GraduationAssignmentSchema).min(1).max(8),
});

// ── Em-dash strip ─────────────────────────────────────────────────────────────

/** Strip em-dashes (U+2014) and en-dashes (U+2013) from a string. */
function stripEmDashes(s: string): string {
  return s.replace(/[–—]/g, "-");
}

function stripFromArray(arr: string[]): string[] {
  return arr.map(stripEmDashes);
}

// ── Prompt extension note ─────────────────────────────────────────────────────
//
// The base SPARRING_PLAN_SYSTEM_PROMPT instructs the model to emit
// { assignments: [ { technique, whenToUse, setups, counters } ] }.
// We extend it with a `COMBINATIONS_ADDON` that instructs the model to also
// emit `combinations` on every assignment.  The Zod schema enforces >=1.

const COMBINATIONS_ADDON = `
=== ADDITIONAL FIELD: combinations ===
For every assignment also return a "combinations" array (1–4 entries). Each entry is one short named combination sequence this technique slots into, written as a comma-separated or arrow-notation chain (e.g. "jab, cross, hook", "collar tie -> knee -> sweep"). Keep each entry <= 200 chars, second-person imperative, no em-dashes.

Updated JSON shape — note the extra "combinations" key alongside "counters":
{
  "assignments": [
    {
      "technique": "...",
      "whenToUse": "...",
      "setups": ["...", "..."],
      "counters": ["...", "..."],
      "combinations": ["...", "..."]
    }
  ]
}`;

// ── Main action ───────────────────────────────────────────────────────────────

export const graduateCycleToSparring = internalAction({
  args: {
    userId: v.id("users"),
    discipline: v.string(),
    cycleId: v.string(),
  },
  handler: async (
    ctx,
    { userId, discipline, cycleId },
  ): Promise<{ graduated: number } | { skipped: string }> => {
    // ── Generation-job marker (reactive "generating sparring" signal) ───────
    // Mark in-flight at the start; cleared in `finally` so a crash/throw still
    // removes the marker.
    await ctx.runMutation(internal.mastery_spine.startGenerationJob, {
      userId,
      discipline,
      kind: "sparring",
    });
    try {
    // ── Step 1: Load completed, not-yet-graduated missions ─────────────────
    const allCycleMissions = await ctx.runQuery(
      internal.training_missions.listCycleMissions,
      { userId, cycleId },
    );

    const eligible = allCycleMissions.filter(
      (m) =>
        m.status === "completed" &&
        m.graduatedAt == null &&
        m.focusTechnique != null &&
        m.focusTechniqueNormalized != null,
    );

    if (eligible.length === 0) {
      return { skipped: "already_graduated" };
    }

    let graduated = 0;

    // ── Path A: missions that already carry a sparring plan ────────────────
    // The plan was authored in the SAME pipeline as the drills, from the same
    // diagnosis + objective, so it can't invert the athlete's intent. Reveal
    // it deterministically — NO LLM call here.
    const withPlan = eligible.filter((m) => m.sparringPlan != null);
    for (const mission of withPlan) {
      const plan = mission.sparringPlan!;
      const focusTechnique = mission.focusTechnique!;
      const focusTechniqueNormalized = mission.focusTechniqueNormalized!;

      const timesLogged = await ctx.runQuery(
        internal.training_missions.readTimesLogged,
        { userId, techniqueNormalized: focusTechniqueNormalized },
      );

      await ctx.runMutation(internal.sparring_plan.upsertAssignments, {
        userId,
        discipline,
        assignments: [
          {
            technique: focusTechnique,
            techniqueNormalized: focusTechniqueNormalized,
            whenToUse: stripEmDashes(plan.whenToUse),
            setups: stripFromArray(plan.setups),
            counters: stripFromArray(plan.counters),
            sourceFingerprint: `graduated:${mission._id}`,
            source: "graduated" as const,
            sourceMissionId: mission._id,
            landedCount: 0,
            combinations: stripFromArray(plan.combinations),
            timesLogged,
            objective: plan.objective,
          },
        ],
      });

      await ctx.runMutation(
        internal.training_missions.patchMissionGraduatedAt,
        { missionId: mission._id, graduatedAt: Date.now() },
      );
      graduated += 1;
    }

    // ── Path B: legacy missions with NO stored plan ────────────────────────
    // Author the sparring plan now from the technique names (one batched LLM
    // call). Back-compat for cycles created before unified generation.
    const withoutPlan = eligible.filter((m) => m.sparringPlan == null);
    if (withoutPlan.length > 0) {
      const systemPrompt =
        `${SPARRING_PLAN_SYSTEM_PROMPT}${COMBINATIONS_ADDON}\n\n${buildGroundingBlock(discipline)}`;

      const techniqueLines = withoutPlan
        .map((m) => {
          const name = sanitizeUserText(m.focusTechnique!, { maxLength: 80, raw: true });
          return `- <user_input>${name}</user_input>`;
        })
        .join("\n");

      const userMsg = [
        `Discipline: ${discipline}`,
        `Build a live-sparring plan for EACH of these techniques the athlete has drilled to mission-completion:`,
        techniqueLines,
        "",
        "Return ONLY the JSON object described in your instructions — one assignment per technique above, names echoed verbatim.",
      ].join("\n");

      let parsed: z.infer<typeof GraduationResponseSchema>;
      try {
        parsed = await callGroqWithRetry({
          model: "openai/gpt-oss-120b",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMsg },
          ],
          temperature: 0.4,
          max_tokens: 2400,
          response_format: { type: "json_object" },
          timeoutMs: 20000,
          schema: GraduationResponseSchema,
        });
      } catch (err) {
        const msg =
          err instanceof GroqError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        console.error("graduateCycleToSparring: Groq call failed", msg);
        // Re-throw so the scheduler can retry; this is not a silent skip path.
        throw new Error(`Groq call failed: ${msg}`);
      }

      // Build lookup map: normalised technique name → parsed assignment.
      const parsedMap = new Map(
        parsed.assignments.map((a) => [a.technique.trim().toLowerCase(), a]),
      );

      for (const mission of withoutPlan) {
        const focusTechnique = mission.focusTechnique!;
        const focusTechniqueNormalized = mission.focusTechniqueNormalized!;

        const parsed_a =
          parsedMap.get(focusTechnique.trim().toLowerCase()) ??
          [...parsedMap.entries()].find(
            ([k]) =>
              k.split(/\s+/)[0] ===
              focusTechnique.trim().toLowerCase().split(/\s+/)[0],
          )?.[1];

        if (!parsed_a) {
          console.warn(
            `graduateCycleToSparring: no match for technique "${focusTechnique}" — skipping`,
          );
          continue;
        }

        const timesLogged = await ctx.runQuery(
          internal.training_missions.readTimesLogged,
          { userId, techniqueNormalized: focusTechniqueNormalized },
        );

        await ctx.runMutation(internal.sparring_plan.upsertAssignments, {
          userId,
          discipline,
          assignments: [
            {
              technique: focusTechnique,
              techniqueNormalized: focusTechniqueNormalized,
              whenToUse: stripEmDashes(parsed_a.whenToUse),
              setups: stripFromArray(parsed_a.setups),
              counters: stripFromArray(parsed_a.counters),
              sourceFingerprint: `graduated:${mission._id}`,
              source: "graduated" as const,
              sourceMissionId: mission._id,
              landedCount: 0,
              combinations: stripFromArray(parsed_a.combinations),
              timesLogged,
            },
          ],
        });

        await ctx.runMutation(
          internal.training_missions.patchMissionGraduatedAt,
          { missionId: mission._id, graduatedAt: Date.now() },
        );
        graduated += 1;
      }
    }

    return { graduated };
    } finally {
      // Always clear the in-flight marker, even when graduation threw.
      await ctx.runMutation(internal.mastery_spine.endGenerationJob, {
        userId,
        discipline,
        kind: "sparring",
      });
    }
  },
});
