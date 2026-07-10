"use node";

/**
 * Training Missions generator action — Model B (Task 2.2).
 *
 * Idempotent entry point: `generateMissionIfReady({ userId, sport })`. Called
 * from:
 *   (a) `markItemCompleted` after the last item flips to completed,
 *   (b) `refreshMission` (manual refresh button),
 *   (c) session-save trigger in `fight_camp.ts`.
 *
 * ### Model B flow (replaces prior single-mission generation)
 *
 *  1. **Frozen-cycle guard**: if ANY active mission exists for (userId, sport)
 *     via `by_user_sport_status` → `{ skipped: "cycle_in_progress" }`. Notes
 *     stay queued behind the existing cycle; the cursor is NOT advanced.
 *  2. Window cursor = max(latest.notesWindowStart, latest.createdAt). Collect
 *     new notes since cursor; 0 notes → `{ skipped: "no_new_notes" }`.
 *  3. Pro gate (throws `PRO_FEATURE_REQUIRED:AI_TRAINING_COACH_PATHS`).
 *  4. Sanitize + join notes.
 *  5. **Extract issues**: one cheap LLM call → ≤3 `{ issue, technique }` pairs.
 *     On extraction failure, falls back to a single whole-window issue so we
 *     never regress to zero missions.
 *  6. Shared `cycleId = "${sport}:${Date.now()}"` for the whole batch.
 *  7. **Per-issue dedupe + generate**: for each extracted issue, compute
 *     `focusTechniqueNormalized`. Skip the issue if:
 *       (a) an active mission with the same normalised key already exists, OR
 *       (b) a NON-mastered `sparring_assignments` row with the same
 *           `techniqueNormalized` exists (reinforce, don't duplicate).
 *     If a MASTERED assignment exists, allow a fresh journey.
 *     For surviving issues, run DIAGNOSE → GENERATE → VERIFY and persist via
 *     `insertMissionInternal` with the shared cycleId. The first insert uses
 *     `skipMarkPrior: false` (clears any residual stragglers); subsequent
 *     inserts use `skipMarkPrior: true` so sibling missions in this cycle are
 *     not inadvertently completed. DIAGNOSE is REQUIRED: an issue whose
 *     diagnosis fails is skipped rather than generated unanchored.
 *  8. Advance the notes cursor (notesWindowStart = now) on every insert so
 *     the window is not re-processed.
 *  9. Returns `{ created: firstMissionId }` if at least one mission was
 *     persisted. Returns `{ skipped: "no_new_notes" }` if all issues were
 *     deduped away (notes still advance via the first-insert path; if
 *     literally nothing survived dedupe we still advance to avoid a spin-loop
 *     on permanently-deduped notes). Returns `{ skipped: "diagnose_failed" }`
 *     when nothing was persisted and at least one issue lost its diagnosis;
 *     the cursor is left alone so the hourly sweep retries those notes.
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
  MISSION_SPARRING_PROMPT,
  MISSION_SPARRING_VERIFY_PROMPT,
} from "./prompts";
import { buildGroundingBlock } from "./groundingReference";
import { extractIssues } from "./extractIssues";
import { checkPerspective } from "./perspective";

// ───────────────────────────────────────────────────────────────────────
// Zod schemas
// ───────────────────────────────────────────────────────────────────────

const MissionSchema = z.object({
  title: z.string().min(3).max(60),
  rationale: z.string().min(10).max(400),
  focusTechnique: z.string().min(2).max(60),
  // Strategic objective the drills serve. Kept loose (string + normalised in
  // code) so an off-vocabulary value never fails the whole mission parse.
  objective: z.string().max(24).optional(),
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

// Allowed strategic objectives. Anything else normalises to "counter" (a safe
// defend-then-answer default that rarely inverts the athlete's intent).
const OBJECTIVES = [
  "offense",
  "defense",
  "counter",
  "pressure",
  "escape",
  "control",
] as const;
function normalizeObjective(raw: string | undefined): string {
  const v = (raw ?? "").trim().toLowerCase();
  return (OBJECTIVES as readonly string[]).includes(v) ? v : "counter";
}

// Sparring plan generated alongside the drills (one per mission technique).
const SparringPlanSchema = z.object({
  whenToUse: z.string().min(3).max(160),
  setups: z.array(z.string().max(160)).min(1).max(2),
  counters: z.array(z.string().max(160)).min(1).max(2),
  combinations: z.array(z.string().max(200)).min(1).max(4),
});
const SparringVerifySchema = z.object({
  verdict: z.enum(["pass", "revise"]),
  problem: z.string().max(240).default(""),
});
type StoredSparringPlan = {
  objective: string;
  whenToUse: string;
  setups: string[];
  counters: string[];
  combinations: string[];
};

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
  /** The athlete's role in the exchange the notes describe. */
  athleteRole: z.enum(["attacker", "defender", "counter_attacker"]),
  /** What the OPPONENT does. The stimulus. "" when the athlete initiates. */
  opponentAction: z.string().max(180),
  /** What the ATHLETE must do about it. Their half of the exchange. */
  athleteResponse: z.string().max(180),
  /** The athlete's own response, named as a technique. Never the opponent's action. */
  targetTechnique: z.string().min(2).max(90),
  notesEvidence: z.string().min(2).max(220),
  confidence: z.enum(["low", "medium", "high"]),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

/**
 * Thrown when the required DIAGNOSE stage fails. Callers skip that issue and
 * leave the notes watermark untouched so the hourly sweep retries it. Every
 * downstream stage is anchored to the diagnosis; generating without one is
 * what let the drills coach the opponent instead of the athlete.
 */
export class DiagnoseFailedError extends Error {
  /** The underlying failure. Held as a field rather than passed to `super`,
   *  because the app tsconfig targets a lib without the ES2022 `cause` option. */
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "DiagnoseFailedError";
    this.cause = options?.cause;
  }
}

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

// ───────────────────────────────────────────────────────────────────────
// Prompt formatters (unchanged from original)
// ───────────────────────────────────────────────────────────────────────

function formatDiagnosisBlock(d: Diagnosis): string {
  return [
    "=== DIAGNOSIS (treat as the finished result of STEP 1-2) ===",
    `Category: ${d.category}`,
    `Problem: ${d.problem}`,
    `Failing component: ${d.failingComponent}`,
    `THE ATHLETE'S ROLE in this exchange: ${d.athleteRole}`,
    `What the OPPONENT does (never drill this, it is not the athlete's job): ${
      d.opponentAction.trim() || "(nothing, the athlete initiates)"
    }`,
    `What the ATHLETE must do (drill THIS): ${d.athleteResponse}`,
    `Target technique / situation (the athlete's own response): ${d.targetTechnique}`,
    `From the notes: ${d.notesEvidence}`,
    `Confidence: ${d.confidence}`,
  ].join("\n");
}

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

function formatVerifierFeedback(
  issues: Array<{ index: number; problem: string }>,
): string {
  return [
    "=== REVISION REQUIRED — your previous drills had these problems; fix ALL of them while keeping EXACTLY 3 drills ===",
    ...issues.map((i) => `  - Drill ${i.index + 1}: ${i.problem}`),
  ].join("\n");
}

// ───────────────────────────────────────────────────────────────────────
// Sparring plan — generated in the SAME pipeline as the drills so the
// live-round plan stays faithful to the diagnosed objective (no perspective
// inversion). GENERATE (strong) → VERIFY (cheap, catches inversions) → one
// revision pass. Returns null on failure so the mission still persists (its
// graduation then falls back to the legacy LLM path).
// ───────────────────────────────────────────────────────────────────────

async function generateAndVerifySparring({
  sport,
  focusTechnique,
  objective,
  rationale,
  diagnosis,
  groundingBlock,
}: {
  sport: string;
  focusTechnique: string;
  objective: string;
  rationale: string;
  diagnosis: Diagnosis;
  groundingBlock: string;
}): Promise<StoredSparringPlan | null> {
  const fillSport = (tpl: string) => tpl.replace(/\{sport\}/g, sport);
  const diagnosisBlock = formatDiagnosisBlock(diagnosis);

  const userMsg = [
    `Discipline: ${sport}`,
    `Technique the athlete just drilled: ${focusTechnique}`,
    `OBJECTIVE for this technique (your whole plan MUST serve this): ${objective}`,
    `Why they drilled it (mission rationale): ${rationale}`,
    diagnosisBlock,
    groundingBlock,
    `Return ONLY the JSON object: { whenToUse, setups, counters, combinations }.`,
  ]
    .filter((b) => b.length > 0)
    .join("\n\n");

  const gen = (extraSystem?: string): Promise<z.infer<typeof SparringPlanSchema>> =>
    callGroqWithRetry({
      model: "openai/gpt-oss-120b",
      messages: [
        {
          role: "system",
          content: extraSystem
            ? `${fillSport(MISSION_SPARRING_PROMPT)}\n\n${extraSystem}`
            : fillSport(MISSION_SPARRING_PROMPT),
        },
        { role: "user", content: userMsg },
      ],
      temperature: 0.4,
      max_tokens: 900,
      response_format: { type: "json_object" },
      timeoutMs: 15000,
      schema: SparringPlanSchema,
    });

  let plan: z.infer<typeof SparringPlanSchema>;
  try {
    plan = await gen();
  } catch (err) {
    console.warn("trainingMissions.generate: sparring generate failed", err);
    return null;
  }

  // VERIFY — specifically catches perspective inversion (offense vs the
  // drilled defensive/pressure objective). One revision pass on "revise".
  try {
    const review = await callGroqWithRetry({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: fillSport(MISSION_SPARRING_VERIFY_PROMPT) },
        {
          role: "user",
          content: [
            `OBJECTIVE: ${objective}`,
            `Technique: ${focusTechnique}`,
            `Problem drilled to fix: ${diagnosis.problem}`,
            rationale ? `Mission rationale: ${rationale}` : "",
            "=== PLAN TO REVIEW ===",
            `whenToUse: ${plan.whenToUse}`,
            `setups: ${plan.setups.join(" | ")}`,
            `counters: ${plan.counters.join(" | ")}`,
            `combinations: ${plan.combinations.join(" | ")}`,
          ]
            .filter((l) => l.length > 0)
            .join("\n"),
        },
      ],
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: "json_object" },
      timeoutMs: 12000,
      schema: SparringVerifySchema,
      maxRetries: 1,
    });
    if (review.verdict === "revise" && review.problem.length > 0) {
      try {
        plan = await gen(
          `=== REVISION REQUIRED — your previous plan had this problem; fix it while keeping the OBJECTIVE "${objective}" front and centre: ${review.problem}`,
        );
      } catch (err) {
        console.warn("trainingMissions.generate: sparring revision failed", err);
      }
    }
  } catch (err) {
    console.warn("trainingMissions.generate: sparring verify failed", err);
  }

  return {
    objective,
    whenToUse: stripEmDashes(plan.whenToUse),
    setups: plan.setups.map(stripEmDashes),
    counters: plan.counters.map(stripEmDashes),
    combinations: plan.combinations.map(stripEmDashes),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Per-issue DIAGNOSE → GENERATE → VERIFY pipeline
// ───────────────────────────────────────────────────────────────────────

/**
 * Run the full DIAGNOSE → GENERATE → VERIFY pipeline for a single issue.
 * Returns the final `MissionPayload` or throws on unrecoverable failure.
 */
async function runGeneratePipeline({
  sport,
  userMsg,
  historyBlock,
  groundingBlock,
  issueFocus,
}: {
  sport: string;
  userMsg: string;
  historyBlock: string;
  groundingBlock: string;
  /** Optional one-line focus injected when generating for a specific extracted issue. */
  issueFocus?: string;
}): Promise<{
  payload: MissionPayload;
  verifyVerdict: "pass" | "revise" | "skipped";
  objective: string;
  sparringPlan: StoredSparringPlan | null;
}> {
  const fillSport = (tpl: string) => tpl.replace(/\{sport\}/g, sport);

  // Build the user message for this issue's generation call.
  const issueNote = issueFocus
    ? `Focus specifically on this coaching issue: ${issueFocus}\n\n`
    : "";

  // Stage A: DIAGNOSE (strong model, REQUIRED). It is the anchor every later
  // stage reads, so a failure throws rather than degrading to an unanchored
  // generation. The caller skips the issue and leaves the notes watermark
  // alone, letting the hourly sweep retry.
  let diagnosis: Diagnosis;
  try {
    diagnosis = await callGroqWithRetry({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: fillSport(DIAGNOSE_MISSION_PROMPT) },
        { role: "user", content: `${issueNote}${userMsg}` },
      ],
      temperature: 0.3,
      max_tokens: 700,
      response_format: { type: "json_object" },
      timeoutMs: 12000,
      schema: DiagnosisSchema,
      maxRetries: 2,
    });
  } catch (err) {
    throw new DiagnoseFailedError(
      err instanceof GroqError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err),
      { cause: err },
    );
  }

  // Stage B: GENERATE (strong model).
  const diagnosisBlock = formatDiagnosisBlock(diagnosis);
  const genUserMsg = [
    issueNote,
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

  const parsed = await generate();

  // Problems that trigger the single revision pass, from both the
  // deterministic perspective gate and VERIFY.
  const revisionIssues: Array<{ index: number; problem: string }> = [];

  // Stage B2: PERSPECTIVE GATE (deterministic, no LLM call). A defender
  // handed an offensive objective is being drilled on the opponent's half of
  // the exchange. VERIFY cannot see this on its own: the drills faithfully
  // serve the objective they were given.
  const perspective = checkPerspective(
    diagnosis,
    normalizeObjective(parsed.objective),
  );
  if (!perspective.ok) {
    revisionIssues.push({ index: 0, problem: perspective.problem });
  }

  // Stage C: VERIFY (strong model, best-effort; one regeneration pass). It
  // sees the raw note as well as the diagnosis so it can catch an inversion
  // baked into the diagnosis itself.
  let verifyVerdict: "pass" | "revise" | "skipped" = "skipped";
  let finalPayload = parsed;
  try {
    const review = await callGroqWithRetry({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: fillSport(VERIFY_MISSION_PROMPT) },
        {
          role: "user",
          content: [
            "=== ATHLETE'S ORIGINAL NOTE ===",
            userMsg,
            diagnosisBlock,
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
      max_tokens: 700,
      response_format: { type: "json_object" },
      timeoutMs: 12000,
      schema: VerifySchema,
      maxRetries: 1,
    });
    verifyVerdict = review.verdict;
    if (review.verdict === "revise") {
      revisionIssues.push(...review.issues);
    }
  } catch (err) {
    console.warn("trainingMissions.generate: verify stage failed", err);
  }

  if (revisionIssues.length > 0) {
    try {
      finalPayload = await generate(formatVerifierFeedback(revisionIssues));
    } catch (err) {
      console.warn("trainingMissions.generate: revision pass failed", err);
    }
  }

  // The revision pass is single-shot, so a stubborn model can hand back an
  // objective that still inverts the athlete's role. Stage D builds the sparring
  // plan FROM this objective, so an inverted value would leak all the way into
  // the live-round game plan. Coerce it deterministically instead: a defender
  // defends, a counter-attacker counters. Cheaper and stricter than a second
  // regeneration, and it cannot fail.
  let objective = normalizeObjective(finalPayload.objective);
  const postRevision = checkPerspective(diagnosis, objective);
  if (!postRevision.ok) {
    objective = diagnosis.athleteRole === "defender" ? "defense" : "counter";
    console.warn(
      "trainingMissions.generate: objective still inverted after revision, coercing",
      { athleteRole: diagnosis.athleteRole, coercedTo: objective },
    );
  }

  // Stage D: SPARRING PLAN (generated from the SAME diagnosis + objective so
  // the live-round plan can never invert the drilled intent). Best-effort: if
  // it fails, the mission still persists and graduation falls back to the LLM.
  const focusTechnique = stripEmDashes(finalPayload.focusTechnique).slice(0, 60);
  let sparringPlan: StoredSparringPlan | null = null;
  try {
    sparringPlan = await generateAndVerifySparring({
      sport,
      focusTechnique,
      objective,
      rationale: finalPayload.rationale,
      diagnosis,
      groundingBlock,
    });
  } catch (err) {
    console.warn("trainingMissions.generate: sparring plan stage failed", err);
  }

  return { payload: finalPayload, verifyVerdict, objective, sparringPlan };
}

// ───────────────────────────────────────────────────────────────────────
// Main entry point
// ───────────────────────────────────────────────────────────────────────

export const generateMissionIfReady = internalAction({
  args: { userId: v.id("users"), sport: v.string() },
  handler: async (
    ctx,
    { userId, sport },
  ): Promise<
    | { skipped: "cycle_in_progress" }
    | { skipped: "no_new_notes" }
    | { skipped: "all_deduped" }
    | { skipped: "diagnose_failed" }
    | { created: Id<"training_missions"> }
    | { error: string }
  > => {

    // ── Step 1: Frozen-cycle guard ─────────────────────────────────────
    // If ANY active mission exists for this (userId, sport), the current
    // cycle is still in progress. Do NOT advance the notes cursor — new
    // notes stay queued and will be consumed by the next cycle.
    const activeMissions = await ctx.runQuery(
      internal.training_missions.listActiveMissionsForSport,
      { userId, sport },
    );
    if (activeMissions.length > 0) {
      return { skipped: "cycle_in_progress" };
    }

    // ── Step 2: Window cursor + notes collection ────────────────────────
    // Use the latest mission (any status) to establish the cursor — even if
    // it's completed, we still want to skip notes that were already consumed.
    const latest = await ctx.runQuery(
      internal.training_missions.getLatestForSport,
      { userId, sport },
    );

    const cursor = Math.max(
      latest?.notesWindowStart ?? 0,
      latest?.createdAt ?? 0,
    );

    const noteRows = await ctx.runQuery(
      internal.fight_camp.listNotesSince,
      { userId, sport, since: cursor },
    );
    if (noteRows.length === 0) {
      return { skipped: "no_new_notes" };
    }

    // ── Step 3: Pro gate ────────────────────────────────────────────────
    await enforceFeatureGate(ctx, userId, "AI_TRAINING_COACH_PATHS");

    // ── Step 4: Sanitize + join notes ───────────────────────────────────
    const sanitizedNotes = noteRows
      .map((r: { notes?: string }) =>
        sanitizeUserText(r.notes ?? "", { maxLength: 1500, raw: true }),
      )
      .filter((s: string) => s.length > 0)
      .join("\n---\n");

    if (!sanitizedNotes) {
      return { skipped: "no_new_notes" };
    }

    const userMsg = [
      `Sport: ${sport}`,
      `Recent session notes (chronological, separated by ---):`,
      `<user_input>${sanitizedNotes}</user_input>`,
    ].join("\n");

    // ── Generation-job marker (reactive "generating drills" signal) ─────
    // We only reach here after all idempotency guards (cycle_in_progress,
    // no_new_notes) and the Pro gate have passed, so genuine generation is
    // about to begin. Mark the job in-flight and clear it in `finally` so a
    // crash/throw still removes the marker.
    await ctx.runMutation(internal.mastery_spine.startGenerationJob, {
      userId,
      discipline: sport,
      kind: "drills",
    });
    try {
    // ── Step 5: Extract ≤3 issues ───────────────────────────────────────
    const issues = await extractIssues({ notes: sanitizedNotes });
    // issues is always ≥1 (fallback guaranteed by extractIssues).

    // ── Shared context blocks for all per-issue pipelines ───────────────
    const history = await ctx
      .runQuery(internal.training_missions.getRecentMissionHistory, {
        userId,
        sport,
        limit: 3,
      })
      .catch(() => [] as never[]);
    const historyBlock = formatHistoryBlock(history);
    const groundingBlock = buildGroundingBlock(sport);

    // ── Step 6: Shared cycleId for the whole batch ──────────────────────
    const cycleId = `${sport}:${Date.now()}`;

    // Active camp for this generation — dedup must be camp-scoped so a
    // technique earned in a prior camp doesn't suppress a fresh mission in
    // the current one. The mission insert resolves its own campId server-side.
    const activeCampId = await ctx.runQuery(
      internal.fight_camp.getActiveCampIdInternal,
      { userId },
    );

    // ── Step 7: Per-issue dedupe + generate ─────────────────────────────
    const sourceSessionIds = noteRows.map(
      (r: { _id: Id<"fight_camp_calendar"> }) => r._id,
    );
    const notesWindowStart = Date.now();

    let firstMissionId: Id<"training_missions"> | null = null;
    let insertCount = 0;
    let diagnoseFailures = 0;
    const auditIssues: Array<{
      technique: string;
      normalized: string;
      skippedReason?: string;
      missionId?: string;
      verifyVerdict?: string;
    }> = [];

    for (const extracted of issues) {
      const rawTechnique = stripEmDashes(extracted.technique).slice(0, 60);
      const normKey = normalizeTechniqueKey(sport, rawTechnique);

      // (a) Guard: active mission with the same normalised technique
      //     Shouldn't happen given the frozen-cycle guard, but defensive.
      const duplicateActive = await ctx.runQuery(
        internal.training_missions.findActiveMissionByTechnique,
        { userId, sport, focusTechniqueNormalized: normKey },
      );
      if (duplicateActive) {
        auditIssues.push({ technique: rawTechnique, normalized: normKey, skippedReason: "duplicate_active_mission" });
        continue;
      }

      // (b) Guard: non-mastered sparring assignment for the same technique
      //     (reinforce, don't duplicate). A MASTERED assignment allows a
      //     fresh journey.
      const existingAssignment = await ctx.runQuery(
        internal.sparring_plan.findAssignmentByNorm,
        { userId, techniqueNormalized: normKey, campId: activeCampId ?? undefined },
      );
      if (existingAssignment && !existingAssignment.masteredAt) {
        auditIssues.push({ technique: rawTechnique, normalized: normKey, skippedReason: "non_mastered_assignment_exists" });
        continue;
      }

      // Build a focused user message for this issue's pipeline.
      const issueFocus = `${extracted.issue} (technique: ${rawTechnique})`;

      let payload: MissionPayload;
      let verifyVerdict: "pass" | "revise" | "skipped";
      let objective: string;
      let sparringPlan: StoredSparringPlan | null;
      try {
        ({ payload, verifyVerdict, objective, sparringPlan } =
          await runGeneratePipeline({
            sport,
            userMsg,
            historyBlock,
            groundingBlock,
            issueFocus,
          }));
      } catch (err) {
        const message =
          err instanceof DiagnoseFailedError
            ? err.message
            : err instanceof GroqError
              ? `${err.code}: ${err.message}`
              : err instanceof Error
                ? err.message
                : String(err);
        // DIAGNOSE is the anchor for every downstream stage, so a failure
        // there never falls through to an unanchored generation. Skip the
        // issue and leave the watermark untouched (see Step 9) so the hourly
        // sweep retries these notes.
        if (err instanceof DiagnoseFailedError) {
          console.warn("trainingMissions.generate: diagnose stage failed, skipping issue", err);
          diagnoseFailures += 1;
          auditIssues.push({ technique: rawTechnique, normalized: normKey, skippedReason: `diagnose_failed: ${message}` });
          continue;
        }
        // If even the first issue fails to generate, propagate the error.
        // If a later one fails, log and skip.
        if (insertCount === 0 && firstMissionId === null) {
          return { error: message };
        }
        console.warn("trainingMissions.generate: per-issue generation failed", err);
        auditIssues.push({ technique: rawTechnique, normalized: normKey, skippedReason: `generation_error: ${message}` });
        continue;
      }

      const focusTechnique = stripEmDashes(payload.focusTechnique).slice(0, 60);
      const focusTechniqueNormalized = normalizeTechniqueKey(sport, focusTechnique);

      // First insert: clears any residual active missions (skipMarkPrior=false,
      // which is the default). Subsequent inserts in the same batch must NOT
      // mark sibling missions completed (skipMarkPrior=true).
      const missionId: Id<"training_missions"> = await ctx.runMutation(
        internal.training_missions.insertMissionInternal,
        {
          userId,
          sport,
          title: payload.title,
          rationale: payload.rationale,
          sourceSessionIds,
          items: payload.items,
          notesWindowStart,
          focusTechnique,
          focusTechniqueNormalized,
          cycleId,
          objective,
          // Only attach the plan when the technique it was authored for matches
          // the persisted focusTechnique (they can differ if the model renamed
          // it post-verify); a deterministic graduation reads this verbatim.
          sparringPlan: sparringPlan ?? undefined,
          skipMarkPrior: insertCount > 0,
        },
      );

      if (insertCount === 0) {
        firstMissionId = missionId;
      }
      insertCount += 1;
      auditIssues.push({
        technique: rawTechnique,
        normalized: normKey,
        missionId: missionId,
        verifyVerdict,
      });
    }

    // ── Step 8: Audit log (fire-and-forget) ─────────────────────────────
    await logDecision(ctx, {
      userId,
      feature: "AI_TRAINING_COACH_PATHS",
      inputSnapshot: {
        sport,
        noteCount: noteRows.length,
        cursor,
        priorMissionCount: history.length,
        issuesExtracted: issues.length,
        cycleId,
      },
      outputJson: {
        cycleId,
        missionsCreated: insertCount,
        firstMissionId,
        diagnoseFailures,
        issues: auditIssues,
      },
      model:
        "extract:llama-3.1-8b-instant+diagnose:openai/gpt-oss-120b+generate:openai/gpt-oss-120b",
    });

    // ── Step 9: Return ───────────────────────────────────────────────────
    if (firstMissionId !== null) {
      return { created: firstMissionId };
    }

    // Nothing was inserted and at least one issue lost its DIAGNOSE. Those
    // notes were never consumed, so the watermark must NOT move: the hourly
    // sweep re-reads them and retries. Advancing here would silently drop a
    // real coaching issue on a transient LLM failure.
    if (diagnoseFailures > 0) {
      return { skipped: "diagnose_failed" };
    }

    // All issues were deduped away — no mission was inserted, so the notes
    // window was NOT advanced via the insert path. Without advancing the
    // watermark, the hourly missions sweep would re-extract the same notes
    // every hour (recurring LLM cost). Advance the latest mission's
    // notesWindowStart to this run's window-end boundary so the window is
    // treated as consumed. Returns `{ skipped: "all_deduped" }`.
    //
    // In the all-deduped case a latest mission (or assignment) always exists
    // — dedupe requires a prior journey — so `latest` is expected non-null.
    // Guard defensively: if somehow no latest mission exists, just return
    // without patching (the next run will treat the notes as new again, but
    // that path implies nothing was deduped, which is contradictory).
    if (latest) {
      await ctx.runMutation(
        internal.training_missions.advanceNotesWatermark,
        { missionId: latest._id, to: notesWindowStart },
      );
    }
    return { skipped: "all_deduped" };
    } finally {
      // Always clear the in-flight marker, even when generation threw.
      await ctx.runMutation(internal.mastery_spine.endGenerationJob, {
        userId,
        discipline: sport,
        kind: "drills",
      });
    }
  },
});
