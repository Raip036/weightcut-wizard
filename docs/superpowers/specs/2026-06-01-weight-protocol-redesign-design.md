# Weight Protocol Redesign — Design

**Date:** 2026-06-01
**Status:** Spec — awaiting user review before implementation plan
**Scope:** New unified `/weight-protocol` page replacing existing FightWeek + Hydration pages. AI-generated fight-week cut protocol + hour-by-hour rehydration timeline, grounded in deterministic math + ISSN 2025 + Reid Reale GSSI sports-nutrition research. Pro-gated past Day 2 of the fight plan.

---

## 1. Goals

1. **One page, two protocols, one mental model** — replace FightWeek and Hydration with `/weight-protocol`, single-scroll, two clear sections (Fight Plan + Rehydration).
2. **Personalized to the athlete** — uses body type, cut depth, weigh-in→fight gap, 7-day training load, 7-day sleep, 14-day wellness, and prior camp rebound history.
3. **Research-grounded protocol values** — every mg, g, ml comes from a deterministic formula citing ISSN 2025, Reale GSSI SSE #183, UFC PI, or WHO ORS — not from AI invention.
4. **AI writes the copy, not the numbers** — Claude Opus 4.7 (OpenRouter, fallback Groq) fills `*Copy`, `keyAction`, `cautions`, food/liquid composition strings; numerics are server-computed and re-stamped onto the AI response post-parse.
5. **Safety-first** — deterministic warnings (cut >8%, aggressive timeline, sleep debt, low readiness) are computed before the AI and merged into the final payload regardless of what the AI says.
6. **Pro funnel without compromising safety** — Days 1-2 free (lets the user feel the value); Days 3+ and the entire post-weigh-in flow are Pro. Safety warnings and DoNot callouts are always free.

## 2. Non-goals

- No coach/medical-professional view of the protocol.
- No multi-fighter (gym) view; this is per-user.
- No streaming SSE output during generation; synchronous request with skeleton loading state.
- No IV / supplement protocol generation beyond caffeine timing.
- No automatic detection of weight class (user-supplied target weight only).
- No food-database integration (protocol prescribes generic food categories — "white rice, lean chicken").
- No regeneration of older completed camps; locked once past weigh-in window.
- No notifications / push alerts in v1 (deferred).

---

## 3. Algorithm — deterministic numerics + AI narration

### 3.1 Three layers, in order

```
USER ──▶ INPUTS ──▶ DERIVED ──▶ SAFETY ──▶ SKELETON ──▶ AI ──▶ MERGE ──▶ PERSIST
        (Convex)   (pure fn)   (pure fn)  (pure fn)    (Opus)  (numerics
                                                                replaced)
```

The AI sees the skeleton as `MUST PRESERVE` context. The merge step overwrites every numeric field in the AI response with the skeleton's value — even if Opus drifted on a number, the persisted payload has the correct value.

### 3.2 Inputs (Convex query)

Single consolidated `internal.weight_protocols_internal.gatherInputs({ userId, campId })`:

```ts
{
  profile: { age, sex, heightCm, currentWeightKg, tdee },
  camp: { fightDate, weighInDate, weighInTime, targetWeightKg },
  weights28d: WeightLog[],
  sessions7d: TrainingSession[],
  sleep7d: SleepLog[],
  wellness14d: WellnessCheckIn[],
  priorCamps: FightCamp[],          // completed only
  today: string,                    // YYYY-MM-DD
}
```

User-supplied `approach: "gradual" | "standard" | "aggressive"` is the only non-DB input.

### 3.3 Derived metrics (pure)

`convex/_shared/weightProtocolMath.ts`:

```ts
export interface DerivedInputs {
  currentWeightKg: number;
  targetWeightKg: number;
  cutDepthKg: number;
  cutDepthPct: number;
  cutCategory: 'light' | 'moderate' | 'heavy' | 'extreme';
  leanBodyMassKg: number;           // Boer formula
  weighInIso: string;
  fightIso: string;
  weighInToFightHours: number;
  daysToFight: number;
  daysToWeighIn: number;
  trainingLoadIndex7d: number;      // reuses performanceEngine sport weights
  avgSleepHours7d: number;
  recoveryReadinessToday: number | null;
  historicalReboundKg: number | null;
  historicalReboundPct: number | null;
}
```

Thresholds:
- `light < 2%`, `moderate 2-4%`, `heavy 4-6%`, `extreme > 6%` of body weight.
- LBM (Boer): male `0.407·W + 0.267·H − 19.2`, female `0.252·W + 0.473·H − 48.3`.

### 3.4 Safety warnings (deterministic, before AI)

```ts
buildSafetyWarnings(d: DerivedInputs, priorCamps: FightCamp[]): SafetyWarning[]
```

Triggers:
- `cutDepthPct > 8` → `critical`, code `DEPTH_GT_8PCT`, force `approach = "gradual"`
- `cutDepthPct > 5 && daysToWeighIn < 3` → `critical`, code `AGGRESSIVE_TIMELINE`
- `historicalReboundPct > 10` → `warn`, code `PRIOR_HIGH_REBOUND`
- `avgSleepHours7d < 6.5` → `warn`, code `SLEEP_DEBT`
- `recoveryReadinessToday < 40` → `warn`, code `LOW_READINESS`
- Female + `cutDepthPct > 7` → `warn`, code `FEMALE_CAP`
- First-time cutter (no prior camps) + `cutDepthPct > 5` → `critical`, code `FIRST_TIMER_DEEP_CUT`

Each warning has a fixed `code` (machine-readable) and a `message` (user-facing, ≤180 chars). The AI is told `MUST PRESERVE EXACTLY` and the post-merge step also re-injects the array to guarantee preservation.

### 3.5 Skeleton (deterministic, all numerics)

#### Fight Plan day skeleton

For each day from T-N to T-0 (where N is `min(14, daysToWeighIn)`), produces:

```ts
{
  dayIso: string,
  dayLabel: string,            // "T-7", "T-1", "Weigh-in"
  daysToWeighIn: number,
  targetWeightKg: number | null,
  carbsGrams: number,
  waterLitres: number,
  sodiumMg: number,
  fibreNote: 'normal' | 'reduce' | 'eliminate' | 'low_residue_only',
  trainingRecommendation: string,  // skeleton template; AI may augment
  sleepTargetHours: number,
}
```

Day-by-day formulas use the **5% standard cut** template (75kg male) as anchor, scaled by `cutDepthPct` and `currentWeightKg`:

| Day | Carbs (g/kg) | Water (mL/kg) | Sodium (mg) | Fibre |
|---|---|---|---|---|
| T-7 | 3.0 | 100 | normal (~2500) | normal |
| T-6 | 3.0 | 100 | normal | normal |
| T-5 | 2.0 | 100 | normal | reduce (<15g) |
| T-4 | 1.0 | 75 | normal | eliminate (<10g) |
| T-3 | 50g total (cap) | 50 | 1000 | eliminate (<10g) |
| T-2 | 50g cap | 30 | <500 | low_residue_only (<5g) |
| T-1 | 30g cap | 15 | <200 | low_residue_only |
| T-0 | 0 | sips (<300ml) | 0 | nil |

`approach` modifier:
- `gradual`: shift the curve right by 1 day (start carb cut at T-3 instead of T-4)
- `standard`: as table above
- `aggressive`: shift left by 1 day (start carb cut at T-5)

Safety override: if any `critical` warning triggered → force `gradual`.

Expected weight loss breakdown (deterministic):
```ts
expectedWeightLossKg = {
  glycogen: 0.015 * currentWeightKg,       // ~1.5% BM
  water:    0.025 * currentWeightKg,       // ~2.5% BM from water load+restrict
  gut:      0.012 * currentWeightKg,       // ~1.2% BM from fibre cut
  fat:      max(0, cutDepthKg - sum_of_above)
}
```

#### Rehydration hour skeleton

For each hour from H+0 to H+`weighInToFightHours` (clamped [2, 30]):

```ts
{
  hourOffset: number,
  liquidsMl: number,
  foodGrams: { carbs: number, protein: number, fat: number, sodium: number },
}
```

Sodium curve (per ISSN 2025 + Maughan/Shirreffs):
- Hours 0-4: 800-1500 mg/hr (front-load plasma volume expansion)
- Hours 4-12: 400-600 mg/hr (intracellular phase)
- Hours 12-24: 200-400 mg/hr (maintenance)

Carbs curve (per Burke/Jeukendrup):
- Hours 0-4: 1.0-1.2 g/kg/hr high-GI
- Hours 4-12: 0.6-0.8 g/kg/hr around meals
- Hours 12-24: normal meals
- Total 24h: 8-10 g/kg body weight

Fluids: total = 150% of `cutDepthKg`, paced ≤1L/hr in first 2 hours, ≤800mL/hr thereafter.

### 3.6 AI prompt structure

```
ROLE
You are a world-class combat-sports nutrition coach with elite-level experience
in MMA, boxing, BJJ, and muay thai weight management. You write protocols
athletes actually follow on fight week.

TASK
Generate the {Fight Plan | Rehydration Protocol} for THIS athlete using ONLY
the inputs and research-grounded knowledge block below. Do not fabricate
physiology. Cite the "why" for each non-obvious recommendation inside the
relevant copy field — never as a separate sentence.

KNOWLEDGE
{{RESEARCH_BRIEF}}   // injected verbatim from convex/_shared/protocolResearch.ts

INPUTS
{{DERIVED_BLOCK}}              // age, sex, LBM, cut depth, training load 7d, etc.
{{DETERMINISTIC_SKELETON}}     // numerics per day/hour — copy verbatim

SAFETY (mandatory)
You MUST include EACH of these warnings verbatim in safetyWarnings[]:
{{SAFETY_WARNINGS_JSON}}

OUTPUT
Return ONLY JSON conforming to {{SCHEMA_NAME}}. Numerics in the skeleton
will be overwritten server-side if you change them — focus on the copy.

CONSTRAINTS
- Address the athlete in the second person ("You", "Your")
- No emojis. No em-dashes — use commas or periods
- No hedging copy ("might", "perhaps", "consider trying")
- Each *Copy field ≤ 140 chars, single sentence
- keyAction: imperative, ≤ 80 chars, the one bold action that day
- cautions: max 3 per day, each ≤ 80 chars
```

`RESEARCH_BRIEF` is a static module: `convex/_shared/protocolResearch.ts` (separate file so it can be updated independently). Contains condensed versions of the two research agent outputs — ~3k tokens of cited protocol context per call.

---

## 4. Schemas

### 4.1 Convex table addition (`convex/schema.ts`)

```ts
weight_protocols: defineTable({
  userId: v.id('users'),
  campId: v.id('fight_camps'),
  kind: v.union(v.literal('fight_plan'), v.literal('rehydration')),
  payload: v.any(),                  // FightPlan | RehydrationProtocol shape
  derivedSnapshot: v.any(),          // DerivedInputs at gen time (audit + drift detect)
  approach: v.optional(v.string()),  // 'gradual' | 'standard' | 'aggressive' (fight_plan only)
  model: v.string(),                 // 'anthropic/claude-opus-4-7' | 'openai/gpt-oss-120b'
  createdAt: v.number(),
})
  .index('by_user_camp_kind', ['userId', 'campId', 'kind'])
  .index('by_user_created', ['userId', 'createdAt']),
```

### 4.2 Zod schemas (`convex/_shared/aiSchemas.ts` additions)

```ts
export const FightPlanSchema = z.object({
  generatedAt: z.number(),
  campId: z.string(),
  approach: z.enum(['gradual', 'standard', 'aggressive']),
  cutDepthKg: z.number(),
  cutDepthPct: z.number(),
  cutCategory: z.enum(['light', 'moderate', 'heavy', 'extreme']),
  safetyWarnings: z.array(z.object({
    severity: z.enum(['info', 'warn', 'critical']),
    code: z.string(),
    message: z.string(),
  })),
  expectedWeightLossKg: z.object({
    glycogen: z.number(),
    water: z.number(),
    gut: z.number(),
    fat: z.number(),
    total: z.number(),
  }),
  days: z.array(z.object({
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
    fibreNote: z.enum(['normal', 'reduce', 'eliminate', 'low_residue_only']),
    fibreCopy: z.string(),
    trainingRecommendation: z.string(),
    sleepTargetHours: z.number(),
    keyAction: z.string(),
    cautions: z.array(z.string()).max(3),
  })).min(1).max(14),
  rolling: z.object({
    peakWaterDay: z.string(),
    sodiumCliffDay: z.string(),
    glycogenFloorDay: z.string(),
  }),
});

export const RehydrationProtocolSchema = z.object({
  generatedAt: z.number(),
  campId: z.string(),
  weighInWeightKg: z.number(),
  fightWeightTargetKg: z.number(),
  weighInToFightGapHours: z.number(),
  orsRecipe: z.object({
    perLitre: z.array(z.object({
      ingredient: z.string(),
      amount: z.number(),
      unit: z.enum(['g', 'mg', 'ml']),
      role: z.string(),                // "energy + Na cotransport"
      note: z.string(),                // "≈¼ tsp"
    })),
    totalLitresTarget: z.number(),
    diyShoppingList: z.array(z.string()),
    commercialEquivalents: z.array(z.string()),
  }),
  hours: z.array(z.object({
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
  })),
  doNots: z.array(z.string()).max(7),
  feelChecks: z.array(z.object({
    metric: z.enum(['urine_colour', 'weigh_back_kg', 'energy_1to10', 'headache', 'no_cramps']),
    target: z.string(),
  })),
});

export type FightPlan = z.infer<typeof FightPlanSchema>;
export type RehydrationProtocol = z.infer<typeof RehydrationProtocolSchema>;
```

### 4.3 Feature gate (`convex/_shared/featureGates.ts`)

Add `AI_WEIGHT_PROTOCOL`.

---

## 5. Convex actions

### 5.1 `convex/actions/generateFightPlan.ts`

```ts
'use node';
export const run = action({
  args: {
    campId: v.id('fight_camps'),
    approach: v.union(v.literal('gradual'), v.literal('standard'), v.literal('aggressive')),
  },
  handler: async (ctx, { campId, approach }) => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, 'AI_WEIGHT_PROTOCOL');
    await enforceRegenCap(ctx, userId, campId, 'fight_plan');  // 1×/day

    const inputs = await ctx.runQuery(internal.weight_protocols_internal.gatherInputs, { userId, campId });
    const derived = computeDerived(inputs, approach);
    const safety = buildSafetyWarnings(derived, inputs.priorCamps);
    const effectiveApproach = safety.some(w => w.severity === 'critical') ? 'gradual' : approach;
    const skeleton = buildFightPlanSkeleton(derived, effectiveApproach);

    // Uses existing callGroqRaw from convex/_shared/groq.ts with provider-conditional
    // model (mirrors campCompass pattern from recovery redesign).
    const ai = await callGroqRaw({
      model: opusOrFallback(),    // 'anthropic/claude-opus-4-7' on OpenRouter, 'openai/gpt-oss-120b' on Groq
      messages: [
        { role: 'system', content: buildFightPlanSystemPrompt() },
        { role: 'user', content: renderFightPlanUserPrompt({ inputs, derived, skeleton, safety }) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 4096,
      timeoutMs: 30_000,
    });
    const aiJson = parseJSON(ai.choices[0].message.content);
    const validated = FightPlanSchema.parse(aiJson);

    const merged = mergeFightPlan(skeleton, validated, safety, effectiveApproach);
    const id = await ctx.runMutation(internal.weight_protocols_internal.upsert, {
      userId, campId, kind: 'fight_plan', payload: merged,
      derivedSnapshot: derived, approach: effectiveApproach,
      model: 'anthropic/claude-opus-4-7',
    });
    return { id, payload: merged };
  },
});
```

`opusOrFallback()` returns `'anthropic/claude-opus-4-7'` if `LLM_PROVIDER=openrouter`, else `'openai/gpt-oss-120b'`. Same provider-conditional pattern as the recovery `campCompass.ts`.

### 5.2 `convex/actions/generateRehydrationProtocol.ts`

Mirrors above with `RehydrationProtocolSchema` + `buildRehydrationSkeleton` + `buildRehydrationSystemPrompt`. Takes only `{ campId }` (no approach selector — refeed strategy is fixed).

### 5.3 Internal helpers (`convex/weight_protocols_internal.ts`)

```ts
export const gatherInputs = internalQuery({ ... });
export const upsert = internalMutation({ ... });
export const maybeRegen = internalMutation({ ... });    // called by weight-log mutation post-trigger
```

### 5.4 Regeneration policy

- **Auto-regen** — `weight_logs.create` mutation schedules `internal.weight_protocols_internal.maybeRegen` 60s after write (debounce). If `|loggedKg − today's targetKg| > 0.5`, enqueues `internal.actions.generateFightPlan.runInternal`. Bypasses daily cap.
- **Manual regen** — 1×/UTC-day per kind via `rate_limits` table (existing pattern, key `weight_protocol_regen_${kind}`).
- **Lock window** — if `now > weighInDate + 24h` for rehydration, or `now > weighInDate` for fight_plan → throw `'WEIGHT_PROTOCOL_LOCKED'`. UI flips to read-only.

---

## 6. Research-grounded protocol values (the locked numbers)

These are baked into the deterministic skeleton + the AI's RESEARCH_BRIEF context block.

### 6.1 Fight Plan day-by-day (75kg male, 5% standard cut, 7-day window)

| Day | Carbs (g/kg) | Water (mL/kg) | Sodium (mg) | Fibre (g) | Training | Heat |
|---|---|---|---|---|---|---|
| T-7 | 3.0 | 100 | ~2500 | normal | last moderate | none |
| T-6 | 3.0 | 100 | ~2500 | normal | reduced technical | none |
| T-5 | 2.0 | 100 | ~2500 | <15 | light technical | none |
| T-4 | 1.0 | 75 | ~2500 | <10 | last skill | none |
| T-3 | <50 total | 50 | 1000 | <10 | movement only | none |
| T-2 | <50 | 30 | <500 | <5 | rest | none |
| T-1 | <30 | 15 (~1L) | <200 | liquid only | rest | sauna IF needed |
| T-0 | 0 | sips (<300mL) | 0 | 0 | rest | sauna IF needed |

Sources: ISSN 2025 position stand (Ricci, Evans et al.); Reale GSSI SSE #183; Reale et al. 2018 IJSNEM water loading study (PMID 29182412).

### 6.2 DIY ORS recipe (combat-adapted WHO formula)

Per 1 liter (~245 mOsm/L, hypotonic):

| Ingredient | Amount | Role |
|---|---|---|
| Water | 1000 mL | base |
| Glucose (sugar / dextrose / maltodextrin) | 30–50 g | energy + SGLT1 Na cotransport |
| Table salt (NaCl) | 1.0–1.5 g | 400–600 mg sodium |
| Lite salt / NoSalt (KCl) | 0.5 g | ~260 mg potassium |
| Lemon/lime juice | ½ fruit | citrate buffer + palatability |

Total volume target = **150% of mass lost** (Shirreffs/Maughan consensus). Paced ≤1L/hr first 2h, ≤800mL/hr thereafter.

Commercial equivalents to namecheck: LMNT (1000mg Na), Liquid I.V. (500mg Na), DripDrop (330mg Na), Pedialyte (1035mg Na/L — closest to true WHO ORS).

Sources: WHO/UNICEF (2006) ORS spec; Shirreffs &amp; Maughan (2000) Exerc Sport Sci Rev; Hunt et al. (1992) Gut.

### 6.3 Hour-by-hour rehydration (24h gap, 80kg athlete, 5kg cut)

| Window | Fluid | Carbs | Protein | Sodium |
|---|---|---|---|---|
| H+0 to H+4 | 2.0–2.5 L ORS | 320–400g high-GI | 30g | ~4,000 mg (1000 mg/hr) |
| H+4 to H+12 | 2.0–2.5 L + meals | 2 meals: rice+protein, low-fibre veg | 60g | ~3,500 mg (450 mg/hr) |
| H+12 to H+20 | 1.5–2.0 L | breakfast OK, reintroduce fibre | 30g | ~2,000 mg (300 mg/hr) |
| H+20 to H+24 | 1.0 L sips | light pre-fight meal 3-4h pre-walkout | — | ~800 mg |

Sources: Burke et al. (2017) J Appl Physiol; Jeukendrup (2014) Sports Med; Maughan & Leiper (1995) Eur J Appl Physiol; Shirreffs et al. (1996) MSSE.

### 6.4 Hard safety thresholds

| Trigger | Severity | Action |
|---|---|---|
| `cutDepthPct > 8` | critical | Force gradual approach, prominent warning |
| `cutDepthPct > 5 && daysToWeighIn < 3` | critical | Warn "aggressive timeline" |
| First-time cutter + `cutDepthPct > 5` | critical | Force gradual, advise coach supervision |
| `historicalReboundPct > 10` | warn | "Prior cuts indicate high physiological cost" |
| `avgSleepHours7d < 6.5` | warn | "Sleep debt reduces cut tolerance" |
| `recoveryReadinessToday < 40` | warn | "Low readiness — consider deload before cut" |
| Female + `cutDepthPct > 7` | warn | "Female athletes have tighter margin" |

Abort triggers communicated to athlete:
- Orthostatic hypotension (dizziness on standing)
- Mental confusion / disorientation
- Resting HR >100 bpm lying down
- Dark brown/red urine
- Chest pain / palpitations
- Vomiting that prevents fluid intake
- Syncope / fainting

Sources: Burke, Slater, Reale et al. (2017) BJSM consensus; UFC PI Performance Reports Vol 1 & 2; Brechney et al. (2023) JISSN (female fighters).

### 6.5 Flagged uncertain values (will not invent)

Per the research agent's flags, these are practitioner convention not peer-reviewed:
- Specific mg/day sodium targets across the week (numbers above are practitioner-convention only)
- Day-by-day water loading volumes if not scaled by mL/kg
- Magnesium citrate "safe" doses (none exist in literature)
- "Stannard 2014" combat-sport rehydration citation — could not be confirmed, will NOT be cited

The AI prompt explicitly says: *"When uncertain, output 'this is practitioner convention, not established by peer-reviewed research — consult your nutrition coach.'"*

---

## 7. UI — single-scroll, 13 sections

### 7.1 Vertical scroll order

| # | Section | Visibility |
|---|---|---|
| 1 | `ProtocolHeader` (title, cut-depth pill, countdown) | Always |
| 2 | `TodaysActionHero` (phase-aware: prep / cut / weigh-in / refeed / pre-fight) | Always |
| 3 | `SafetyWarningBanner` | Conditional on warnings present |
| 4 | `InputsUsedChips` ("Tuned to your X, Y, Z") | Always |
| 5 | `CutApproachSelector` (gradual / standard / aggressive) | Always; disabled at `daysToWeighIn ≤ 2` |
| 6 | `FightPlanSection` (day cards T-N → T-0) | Days 1-2 free; rest = `LockedDayCard` for free |
| 7 | `WeightLossBreakdownChart` | Always (educational) |
| 8 | `WeighInDaySpotlight` | Pro only |
| 9 | Section divider "After the scale" | Always |
| 10 | `OrsRecipeCard` | Pro only |
| 11 | `RehydrationTimeline` (hour-by-hour) | Pro only, time-anchored after weigh-in logged |
| 12 | `DoNotCallouts` | Always |
| 13 | `FeelChecksList` (checkboxes write to Convex) | Always |
| + | `ProtocolRegenerateButton` footer | Always |
| + | `BackToTopFAB` (after 2 viewports scrolled) | Always |

### 7.2 Three states the page handles

**A. Free user, T-6 days, moderate 4.2% cut:** Days T-6 and T-5 visible; T-4 through T-0 collapsed into one `LockedDayCard` with "Upgrade to Pro to unlock 5 days." Rehydration section visible-but-locked. ORS recipe card locked.

**B. Pro user, T-3 days, heavy 6.5% cut, aggressive approach:** Safety warning banner shown (amber). Today card highlighted with red top-stripe. Past days collapsed to ✓. Weigh-in day spotlight visible. Rehydration timeline visible with "available after weigh-in" placeholder.

**C. Pro user, post weigh-in, H+3 of 18h gap:** Fight plan collapsed to a single ✓ row. Rehydration timeline fully expanded. Current hour (H+3) auto-expanded with pulsing "you are here" marker. Past hours ticked, future hours collapsed to one-line summary.

### 7.3 Components (new directory `src/components/protocol/`)

| File | Purpose |
|---|---|
| `ProtocolHeader.tsx` | Title, cut-depth pill, countdown chip |
| `TodaysActionHero.tsx` | Phase-aware "what now" card with tier-colored top stripe + optional breath-pulse |
| `SafetyWarningBanner.tsx` | Amber/red banner with expandable detail |
| `InputsUsedChips.tsx` | Horizontal scrollable chip row |
| `CutApproachSelector.tsx` | 3-way segmented control with haptic feedback |
| `FightPlanDayCard.tsx` | Per-day card with metric pills, today-highlight, past-collapse |
| `LockedDayCard.tsx` | Frosted preview collapsing 5 days into one locked card |
| `WeightLossBreakdownChart.tsx` | Horizontal stacked bars: glycogen / water / gut / sauna |
| `WeighInDaySpotlight.tsx` | Large hero for D-0 with morning timeline |
| `OrsRecipeCard.tsx` | Recipe-card layout (ingredient · amount · role) |
| `RehydrationHourRow.tsx` | Single hour row with past/current/future states + pulsing marker |
| `RehydrationTimelinePlaceholder.tsx` | "Available after weigh-in" pre-weigh-in card |
| `DoNotCallouts.tsx` | Stark dark card with bullet warnings |
| `FeelChecksList.tsx` | Checklist writing to Convex `protocol_feel_checks` |
| `ProtocolRegenerateButton.tsx` | Inline button with daily-limit text + loading state |
| `BackToTopFAB.tsx` | Floating button after 2 viewports |
| `ProtocolSectionDivider.tsx` | Chapter break label |
| `ProtocolPageSkeleton.tsx` | Loading state matching real page structure |
| `NoFightCampEmptyState.tsx` | CTA card routing to `/fight-camps` |
| `ProtocolGenerationError.tsx` | Error card with retry |

`src/pages/WeightProtocol.tsx` — page assembly, target <350 lines.

### 7.4 Motion / micro-interactions

- `TodaysActionHero`: mount fade-slide; breath-pulse (1.0→1.012→1.0, 3.4s loop) on weigh-in day or current rehydration hour
- `FightPlanDayCard`: stagger fade-in (60ms each, max 8 staggered); today card has tier-colored top stripe
- `LockedDayCard`: slow backdrop-filter blur ramp on mount (feels locked, not blurred)
- `WeightLossBreakdownChart`: bars animate 0% → final width, 700ms ease-out-cubic; re-animates on approach change
- `RehydrationHourRow` (current): persistent soft pulse on leading dot + 1px ring expanding outward
- `CutApproachSelector`: `triggerHapticSelection()` on change; pill slides with `motion/react` `layoutId`
- `FeelChecksList`: optimistic UI on tap, haptic on tick
- All motion respects `prefers-reduced-motion`

### 7.5 Empty / loading / error states

- **No active fight camp:** `NoFightCampEmptyState` → routes to `/fight-camps`
- **Loading:** `ProtocolPageSkeleton` mirrors real page shape (4 day-card shimmers, breakdown shimmer, hero shimmer)
- **Generating:** AI in flight — `TodaysActionHero` body becomes step shimmer ("Analyzing inputs → Computing breakdown → Drafting day plan → Tuning rehydration"), other sections become skeletons
- **Generation failed:** `ProtocolGenerationError` with retry + "use last good plan" fallback (reads `AIPersistence` cache)
- **Pro user post-weigh-in, no scale weight logged:** `TodaysActionHero` becomes "Log your weigh-in weight" numeric input sheet

---

## 8. Files matrix

### 8.1 New files

| Path | Purpose |
|---|---|
| `src/pages/WeightProtocol.tsx` | Page assembly |
| `src/components/protocol/*` | 20 components (see §7.3) |
| `convex/_shared/weightProtocolMath.ts` | Derived metrics, safety, skeletons |
| `convex/_shared/protocolResearch.ts` | Research brief context for AI prompt |
| `convex/_shared/aiSchemas.ts` (additions) | `FightPlanSchema`, `RehydrationProtocolSchema` |
| `convex/weight_protocols_internal.ts` | `gatherInputs`, `upsert`, `maybeRegen` |
| `convex/actions/generateFightPlan.ts` | Fight plan AI action |
| `convex/actions/generateRehydrationProtocol.ts` | Rehydration AI action (replaces old) |
| `convex/weightProtocols.ts` | Reactive queries (`getCurrentForUser`, etc.) |

### 8.2 Modified files

| Path | Change |
|---|---|
| `convex/schema.ts` | Add `weight_protocols` table; add `protocol_feel_checks` table |
| `convex/_shared/featureGates.ts` | Add `AI_WEIGHT_PROTOCOL` key |
| `convex/weight_logs.ts` (or equivalent) | Post-write trigger calls `maybeRegen` |
| `convex/crons.ts` | No additions in v1 (auto-regen is event-driven) |
| `src/App.tsx` | Add `/weight-protocol` route; add 301-style redirects from `/fight-week` and `/hydration` |
| `src/components/BottomNav.tsx` and `AppSidebar.tsx` | Replace FightWeek/Hydration nav entries with single "Weight Protocol" entry |

### 8.3 Deleted files

| Path | Reason |
|---|---|
| `src/pages/FightWeek.tsx` | Replaced by `WeightProtocol.tsx` |
| `src/pages/Hydration.tsx` | Replaced by `WeightProtocol.tsx` |
| `src/components/fight-week/*` (9 files: DayTimelineCard, DehydrationRingPanel, DehydrationTacticsCard, ManipulationCard, PostWeighInCard, ProjectionChart, WaterLoadingCard, WeightCutBreakdownCard) | Folded into new `protocol/` components |
| `src/components/fightweek/*` (2 files: FightWeekSkeleton, InputsUsedChipRow) | Replaced by `ProtocolPageSkeleton` + `InputsUsedChips` |
| `src/components/hydration/*` (2 files: HydrationSkeleton, InputsUsedChipRow) | Folded into new `protocol/` components |
| `convex/actions/rehydrationProtocol.ts` | Replaced by `generateRehydrationProtocol.ts` |
| `convex/actions/generateCutPlan.ts` | Replaced by `generateFightPlan.ts` |
| `convex/actions/generateWeightPlan.ts` | Replaced by `generateFightPlan.ts` (broader scope) |

**Note on `WeightCut.tsx` and `CutPlanReview.tsx`:** Per the user's earlier scoping answer, these are kept. They handle the wider weight journey (long-term weight management); `/weight-protocol` is specifically for fight-week.

---

## 9. Pro gating model

| Surface | Free | Pro |
|---|---|---|
| Today's action hero | ✅ Full | ✅ Full |
| Cut depth + countdown + safety warnings | ✅ Full | ✅ Full |
| Inputs chips + approach selector | ✅ Full | ✅ Full |
| Fight plan days T-N and T-(N-1) | ✅ Visible | ✅ Visible |
| Fight plan days T-(N-2) through T-0 | 🔒 `LockedDayCard` (visible but blurred + upgrade CTA) | ✅ Full |
| Weight-loss breakdown chart | ✅ Always educational | ✅ Full |
| Weigh-in day spotlight | 🔒 | ✅ |
| ORS recipe card | 🔒 | ✅ |
| Hour-by-hour rehydration timeline | 🔒 | ✅ |
| Do-Not callouts (safety) | ✅ Always | ✅ Always |
| Feel checks | ✅ Always | ✅ Always |
| Regenerate button | — | ✅ 1×/day per kind |

Free user CTA copy: `"Unlock the full protocol — 5 days + weigh-in plan + rehydration timeline"`.

---

## 10. Routing & migration

### 10.1 New route

`src/App.tsx` adds `<Route path="/weight-protocol" element={<WeightProtocol />} />` (lazy-loaded per project convention).

### 10.2 Old routes

Old `/fight-week` and `/hydration` routes:
```tsx
<Route path="/fight-week" element={<Navigate to="/weight-protocol" replace />} />
<Route path="/hydration" element={<Navigate to="/weight-protocol" replace />} />
```

### 10.3 Nav update

`BottomNav.tsx` and `AppSidebar.tsx`: collapse the two icons into one labeled "Weight Protocol" pointing at `/weight-protocol`.

### 10.4 Data migration

None required. Old `fight_week_logs` table contents are preserved (out of scope to delete). New `weight_protocols` table is additive. No schema changes to existing tables beyond the new feature-gate key.

### 10.5 No backfill

Existing fight camps without a weight_protocol row simply show the empty state until the user taps "Generate plan."

---

## 11. Build phases

### Phase 1 — Algorithm + data layer (5 tasks)
1. `convex/_shared/weightProtocolMath.ts` — derived metrics + safety + skeletons
2. `convex/_shared/protocolResearch.ts` — research brief as TS exported strings
3. `convex/_shared/aiSchemas.ts` additions — Zod schemas
4. `convex/schema.ts` additions — `weight_protocols` + `protocol_feel_checks` tables
5. `convex/weight_protocols_internal.ts` — gatherInputs + upsert + maybeRegen

### Phase 2 — AI actions (3 tasks)
6. `convex/actions/generateFightPlan.ts`
7. `convex/actions/generateRehydrationProtocol.ts`
8. Weight-log post-write hook for auto-regen on drift

### Phase 3 — Components (10 tasks)
9. `ProtocolHeader` + `InputsUsedChips` + `CutApproachSelector`
10. `TodaysActionHero` + `SafetyWarningBanner`
11. `FightPlanDayCard` + `LockedDayCard`
12. `WeightLossBreakdownChart`
13. `WeighInDaySpotlight`
14. `OrsRecipeCard`
15. `RehydrationHourRow` + `RehydrationTimelinePlaceholder`
16. `DoNotCallouts` + `FeelChecksList`
17. `ProtocolRegenerateButton` + `BackToTopFAB` + `ProtocolSectionDivider`
18. `ProtocolPageSkeleton` + `NoFightCampEmptyState` + `ProtocolGenerationError`

### Phase 4 — Page assembly + routing (3 tasks)
19. `convex/weightProtocols.ts` — reactive queries (`getCurrentForUser` etc.)
20. `src/pages/WeightProtocol.tsx` — assembly
21. Routing + nav update + delete old pages + redirects

### Phase 5 — Tests + final integration review (2 tasks)
22. Unit tests for `weightProtocolMath` (derived, safety, skeletons)
23. Final integration review (build, typecheck, vitest, codegen audit, mount audit, file-existence audit, deferred follow-ups)

**Estimated 23 implementer subagent dispatches**, mirroring the recovery redesign cadence.

---

## 12. Cost analysis

Per protocol generation (Claude Opus 4.7, OpenRouter, $15/M in, $75/M out):

| Call | Input tokens | Output tokens | Cost |
|---|---|---|---|
| Fight Plan | ~6,000 | ~2,000 | $0.09 + $0.15 = **$0.24** |
| Rehydration | ~4,000 | ~1,500 | $0.06 + $0.11 = **$0.18** |
| **Per camp first-gen** | | | **$0.42** |
| Manual regen (1/avg-camp) | | | +$0.42 |
| Auto-regen (1/avg-camp) | | | +$0.24 |
| **Per camp lifecycle** | | | **~$1.08** |

Scenario: 300 in-camp Pros at any time, 8-week camps → ~1,950 camps/year. **Annual Opus spend ≈ $2,100 (~$175/mo)**.

Worst-case heavy user (1 regen/day for 7 days) → +$1.92/camp ceiling → annual ceiling ~$5.8k/year.

Fallback to Groq (`openai/gpt-oss-120b` → `qwen/qwen3-235b-a22b-2507` via OpenRouter map at $0.071/$0.100) drops costs ~99% if Opus unavailable.

---

## 13. Risks & open questions

1. **Opus pricing.** Per-camp cost is small but per-app-wide could grow if Pro user count grows fast. Mitigations baked in: 1×/day manual cap + drift threshold on auto-regen + post-weigh-in freeze + provider fallback. Worth monitoring `ai_decisions` log monthly.

2. **The AI drifting on numerics.** Mitigated by deterministic skeleton + post-parse numerics replacement, but worth a spot-check on production output to confirm.

3. **Legal liability for safety warnings.** The app is now generating specific weight-cut protocols. Even with deterministic warnings + "consult a coach" language, this carries risk. Should be reviewed by legal counsel before launch. The spec assumes app-wide disclaimer covers this; flag if not.

4. **Fight camp without weigh-in time.** Schema's `fight_camps` table may have a date but no time-of-day. If `weighInTime` is missing, default to 11:00 local. UI exposes a "set weigh-in time" CTA in the empty state.

5. **Time-zone handling.** All hour calculations use UTC server-side; UI renders in user-local TZ. Capacitor on iOS provides device TZ; web uses `Intl.DateTimeFormat().resolvedOptions().timeZone`. The weighInToFightHours math is TZ-agnostic (uses absolute timestamps), so display-only concern.

6. **First-time users with no prior camps.** `historicalReboundKg` is null → AI must not invent. Prompt explicitly handles "If no prior cuts, assume average rebound for cut depth."

7. **The "WeightCut" and "CutPlanReview" pages stay live.** They handle long-term weight journey. Risk of user confusion — two related concepts. Mitigation: Today's-action hero on `/weight-protocol` links to `WeightCut` for "long-term context," and `WeightCut` adds a "Fight week protocol →" CTA pointing to `/weight-protocol` once a fight camp is active.

8. **`generateCutPlan.ts` and `generateWeightPlan.ts` deletion.** Need to verify no other features call these. Quick grep audit before delete.

9. **`fight_week_logs` table.** Currently used by `Fight Week` page logging. Pending decision: leave it alone (read-only data) or migrate to `protocol_feel_checks`. Default: leave alone, deprecate writes.

10. **Sex-specific cycle phase.** Female luteal-phase fluid retention (1-2kg) is a real concern. v1 does not ask the user for cycle date; AI prompt adds general female-athlete caveat. Cycle-phase input is a v2 feature.

---

## 14. Out of scope (explicit)

- Cycle-phase tracking for female athletes
- Coach/medical-professional view
- Multi-fighter (gym) views
- IV / supplement protocols beyond caffeine
- Notifications / push alerts for protocol milestones
- Voice-input for feel checks
- Apple Watch / wearable integration
- Auto-detection of weight class (user supplies target weight)
- Food database integration
- Recipe generation beyond ORS
- Pre-camp weight cut planning (this is fight-week only)

---

## 15. Follow-ups for the implementation plan

When this spec is approved:
- Define exact unit-test surface for `weightProtocolMath` (each formula, each safety trigger, each skeleton edge case)
- Spell out the AI prompt fixture content for both protocols
- Define exact lock-card copy + paywall handoff
- Spell out the day-card animation timing values
- Decide on the inline `protocol_feel_checks` table schema (likely `{userId, campId, kind, checkedAt}`)
- Define error-recovery behaviour when Opus times out (fallback to Groq immediately? Show error?)
- Map every retired component to its successor or deletion
