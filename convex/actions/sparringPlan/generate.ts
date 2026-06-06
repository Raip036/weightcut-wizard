"use node";

/**
 * Sparring To-Do List generator action (Pro feature).
 *
 * Idempotent entry point: `generateSparringPlanIfReady({ userId, sport })`.
 * Called from the hourly backstop sweep (`sweep.ts`) and from the
 * session-save trigger built by a sibling agent.
 *
 * Where Training Missions builds a 3-drill checklist to FIX a problem, this
 * generator reads the athlete's logged techniques (plus recent note mentions)
 * and tells them how to LAND each one in LIVE sparring: when the opening
 * appears, how to manufacture it on a resisting partner, and the most likely
 * counter with the answer.
 *
 * Flow (steps mirror the design spec):
 *   1. Martial-art gate — skip conditioning / strength / run / rest sports.
 *   2. Pro gate (AI_SPARRING_PLAN) — swallowed so the scheduler never sees
 *      a rejection; non-pro just returns { skipped: "not_pro" }.
 *   3. Pull source data (logged techniques + recent notes + existing rows).
 *   4. Build a deduped technique POOL from logged techniques + note-mention
 *      candidates.
 *   5. Fingerprint each pool technique; diff against existing assignments to
 *      find what actually needs (re)generation. Cap at 8.
 *   6. ONE Groq call (strong model, Zod-validated) authors the assignments.
 *   7. Match each assignment back to its pool entry, upsert, log, return.
 *
 * The whole body is wrapped so any failure logs + returns { error } instead
 * of throwing into the scheduler.
 */

import { v } from "convex/values";
import { z } from "zod";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { callGroqWithRetry, GroqError } from "../../_shared/groq";
import {
  sanitizeUserText,
} from "../../_shared/sanitizeUserText";
import { enforceFeatureGate } from "../../_shared/featureGates";
import { logDecision } from "../_helpers";
import { normalizeTechniqueKey } from "../../training_techniques";
import { buildGroundingBlock } from "../trainingMissions/groundingReference";
import {
  extractCandidates,
  normalizeTechnique,
} from "../_trainingCoach/extractCandidates";
import { SPARRING_PLAN_SYSTEM_PROMPT } from "./prompts";

// ───────────────────────────────────────────────────────────────────────
// Zod schema — one assignment per technique. callGroqWithRetry retries once
// with validation feedback before bubbling up.
// ───────────────────────────────────────────────────────────────────────

const SparringPlanSchema = z.object({
  assignments: z
    .array(
      z.object({
        technique: z.string().min(1).max(80),
        whenToUse: z.string().min(3).max(140),
        setups: z.array(z.string().max(160)).min(1).max(2),
        counters: z.array(z.string().max(160)).min(1).max(2),
      }),
    )
    .min(1)
    .max(8),
});

// Sports that are NOT sparring disciplines — conditioning / strength /
// running / rest sessions have no live-round game plan to build.
const NON_MARTIAL_ART = /strength|s&c|conditioning|cardio|^run$|^rest$/i;

const MAX_TECHNIQUES = 8;

/** A single technique in the working pool, after merge + dedup. */
type PoolEntry = {
  technique: string;
  techniqueNormalized: string;
  cue?: string;
  detail: string;
  sourceFingerprint: string;
  /** How many signals point at this technique (used to rank when capping). */
  weight: number;
};

/**
 * Tiny deterministic djb2 hash → short hex. NEVER uses Math.random or Date so
 * the same source content always produces the same fingerprint; that is what
 * lets the diff below detect "nothing changed → skip".
 */
function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0; // h * 33 + c, keep uint32
  }
  return h.toString(16).padStart(8, "0");
}

export const generateSparringPlanIfReady = internalAction({
  args: {
    userId: v.id("users"),
    sport: v.string(),
    force: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { userId, sport, force },
  ): Promise<
    | { skipped: "not_martial_art" }
    | { skipped: "not_pro" }
    | { skipped: "no_new" }
    | { created: number }
    | { error: string }
  > => {
    try {
      // 1: Martial-art gate. Striking + grappling arts proceed; conditioning
      //    / strength / running / rest have no sparring plan to build.
      const normalizedSport = sport.trim().toLowerCase();
      if (NON_MARTIAL_ART.test(normalizedSport)) {
        return { skipped: "not_martial_art" };
      }

      // 2: Pro gate. enforceFeatureGate throws PRO_FEATURE_REQUIRED for
      //    non-pro users; this runs from a background scheduler so we MUST
      //    NOT let that reject — catch and short-circuit instead.
      try {
        await enforceFeatureGate(ctx, userId, "AI_SPARRING_PLAN");
      } catch {
        return { skipped: "not_pro" };
      }

      // 3: Source data — logged techniques, recent notes, existing rows.
      const src = await ctx.runQuery(
        internal.sparring_plan.getSparringSourceData,
        { userId, discipline: sport },
      );

      // 4: Build the technique POOL.
      //    Logged techniques first — they carry real cue/detail, so they win
      //    on any dedup collision.
      const pool = new Map<string, PoolEntry>();

      for (const t of src.loggedTechniques) {
        const fingerprint = shortHash(`${t.detail}|${t.cue ?? ""}`);
        pool.set(t.techniqueNormalized, {
          technique: t.technique,
          techniqueNormalized: t.techniqueNormalized,
          cue: t.cue,
          detail: t.detail,
          sourceFingerprint: fingerprint,
          weight: 2, // logged techniques outrank note-only mentions
        });
      }

      // Note-mention candidates. Guard the Groq extraction so a user with no
      // recent notes never burns a call. The query already filtered notes to
      // this discipline, so we keep the returned candidates (the extractor's
      // sport label is advisory, not a hard filter).
      if (src.recentNotes.length > 0) {
        let candidates: Array<{
          technique: string;
          sport: string;
          confidence: number;
        }> = [];
        try {
          candidates = await extractCandidates({
            notes: src.recentNotes.join("\n\n"),
          });
        } catch (err) {
          console.warn("sparringPlan.generate: extractCandidates failed", err);
        }

        for (const c of candidates) {
          const technique = c.technique.trim();
          if (!technique) continue;
          const key = normalizeTechniqueKey(sport, technique);
          const existing = pool.get(key);
          if (existing) {
            // Logged technique already covers this — just bump its rank so
            // re-mentioned techniques stay in the cap when we trim.
            existing.weight += 1;
            continue;
          }
          pool.set(key, {
            technique,
            techniqueNormalized: key,
            cue: undefined,
            detail: technique,
            sourceFingerprint: shortHash(`${technique}|`),
            weight: 1,
          });
        }
      }

      // 5: Diff against existing assignments. A technique needs generation if
      //    force is set, OR there's no existing row, OR its source content
      //    changed (fingerprint mismatch).
      const existingMap = new Map<string, string>();
      for (const e of src.existing) {
        existingMap.set(e.techniqueNormalized, e.sourceFingerprint);
      }

      const toGenerate = [...pool.values()].filter((entry) => {
        if (force === true) return true;
        const prev = existingMap.get(entry.techniqueNormalized);
        if (prev === undefined) return true; // never generated
        return prev !== entry.sourceFingerprint; // source changed
      });

      // 6: Nothing new → no-op (safe to re-run as often as the sweep likes).
      if (toGenerate.length === 0) {
        return { skipped: "no_new" };
      }

      // 7: Cap to MAX_TECHNIQUES, strongest signal first (logged + most
      //    re-mentioned win); stable for ties.
      const capped = [...toGenerate]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, MAX_TECHNIQUES);

      // 8: ONE Groq call. System prompt is the sparring coach + the
      //    per-discipline TECHNIQUE REFERENCE so every setup/counter stays
      //    art-specific and real.
      const systemPrompt = `${SPARRING_PLAN_SYSTEM_PROMPT}\n\n${buildGroundingBlock(sport)}`;

      const techniqueLines = capped
        .map((entry) => {
          const name = sanitizeUserText(entry.technique, {
            maxLength: 80,
            raw: true,
          });
          const ctxText =
            entry.detail && entry.detail !== entry.technique
              ? ` — context: <user_input>${sanitizeUserText(entry.detail, {
                  maxLength: 160,
                  raw: true,
                })}</user_input>`
              : "";
          return `- <user_input>${name}</user_input>${ctxText}`;
        })
        .join("\n");

      const userMsg = [
        `Discipline: ${sport}`,
        `Build a live-sparring plan for EACH of these techniques the athlete has already drilled:`,
        techniqueLines,
        "",
        "Return ONLY the JSON object described in your instructions — one assignment per technique above, names echoed verbatim.",
      ].join("\n");

      let parsed: z.infer<typeof SparringPlanSchema>;
      try {
        parsed = await callGroqWithRetry({
          model: "openai/gpt-oss-120b",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMsg },
          ],
          temperature: 0.4,
          max_tokens: 1800,
          response_format: { type: "json_object" },
          timeoutMs: 15000,
          schema: SparringPlanSchema,
        });
      } catch (err) {
        const message =
          err instanceof GroqError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        return { error: message };
      }

      // 9: Match each returned assignment back to its pool entry by the
      //    normalized technique name so we recover techniqueNormalized +
      //    sourceFingerprint. Drop anything we can't match (the model
      //    invented or renamed it).
      const byNormName = new Map<string, PoolEntry>();
      for (const entry of capped) {
        byNormName.set(normalizeTechnique(entry.technique), entry);
      }

      const assignments = parsed.assignments
        .map((a) => {
          const match = byNormName.get(normalizeTechnique(a.technique));
          if (!match) return null;
          return {
            technique: match.technique,
            techniqueNormalized: match.techniqueNormalized,
            whenToUse: a.whenToUse,
            setups: a.setups,
            counters: a.counters,
            sourceFingerprint: match.sourceFingerprint,
          };
        })
        .filter(
          (a): a is NonNullable<typeof a> => a !== null,
        );

      // If nothing matched, there's nothing safe to upsert — report it.
      if (assignments.length === 0) {
        return { error: "no_matched_assignments" };
      }

      // 10: Persist.
      await ctx.runMutation(internal.sparring_plan.upsertAssignments, {
        userId,
        discipline: sport,
        assignments,
      });

      // 11: Audit log (best-effort).
      try {
        await logDecision(ctx, {
          userId,
          feature: "sparring_plan",
          inputSnapshot: {
            sport,
            poolSize: pool.size,
            toGenerate: toGenerate.length,
            capped: capped.length,
            force: force === true,
          },
          outputJson: {
            created: assignments.length,
            techniques: assignments.map((a) => a.techniqueNormalized),
          },
          model: "openai/gpt-oss-120b",
        });
      } catch (err) {
        console.warn("sparringPlan.generate: logDecision failed", err);
      }

      // 12.
      return { created: assignments.length };
    } catch (err) {
      // Top-level guard: any unexpected failure logs + returns { error }
      // rather than throwing into the background scheduler.
      const message = err instanceof Error ? err.message : String(err);
      console.error("sparringPlan.generate: unexpected failure", err);
      return { error: message };
    }
  },
});
