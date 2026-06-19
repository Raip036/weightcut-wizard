/** Zod schemas for plan-generating AI outputs.
 *
 *  v2 (2026-05-18): card-based timeline rewrite. The plan returned by the
 *  AI is consumed by `InlinePlanDisplay.tsx` as a series of week cards
 *  with a hero metric, headline copy, and 3-5 bullet daily focus items.
 *  All long-form prose fields were either dropped or tightened so the
 *  UI doesn't have to render walls of text. See the matching prompt in
 *  `actions/generateCutPlan.ts` / `generateWeightPlan.ts` for how the
 *  LLM is told to fill the new shape.
 */
import { z } from "zod";

/** Phase classification — used for the timeline color rail + phase pills. */
const WeekPhaseSchema = z.enum([
  "foundation",
  "build",
  "peak",
  "final",
  "fight_week",
]);

const WeeklyEntrySchema = z.object({
  week: z.number().int().min(1).max(52),
  targetWeight: z.number().min(30).max(300),
  calories: z.number().int().min(800).max(5000),
  protein_g: z.number().min(40).max(400),
  carbs_g: z.number().min(0).max(700),
  fats_g: z.number().min(15).max(250),
  /** Phase classification. Drives the card's color rail + phase pill. */
  phase: WeekPhaseSchema,
  /** Single memorable sentence summarising the week's intent. ≤80 chars. */
  heroLine: z.string().min(4).max(80),
  /** Card headline metric (e.g. "−1.2 kg" or "Protein 2.0 g/kg"). ≤24 chars. */
  keyMetric: z.string().min(1).max(24),
  /** 3–5 imperative bullet items, each ≤60 chars. Replaces paragraph `focus`. */
  dailyFocus: z.array(z.string().min(2).max(60)).min(2).max(5),
  /** Optional "watch out for" inline chip on the expanded card. */
  risk: z.string().max(80).optional(),
  /** Optional "recover with" inline chip on the expanded card. */
  recovery: z.string().max(80).optional(),
});

/** Macro phase summary — drives the phase strip above the week timeline. */
const PhaseSummarySchema = z.object({
  name: WeekPhaseSchema,
  label: z.string().min(2).max(24),
  weekStart: z.number().int().min(1).max(20),
  weekEnd: z.number().int().min(1).max(20),
  intent: z.string().min(4).max(120),
});

export const CutPlanSchema = z.object({
  weeklyPlan: z.array(WeeklyEntrySchema).min(1).max(20),

  // Card-timeline additions
  phases: z.array(PhaseSummarySchema).min(1).max(4),
  /** 1–2 sentences directly addressing the user's `primary_struggle`. */
  personalNote: z.string().min(10).max(280),
  /** Highlights the week the user should mentally prepare for. */
  toughestWeek: z.object({
    week: z.number().int().min(1).max(20),
    reason: z.string().min(4).max(120),
  }),

  // Tightened narrative fields
  summary: z.string().min(10).max(500),
  safetyNotes: z.string().max(300).optional().default(""),
  keyPrinciples: z.array(z.string().max(120)).min(2).max(6).optional(),

  // Server-computed scalars (unchanged)
  totalWeeks: z.number().int().min(1).max(20).optional(),
  weeklyLossTarget: z.string().max(50).optional(),
  maintenanceCalories: z.number().int().min(1000).max(6000).optional(),
  deficit: z.number().int().min(0).max(1500).optional(),
  targetCalories: z.number().int().min(800).max(5000).optional(),

  // Fight-week block (cutting flow only) — tightened from 2000 to 240/each
  fightWeek: z
    .object({
      lowCarb: z.string().max(240),
      sodium: z.string().max(240),
      waterLoading: z.string().max(240),
      nutrition: z.string().max(240),
    })
    .optional(),

  confidence: z.number().min(0).max(1).optional(),
});

export type CutPlan = z.infer<typeof CutPlanSchema>;
export type WeekPhase = z.infer<typeof WeekPhaseSchema>;

// ───────────────────────────────────────────────────────────────────────
// Permissive schema for the *AI call only*.
//
// By design the plan generators ask the model for the NARRATIVE (heroLine,
// dailyFocus, phases, personalNote…) and compute the NUMBERS server-side —
// the prompt literally tells the model "never invent calories or macros".
// The full pipeline (`normaliseWeeklyPlan` + `normalisePlanTopLevel`) then
// backfills every number from the deterministic facts, tapers targetWeight,
// trims over-long strings, synthesises missing phases / personalNote, and
// caps array lengths. So validating the raw LLM output against the STRICT
// `CutPlanSchema` only manufactures failures (e.g. the model omits the
// server-computed `targetWeight`/`calories`/macros → "Required", or a
// heroLine runs a few chars long) and needlessly drops to the deterministic
// fallback, discarding the model's narrative.
//
// This schema only checks that the model returned roughly the right SHAPE
// (a non-empty `weeklyPlan` array of card-ish objects). Everything else is
// optional and the normalisers enforce the real constraints downstream.
const WeeklyEntryAiSchema = z
  .object({
    week: z.number().optional(),
    targetWeight: z.number().optional(),
    calories: z.number().optional(),
    protein_g: z.number().optional(),
    carbs_g: z.number().optional(),
    fats_g: z.number().optional(),
    phase: z.string().optional(),
    heroLine: z.string().optional(),
    keyMetric: z.string().optional(),
    dailyFocus: z.array(z.string()).optional(),
    risk: z.string().optional(),
    recovery: z.string().optional(),
  })
  .passthrough();

export const CutPlanAiSchema = z
  .object({
    weeklyPlan: z.array(WeeklyEntryAiSchema).min(1),
    phases: z.any().optional(),
    personalNote: z.string().optional(),
    toughestWeek: z.any().optional(),
    summary: z.string().optional(),
    safetyNotes: z.string().optional(),
    keyPrinciples: z.any().optional(),
    fightWeek: z.any().optional(),
  })
  .passthrough();

const HourlyStepSchema = z.object({
  hour: z.number().int().min(1).max(48),
  phase: z.string().max(80),
  fluidML: z.number().min(0).max(2000),
  sodiumMg: z.number().min(0).max(5000),
  potassiumMg: z.number().min(0).max(2000),
  magnesiumMg: z.number().min(0).max(1000),
  carbsG: z.number().min(0).max(150),
  drinkRecipe: z.string().max(500).optional().default(""),
  notes: z.string().max(500).optional().default(""),
  foods: z.array(z.string().max(200)).max(20).optional().default([]),
});

const PhaseSchema = z.object({
  startHour: z.number().int().min(1).max(48),
  endHour: z.number().int().min(1).max(48),
  phase: z.string().max(80),
  fluidMLPerHour: z.number().min(0).max(2000),
  sodiumMgPerHour: z.number().min(0).max(5000),
  potassiumMgPerHour: z.number().min(0).max(2000),
  magnesiumMgPerHour: z.number().min(0).max(1000),
  carbsGPerHour: z.number().min(0).max(150),
  drinkRecipe: z.string().max(500).optional().default(""),
  notes: z.string().max(500).optional().default(""),
  foods: z.array(z.string().max(200)).max(20).optional().default([]),
});

export const RehydrationPlanSchema = z
  .object({
    summary: z.string().min(5).max(1000),
    phases: z.array(PhaseSchema).min(1).max(12).optional(),
    hourlyProtocol: z.array(HourlyStepSchema).min(1).max(48).optional(),
    carbRefuelPlan: z
      .object({
        strategy: z.string().max(500),
        meals: z
          .array(
            z.object({
              timing: z.string().max(120),
              carbsG: z.number().min(0).max(400),
              foods: z.array(z.string().max(200)).max(20),
              rationale: z.string().max(500).optional().default(""),
            }),
          )
          .max(6),
      })
      .optional(),
    warnings: z.array(z.string().max(500)).min(1).max(6),
  })
  .refine((v) => Array.isArray(v.phases) || Array.isArray(v.hourlyProtocol), {
    message: "Either phases or hourlyProtocol must be present",
  });

export type RehydrationPlan = z.infer<typeof RehydrationPlanSchema>;

/* ------------------------------------------------------------------ */
/* v3 (2026-06-01): Weight Protocol Redesign — FightPlan + Rehydration */
/* Spec: docs/superpowers/specs/2026-06-01-weight-protocol-redesign-design.md §4.2 */
/* These schemas validate the raw JSON returned by Claude Opus 4.7;    */
/* deterministic day numerics are re-applied post-parse.               */
/* ------------------------------------------------------------------ */

export const FightPlanSchema = z.object({
  generatedAt: z.number(),
  campId: z.string(),
  approach: z.enum(["gradual", "standard", "aggressive"]),
  cutDepthKg: z.number(),
  cutDepthPct: z.number(),
  cutCategory: z.enum(["light", "moderate", "heavy", "extreme"]),

  safetyWarnings: z.array(
    z.object({
      severity: z.enum(["info", "warn", "critical"]),
      code: z.string(),
      message: z.string(),
    }),
  ),

  expectedWeightLossKg: z.object({
    glycogen: z.number(),
    water: z.number(),
    gut: z.number(),
    fat: z.number(),
    total: z.number(),
  }),

  days: z
    .array(
      z.object({
        dayIso: z.string(),
        dayLabel: z.string(),
        daysToWeighIn: z.number(),
        targetWeightKg: z.number().nullable(),
        carbsGrams: z.number(),
        carbsCopy: z.string(),
        waterLitres: z.number(),
        waterCopy: z.string(),
        sodiumMg: z.number(),
        sodiumCopy: z.string(),
        fibreNote: z.enum([
          "normal",
          "reduce",
          "eliminate",
          "low_residue_only",
        ]),
        fibreCopy: z.string(),
        /** Optional per-day fibre target in grams. AI-supplied (the LLM may
         *  omit it). Drives the day card's fibre figure when present. */
        fiberGrams: z.number().optional(),
        trainingRecommendation: z.string(),
        sleepTargetHours: z.number(),
        keyAction: z.string(),
        cautions: z.array(z.string()).max(3),
      }),
    )
    .min(1)
    .max(14),

  /** Optional one-line "when to cut / keep fibre" callout (≤200 chars). */
  fiberStrategy: z.string().max(200).optional(),

  rolling: z.object({
    peakWaterDay: z.string(),
    sodiumCliffDay: z.string(),
    glycogenFloorDay: z.string(),
  }),
});

export type FightPlan = z.infer<typeof FightPlanSchema>;

/**
 * Lenient schema for parsing the raw AI response. Every field the server
 * overwrites in `mergeFightPlan` is optional here — the AI's job is purely
 * to provide per-day copy text. Without this, strict `FightPlanSchema`
 * parsing throws when the LLM (correctly) omits server-authoritative
 * fields like `generatedAt`, `campId`, `cutDepthKg`, `sleepTargetHours`,
 * etc. Days array cap is relaxed to 21 so a slightly chatty model
 * doesn't kill the parse (the merge step indexes by `dayIso` and
 * silently drops anything not in the skeleton).
 */
export const AiFightPlanResponseSchema = z.object({
  generatedAt: z.number().optional(),
  campId: z.string().optional(),
  approach: z.enum(["gradual", "standard", "aggressive"]).optional(),
  cutDepthKg: z.number().optional(),
  cutDepthPct: z.number().optional(),
  cutCategory: z.enum(["light", "moderate", "heavy", "extreme"]).optional(),

  safetyWarnings: z
    .array(
      z.object({
        severity: z.enum(["info", "warn", "critical"]),
        code: z.string(),
        message: z.string(),
      }),
    )
    .optional(),

  expectedWeightLossKg: z
    .object({
      glycogen: z.number(),
      water: z.number(),
      gut: z.number(),
      fat: z.number(),
      total: z.number(),
    })
    .optional(),

  days: z
    .array(
      z.object({
        // Optional, consistent with every sibling field: the prompt only
        // asks the model for copy ("numerics replaced server-side") and
        // never requests dayIso, so models omit it. The merge step matches
        // copy to skeleton days by position (iso is a best-effort key).
        dayIso: z.string().optional(),
        dayLabel: z.string().optional(),
        daysToWeighIn: z.number().optional(),
        targetWeightKg: z.number().nullable().optional(),
        carbsGrams: z.number().optional(),
        carbsCopy: z.string().optional(),
        waterLitres: z.number().optional(),
        waterCopy: z.string().optional(),
        sodiumMg: z.number().optional(),
        sodiumCopy: z.string().optional(),
        fibreNote: z
          .enum(["normal", "reduce", "eliminate", "low_residue_only"])
          .optional(),
        fibreCopy: z.string().optional(),
        // Optional, like every sibling — the LLM may omit it and the merge
        // step falls back to `undefined` rather than throwing.
        fiberGrams: z.number().optional(),
        trainingRecommendation: z.string().optional(),
        sleepTargetHours: z.number().optional(),
        keyAction: z.string().optional(),
        cautions: z.array(z.string()).max(3).optional(),
      }),
    )
    .min(0)
    .max(21)
    .optional(),

  // Optional top-level fibre callout — mirrors the strict schema field but
  // never throws if the model omits it.
  fiberStrategy: z.string().max(200).optional(),

  rolling: z
    .object({
      peakWaterDay: z.string(),
      sodiumCliffDay: z.string(),
      glycogenFloorDay: z.string(),
    })
    .optional(),
});

export type AiFightPlanResponse = z.infer<typeof AiFightPlanResponseSchema>;

export const RehydrationProtocolSchema = z.object({
  generatedAt: z.number(),
  campId: z.string(),
  weighInWeightKg: z.number(),
  fightWeightTargetKg: z.number(),
  weighInToFightGapHours: z.number(),

  orsRecipe: z.object({
    perLitre: z.array(
      z.object({
        ingredient: z.string(),
        amount: z.number(),
        unit: z.enum(["g", "mg", "ml"]),
        role: z.string(),
        note: z.string(),
      }),
    ),
    totalLitresTarget: z.number(),
    diyShoppingList: z.array(z.string()),
    commercialEquivalents: z.array(z.string()),
  }),

  hours: z.array(
    z.object({
      hourOffset: z.number(),
      label: z.string(),
      liquidsMl: z.number(),
      liquidsComposition: z.string(),
      foodGrams: z.object({
        carbs: z.number(),
        protein: z.number(),
        fat: z.number(),
        sodium: z.number(),
      }),
      foodCopy: z.string(),
      notes: z.string(),
      caution: z.string().nullable(),
      // ── Hourly rehydrate/refeed additions (2026-06-19) — all OPTIONAL so
      //    existing persisted protocols still validate. The deterministic
      //    `buildRehydrationHourlyPlan` populates these; the AI only authors
      //    `cue` / `mealLabel` copy. ──
      /** Sodium delivered with this hour's fluid, mg (per-litre, mass-independent). */
      sodiumMg: z.number().optional(),
      /** Carbohydrate to ingest this hour, g. 0 during sleep + pre-fight. */
      carbG: z.number().optional(),
      /** True for hours inside the sleep window (no intake). */
      isSleep: z.boolean().optional(),
      /** Whether to treat this hour as a meal slot. */
      isMeal: z.boolean().optional(),
      /** Meal name when `isMeal`. */
      mealLabel: z.string().nullable().optional(),
      /** Phase classification for timeline grouping. */
      phase: z.string().optional(),
      /** Imperative cue text (deterministic default; AI may overwrite). */
      cue: z.string().optional(),
    }),
  ),

  /** Set when the deficit can't be safely replaced in the available waking
   *  hours ("you cut too much for this gap"). Optional/additive. */
  deficitTooLarge: z.boolean().optional(),

  doNots: z.array(z.string()).max(7),
  feelChecks: z.array(
    z.object({
      metric: z.enum([
        "urine_colour",
        "weigh_back_kg",
        "energy_1to10",
        "headache",
        "no_cramps",
      ]),
      target: z.string(),
    }),
  ),
});

export type RehydrationProtocol = z.infer<typeof RehydrationProtocolSchema>;

/* ------------------------------------------------------------------ */
/* CoachMessage (2026-06-04): Fight Camp Coach redesign — Phase 1.     */
/* Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md §4 */
/*                                                                     */
/* The shared contract for the rewritten `fightCampCoach.run` action   */
/* and the `CoachBlocks.tsx` renderer. Discriminated union on `type`.  */
/* EVERY string and array has a TIGHT `.max()` cap — this is the       */
/* mechanism that structurally prevents wall-of-text replies (same     */
/* discipline as CutPlanAiSchema). Numbers in weight_target/chart/     */
/* metric_row are computed server-side and merged in — never trusted   */
/* from the LLM. Importable by both the Convex action and the React    */
/* client via `import type { CoachMessage } from "convex/_shared/aiSchemas"`. */
/* ------------------------------------------------------------------ */

/** Which optimistic log flow a checklist item ties back to. */
const LogKeySchema = z.enum(["weight", "fluid", "carbs", "sweat"]);

/** CTA target for an `action` block. Discriminated union on `kind`. */
const LogActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("log_weight"),
    suggested_kg: z.number().optional(),
  }),
  z.object({
    kind: z.literal("log_fluid"),
    suggested_ml: z.number().optional(),
  }),
  z.object({ kind: z.literal("open_plan") }),
  z.object({ kind: z.literal("open_rehydration") }),
]);

/** Block variants. Discriminated union on `type`; tight caps throughout. */
const CoachBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("weight_target"),
    current_kg: z.number(),
    target_kg: z.number(),
    delta_kg: z.number(),
    days_out: z.number(),
    on_track: z.boolean(),
    note: z.string().max(80).optional(),
  }),
  z.object({
    type: z.literal("checklist"),
    title: z.string().max(40),
    items: z
      .array(
        z.object({
          label: z.string().max(60),
          done: z.boolean().optional(),
          logKey: LogKeySchema.optional(),
        }),
      )
      .min(1)
      .max(6),
  }),
  z.object({
    type: z.literal("timeline"),
    title: z.string().max(40),
    steps: z
      .array(
        z.object({
          when: z.string().max(16),
          label: z.string().max(50),
          value: z.string().max(24).optional(),
        }),
      )
      .min(2)
      .max(8),
  }),
  z.object({
    type: z.literal("metric_row"),
    metrics: z
      .array(
        z.object({
          label: z.string().max(20),
          value: z.string().max(16),
          tone: z.enum(["good", "warn", "bad"]).optional(),
        }),
      )
      .min(1)
      .max(4),
  }),
  z.object({
    type: z.literal("action"),
    label: z.string().max(50),
    description: z.string().max(120).optional(),
    action: LogActionSchema,
  }),
  z.object({
    type: z.literal("chart"),
    title: z.string().max(40),
    kind: z.enum([
      "weight_trend",
      "fluid",
      "training_load",
      "calories",
      "sleep",
      "hrv",
    ]),
    // SERVER-supplied only — the LLM never emits chart series.
    series: z.array(z.object({ x: z.string(), y: z.number() })).max(30),
    targetLine: z.number().optional(),
  }),
  z.object({
    type: z.literal("callout"),
    tone: z.enum(["info", "warn", "danger"]),
    text: z.string().max(200),
  }),
  // ── Generic visual primitives (2026-06-04): domain-aware cards. ──
  // Any data domain (training load, nutrition, recovery…) maps onto
  // these three shapes so the renderer stays domain-agnostic. Same
  // tight-cap discipline as the blocks above.
  z.object({
    type: z.literal("stat_card"),
    title: z.string().max(40),
    value: z.string().max(16),
    unit: z.string().max(8).optional(),
    tone: z.enum(["good", "warn", "bad", "neutral"]).optional(),
    subtitle: z.string().max(80).optional(),
    icon: z.string().max(24).optional(),
  }),
  z.object({
    type: z.literal("list"),
    title: z.string().max(40),
    items: z
      .array(
        z.object({
          label: z.string().max(48),
          value: z.string().max(24).optional(),
          meta: z.string().max(32).optional(),
        }),
      )
      .min(1)
      .max(6),
  }),
  z.object({
    type: z.literal("score_ring"),
    label: z.string().max(40),
    score: z.number(),
    status: z.string().max(32).optional(),
    sublabels: z
      .array(
        z.object({
          label: z.string().max(20),
          value: z.string().max(12),
          tone: z.enum(["good", "warn", "bad"]).optional(),
        }),
      )
      .max(5)
      .optional(),
  }),
]);

export const CoachMessageSchema = z.object({
  /** 1–3 sentences, conversational, ALWAYS present. */
  reply: z.string().max(600),
  /** 0–6 blocks; empty is valid (pure-prose turn). Raised from 4 to give
   *  domain cards a little more room — safety is still prioritized at merge
   *  time when the final block set is assembled. */
  blocks: z.array(CoachBlockSchema).max(6).default([]),
  /** 0–3 suggested quick-reply chips, each ≤ 40 chars. */
  followups: z.array(z.string().max(40)).max(3).optional(),
});

export type CoachMessage = z.infer<typeof CoachMessageSchema>;
export type CoachBlock = z.infer<typeof CoachBlockSchema>;
export type CoachBlockType = CoachBlock["type"];
export type LogAction = z.infer<typeof LogActionSchema>;
export type LogKey = z.infer<typeof LogKeySchema>;

/* ------------------------------------------------------------------ */
/* Domain selection (2026-06-04): domain-aware cards.                   */
/*                                                                     */
/* A cheap LLM "arbiter" call picks which data domains are relevant to */
/* the user's turn (≤3) before the main coach call. The per-domain     */
/* card builders then hydrate only the selected slices of DomainBundle */
/* (see convex/_shared/coachDomains/types.ts).                         */
/* ------------------------------------------------------------------ */

/** The data domains the coach can surface cards for. */
export const DomainIdSchema = z.enum([
  "weight",
  "fight_week",
  "training_load",
  "nutrition",
  "fight_score",
  "recovery",
  "sleep",
]);

export type DomainId = z.infer<typeof DomainIdSchema>;

/** Arbiter output: up to 3 relevant domains for the current turn. */
export const DomainSelectionSchema = z.object({
  domains: z.array(DomainIdSchema).max(3),
});

export type DomainSelection = z.infer<typeof DomainSelectionSchema>;
