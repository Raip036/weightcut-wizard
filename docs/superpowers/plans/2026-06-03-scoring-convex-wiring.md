# Scoring Convex Wiring Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Plan 1 / 1b engine capabilities actually run in production — persist the new score fields, widen the `fight_form_scores` schema so a `"stale"` state and per-pillar `completeness` validate, and feed `priorCeilings` into the engine so ceiling latching (the anti-gaming fix) is live instead of a no-op.

**Architecture:** Three wiring changes in `convex/`. (1) Widen the `fight_form_scores` table validator (additive/optional, no migration). (2) Persist the new engine output fields in `upsertScore`. (3) Build `priorCeilings` in `fetchScoringInputs` from recent stored rows and thread it through `recomputeForUserDate` into `computeFightFormScore`. Per-pillar recency is already carried by the date-bearing input arrays the query returns, so the engine derives it — no new recency field is needed.

**Tech Stack:** Convex (TypeScript), Vitest + `convex-test` (edge-runtime). Touches only `convex/` and its `__tests__/`.

**Project note on commits:** The owner commits manually in GitHub Desktop and has asked tools never run `git commit`. Each "Stage" step runs only `git add`.

**Prereqs:** Plan 1 + Plan 1b are complete in `src/scoring/` (the engine returns `dataConfidence`, `dataAgeDays`, `activePillars`, `totalPillars`, `formMomentum`, can return `state:"stale"`, sub-scores carry optional `completeness`, and consumes `ScoringInputs.priorCeilings`).

**Run tests with:** `npx vitest run convex` (Convex suite) or `npx vitest run convex/__tests__/<file> -t "<name>"`.

---

## Context: current code (verified)

- **Schema** `convex/schema.ts` ~line 384, `fight_form_scores`:
  - `state: v.union(v.literal("ok"), v.literal("calibrating"), v.literal("no_camp"), v.literal("paused"))` — **missing `"stale"`**.
  - `subScores` is `v.object({ trainingLoad: v.object({value,weight,reason}), ... })` — strict, **no `completeness`**. `weightCut` also has `meta` optional; `recovery` is an optional object.
  - `appliedCeiling: v.optional(v.object({ ruleId: v.string(), cap: v.number() }))` — already present.
  - Indexes include `by_user_date` on `["userId","date"]`.
- **`convex/fightFormScore_internal.ts`**:
  - `fetchScoringInputs` (internalQuery) returns the inputs object incl. `priorRawScores` (last 3 days of `fight_form_scores.rawScore`). It does **not** build `priorCeilings`.
  - `upsertScore` (internalMutation) maps `score.*` into the row; does **not** write the new fields.
- **`convex/fightFormScore.ts`** `recomputeForUserDate` (internalAction, ~line 481) builds `scoringInputs` field-by-field and calls `computeFightFormScore(scoringInputs, CURRENT_CONFIG)`, then `upsertScore`. It does **not** pass `priorCeilings`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `convex/schema.ts` | `fight_form_scores` validator | Modify — widen `state`, add `completeness`, add new optional number fields |
| `convex/fightFormScore_internal.ts` | `fetchScoringInputs` (+ `priorCeilings`), `upsertScore` (+ new fields) | Modify |
| `convex/fightFormScore.ts` | `recomputeForUserDate` threads `priorCeilings` | Modify |
| `convex/__tests__/fightFormScore_wiring.test.ts` | convex-test coverage for persist + priorCeilings + latch end-to-end | **Create** |

---

## Task 1: Widen the `fight_form_scores` schema

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add `"stale"` to the `state` union**

In `fight_form_scores`, change the `state` line to:

```ts
    state: v.union(v.literal("ok"), v.literal("calibrating"), v.literal("no_camp"), v.literal("paused"), v.literal("stale")),
```

- [ ] **Step 2: Add `completeness` to every sub-score validator**

Replace the `subScores` object validator with (adds `completeness: v.optional(v.number())` to all six; keeps `weightCut.meta` and `recovery` optional):

```ts
    subScores: v.object({
      trainingLoad:        v.object({ value: v.number(), weight: v.number(), reason: v.string(), completeness: v.optional(v.number()) }),
      sleep:               v.object({ value: v.number(), weight: v.number(), reason: v.string(), completeness: v.optional(v.number()) }),
      weightCut:           v.object({ value: v.number(), weight: v.number(), reason: v.string(), completeness: v.optional(v.number()), meta: v.optional(v.record(v.string(), v.union(v.number(), v.string()))) }),
      wellness:            v.object({ value: v.number(), weight: v.number(), reason: v.string(), completeness: v.optional(v.number()) }),
      nutritionAdherence:  v.object({ value: v.number(), weight: v.number(), reason: v.string(), completeness: v.optional(v.number()) }),
      recovery:            v.optional(v.object({ value: v.number(), weight: v.number(), reason: v.string(), completeness: v.optional(v.number()) })),
    }),
```

- [ ] **Step 3: Add the new optional top-level fields**

Immediately after the `appliedCeiling` line, add:

```ts
    // Plan 1/1b engine outputs. Optional so historical rows (written before
    // these existed) still validate on read; new writes always include them.
    dataConfidence: v.optional(v.number()),
    dataAgeDays: v.optional(v.number()),
    activePillars: v.optional(v.number()),
    totalPillars: v.optional(v.number()),
    formMomentum: v.optional(v.number()),
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i "convex/schema\|fight_form_scores" | head -20`
Expected: no new errors from the schema file. (Convex regenerates types on `npx convex dev`; for the test harness, `convex-test` imports the `schema` object directly, so the validator change takes effect immediately.)

- [ ] **Step 5: Stage**

```bash
git add convex/schema.ts
```

Suggested commit message: `feat(convex): widen fight_form_scores for stale state, completeness, confidence fields`

---

## Task 2: Persist the new engine fields in `upsertScore`

**Files:**
- Modify: `convex/fightFormScore_internal.ts`
- Test: `convex/__tests__/fightFormScore_wiring.test.ts`

- [ ] **Step 1: Write the failing test (create the wiring test file)**

Create `convex/__tests__/fightFormScore_wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

async function seedUser(t: ReturnType<typeof convexTest>): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {} as any);
    await ctx.db.insert("profiles", {
      userId, age: 30, sex: "M", heightCm: 180, currentWeightKg: 80,
      goalWeightKg: 75, targetDate: "2026-12-01", activityLevel: "moderate",
      goalType: "weight_loss", role: "fighter", subscriptionTier: "pro",
    } as any);
    return userId;
  });
}

describe("upsertScore persists Plan 1/1b fields", () => {
  it("writes dataConfidence, formMomentum, stale state, and per-pillar completeness", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";

    const score = {
      score: 70, rawScore: 70, label: "sharpening", state: "stale", phase: "build",
      subScores: {
        trainingLoad:       { value: 80, weight: 0.20, reason: "ok", completeness: 0.5 },
        sleep:              { value: 90, weight: 0.20, reason: "ok", completeness: 1 },
        weightCut:          { value: 75, weight: 0.25, reason: "ok", completeness: 0.8 },
        wellness:           { value: 60, weight: 0.20, reason: "ok", completeness: 0.4 },
        nutritionAdherence: { value: 100, weight: 0.15, reason: "ok", completeness: 1 },
        recovery:           { value: 0, weight: 0, reason: "—", completeness: 0 },
      },
      appliedCeiling: null,
      campAge: null,
      topDriver: "sleep",
      topLimiter: "wellness",
      algorithmVersion: "1.0.0",
      recoveryConfidence: 0,
      dataConfidence: 0.62,
      dataAgeDays: 3,
      activePillars: 5,
      totalPillars: 5,
      formMomentum: 0,
    };

    await t.mutation(internal.fightFormScore_internal.upsertScore, {
      userId, date, campId: undefined, score,
    });

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("fight_form_scores")
        .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date))
        .first(),
    );

    expect(row).not.toBeNull();
    expect(row!.state).toBe("stale");
    expect(row!.dataConfidence).toBeCloseTo(0.62, 5);
    expect(row!.dataAgeDays).toBe(3);
    expect(row!.activePillars).toBe(5);
    expect(row!.totalPillars).toBe(5);
    expect(row!.formMomentum).toBe(0);
    expect(row!.subScores.sleep.completeness).toBe(1);
    expect(row!.subScores.wellness.completeness).toBeCloseTo(0.4, 5);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run convex/__tests__/fightFormScore_wiring.test.ts -t "writes dataConfidence" 2>&1 | tail -30`
Expected: FAIL — either a Convex schema validation error on `state:"stale"`/`completeness` (if Task 1 wasn't applied) OR the read-back fields are `undefined` because `upsertScore` doesn't map them yet. (If you see a validation error, Task 1 is incomplete — fix that first.)

- [ ] **Step 3: Map the new fields in `upsertScore`**

In `convex/fightFormScore_internal.ts`, in the `upsertScore` handler's `row` object, add these fields after `appliedCeiling: score.appliedCeiling ?? undefined,`:

```ts
      dataConfidence: score.dataConfidence,
      dataAgeDays: score.dataAgeDays,
      activePillars: score.activePillars,
      totalPillars: score.totalPillars,
      formMomentum: score.formMomentum,
```

(`score.subScores` already carries `completeness` per pillar straight from the engine — no mapping change needed; Task 1's schema widening lets it persist.)

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run convex/__tests__/fightFormScore_wiring.test.ts -t "writes dataConfidence" 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add convex/fightFormScore_internal.ts convex/__tests__/fightFormScore_wiring.test.ts
```

Suggested commit message: `feat(convex): persist confidence + momentum + completeness on score rows`

---

## Task 3: Build `priorCeilings` in `fetchScoringInputs`

**Files:**
- Modify: `convex/fightFormScore_internal.ts`
- Test: `convex/__tests__/fightFormScore_wiring.test.ts`

`priorCeilings` is the list of recently-applied ceilings (within the latch cooldown window) the engine uses to hold a cap when a pillar goes stale. Build it from stored `fight_form_scores` rows that have an `appliedCeiling`, over the `ceilingCooldownDays` window before the target date.

- [ ] **Step 1: Write the failing test**

Add to `convex/__tests__/fightFormScore_wiring.test.ts` (inside the file, a new describe block):

```ts
describe("fetchScoringInputs builds priorCeilings", () => {
  it("includes recently-applied ceilings within the cooldown window and excludes older ones", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const date = "2026-05-15";

    await t.run(async (ctx) => {
      // 2 days ago: a fired sleep_debt cap → should be included.
      await ctx.db.insert("fight_form_scores", {
        userId, date: "2026-05-13", rawScore: 65, displayedScore: 65,
        label: "sharpening", state: "ok",
        subScores: {
          trainingLoad: { value: 50, weight: 0.25, reason: "x" },
          sleep: { value: 20, weight: 0.25, reason: "x" },
          weightCut: { value: 50, weight: 0.25, reason: "x" },
          wellness: { value: 50, weight: 0.25, reason: "x" },
          nutritionAdherence: { value: 0, weight: 0, reason: "x" },
        },
        appliedCeiling: { ruleId: "sleep_debt", cap: 65 },
        topDriver: "trainingLoad", topLimiter: "sleep",
        algorithmVersion: "1.0.0", computedAt: Date.now(),
      } as any);
      // 10 days ago: outside the 5-day cooldown → should be excluded.
      await ctx.db.insert("fight_form_scores", {
        userId, date: "2026-05-05", rawScore: 60, displayedScore: 60,
        label: "sharpening", state: "ok",
        subScores: {
          trainingLoad: { value: 50, weight: 0.25, reason: "x" },
          sleep: { value: 50, weight: 0.25, reason: "x" },
          weightCut: { value: 50, weight: 0.25, reason: "x" },
          wellness: { value: 50, weight: 0.25, reason: "x" },
          nutritionAdherence: { value: 0, weight: 0, reason: "x" },
        },
        appliedCeiling: { ruleId: "training_spike", cap: 60 },
        topDriver: "trainingLoad", topLimiter: "sleep",
        algorithmVersion: "1.0.0", computedAt: Date.now(),
      } as any);
    });

    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, { userId, date });

    expect(inputs.priorCeilings).toBeDefined();
    const rules = inputs.priorCeilings!.map((c) => c.ruleId);
    expect(rules).toContain("sleep_debt");          // 2 days ago, within cooldown
    expect(rules).not.toContain("training_spike");  // 10 days ago, excluded
    const sd = inputs.priorCeilings!.find((c) => c.ruleId === "sleep_debt");
    expect(sd).toEqual({ date: "2026-05-13", ruleId: "sleep_debt", cap: 65 });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run convex/__tests__/fightFormScore_wiring.test.ts -t "builds priorCeilings" 2>&1 | tail -25`
Expected: FAIL — `inputs.priorCeilings` is `undefined`.

- [ ] **Step 3: Implement the `priorCeilings` query + return field**

In `convex/fightFormScore_internal.ts`, find the existing "Prior raw scores for EMA" block (around the `priorRaw` query). Immediately AFTER that block, add a ceiling-history query keyed off the latch cooldown:

```ts
    // Prior ceilings for latching: any fired safety cap within the latch
    // cooldown window before the target date. The engine holds such a cap
    // when its governing pillar is stale (anti-gaming), and releases it only
    // when fresh data clears the rule. Row `date` IS the fired date.
    const ceilLookback = new Date(end);
    ceilLookback.setUTCDate(ceilLookback.getUTCDate() - CURRENT_CONFIG.confidence.ceilingCooldownDays);
    const ceilStart = ceilLookback.toISOString().slice(0, 10);
    const priorBeforeToday = new Date(end);
    priorBeforeToday.setUTCDate(priorBeforeToday.getUTCDate() - 1);
    const ceilEnd = priorBeforeToday.toISOString().slice(0, 10);
    const priorCeilingRows = await ctx.db
      .query("fight_form_scores")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", userId).gte("date", ceilStart).lte("date", ceilEnd),
      )
      .collect();
    const priorCeilings = priorCeilingRows
      .filter((r) => r.appliedCeiling != null)
      .map((r) => ({ date: r.date, ruleId: r.appliedCeiling!.ruleId, cap: r.appliedCeiling!.cap }));
```

(`CURRENT_CONFIG` is already imported in this file — it's used by the assumed-sleep rescue. `end` is the target-date `Date` already defined for the prior-raw window.)

- [ ] **Step 4: Add `priorCeilings` to the returned object**

In the big `return { ... }` of `fetchScoringInputs`, add after `priorRawScores: priorRaw.map(...)`:

```ts
      priorCeilings,
```

- [ ] **Step 5: Run the test — expect PASS, then the whole convex suite**

Run: `npx vitest run convex/__tests__/fightFormScore_wiring.test.ts -t "builds priorCeilings" 2>&1 | tail -20` (expect PASS).
Run: `npx vitest run convex 2>&1 | tail -15` (expect all pass — the existing `fetchScoringInputs` HealthKit tests are unaffected; they don't assert on `priorCeilings`).

- [ ] **Step 6: Stage**

```bash
git add convex/fightFormScore_internal.ts convex/__tests__/fightFormScore_wiring.test.ts
```

Suggested commit message: `feat(convex): build priorCeilings from recent rows for ceiling latching`

---

## Task 4: Thread `priorCeilings` through `recomputeForUserDate`

**Files:**
- Modify: `convex/fightFormScore.ts`
- Test: `convex/__tests__/fightFormScore_wiring.test.ts`

- [ ] **Step 1: Write the failing end-to-end latch test**

Add to `convex/__tests__/fightFormScore_wiring.test.ts`:

```ts
describe("ceiling latching runs end-to-end through recompute", () => {
  it("holds a fired sleep_debt cap when the user stops logging sleep", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    await t.run(async (ctx) => {
      // Camp start: a weight log a few weeks back so the camp is 'active'.
      await ctx.db.insert("weight_logs", { userId, date: "2026-04-20", weightKg: 80 } as any);
      await ctx.db.insert("weight_logs", { userId, date: "2026-05-13", weightKg: 78 } as any);
      // Sleep last logged 6 days before the target (2026-05-15) → stale beyond
      // grace, and out of the live 7-day sleep-debt window.
      await ctx.db.insert("sleep_logs", { userId, date: "2026-05-09", hours: 8 } as any);
      // Yesterday a sleep_debt ceiling fired and was stored.
      await ctx.db.insert("fight_form_scores", {
        userId, date: "2026-05-14", rawScore: 65, displayedScore: 65,
        label: "sharpening", state: "ok",
        subScores: {
          trainingLoad: { value: 50, weight: 0.25, reason: "x" },
          sleep: { value: 10, weight: 0.25, reason: "x" },
          weightCut: { value: 50, weight: 0.25, reason: "x" },
          wellness: { value: 50, weight: 0.25, reason: "x" },
          nutritionAdherence: { value: 0, weight: 0, reason: "x" },
        },
        appliedCeiling: { ruleId: "sleep_debt", cap: 65 },
        topDriver: "trainingLoad", topLimiter: "sleep",
        algorithmVersion: "1.0.0", computedAt: Date.now(),
      } as any);
    });

    await t.action(internal.fightFormScore.recomputeForUserDate, { userId, date: "2026-05-15" });

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("fight_form_scores")
        .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", "2026-05-15"))
        .first(),
    );
    expect(row).not.toBeNull();
    // The live sleep-debt rule can't fire (no recent sleep logs), but the
    // latch must hold the cap because the sleep pillar is stale.
    expect(row!.appliedCeiling?.ruleId).toBe("sleep_debt");
    expect(row!.rawScore).toBeLessThanOrEqual(65);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run convex/__tests__/fightFormScore_wiring.test.ts -t "holds a fired sleep_debt cap" 2>&1 | tail -25`
Expected: FAIL — without `priorCeilings` threaded in, the latch never engages and `appliedCeiling` is null (live rule doesn't fire on stale data).

- [ ] **Step 3: Thread `priorCeilings` into `scoringInputs`**

In `convex/fightFormScore.ts` `recomputeForUserDate`, in the `scoringInputs` object, add after `priorRawScores: inputs.priorRawScores,`:

```ts
      // Recently-applied ceilings, used by the engine to latch a fired safety
      // cap while its governing pillar is stale (anti-gaming).
      priorCeilings: inputs.priorCeilings,
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run convex/__tests__/fightFormScore_wiring.test.ts -t "holds a fired sleep_debt cap" 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add convex/fightFormScore.ts convex/__tests__/fightFormScore_wiring.test.ts
```

Suggested commit message: `feat(convex): feed priorCeilings into recompute so latching runs in prod`

---

## Task 5: Full verification + downstream `state` check

**Files:** none (verification only; may surface a follow-up)

- [ ] **Step 1: Whole suite**

Run: `npx vitest run 2>&1 | tail -20`
Expected: all pass (scoring + convex). Report counts.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -40`
Expected: no NEW errors introduced by this plan. Adding `"stale"` to the schema `state` union widens the generated row type — if any consumer does an EXHAUSTIVE `switch`/comparison on a `fight_form_scores.state` value, tsc may now flag a missing case. Run:

`grep -rn "\.state" src --include=*.ts --include=*.tsx | grep -i "fight\|formScore\|ring" | head -30`

If a consumer breaks on the widened union, note it. Do NOT hack the schema back — handling the `"stale"` state in the UI is part of the ring-transparency UI plan (Plan 4); a follow-up note here is sufficient unless the break blocks the build.

- [ ] **Step 3: Stage any final cleanup; report**

Report: full-suite counts, tsc result, and any `state`-exhaustiveness consumers found (for Plan 4 to handle).

---

## Self-Review

**Spec coverage (design doc §1.2, §1.3, §2.4 wiring):**
- §1.3 persist ceiling history → stored via existing `appliedCeiling`; `priorCeilings` derived from row `date` + `appliedCeiling` (no separate `ceilingFiredAt` column needed — Task 3). ✓
- §1.3 persist new score fields → Task 1 (schema) + Task 2 (`upsertScore`). ✓
- §1.2 per-pillar recency → already carried by the date-bearing input arrays; engine derives it. No new field. (Documented deviation — simpler than the spec's "thread lastDataDate".) ✓
- §2.4 ceiling latching live → Task 3 (build `priorCeilings`) + Task 4 (thread into `computeFightFormScore`). ✓
- `"stale"` state + `completeness` persistable → Task 1. ✓

**Out of scope (later plans):** `marked_skips` table + rest/skip semantics (Plan 3); rendering `"stale"`/confidence/completeness in the ring (Plan 4).

**Placeholder scan:** none.

**Type/contract consistency:** `upsertScore` takes `score: v.any()`, so new fields pass through without an args-validator change; the schema (Task 1) is what validates the written row. `priorCeilings` shape `{date,ruleId,cap}` matches `ScoringInputs.priorCeilings` (Plan 1) and the engine's `latchCeilings` consumption. The `fetchScoringInputs` ceiling window uses `CURRENT_CONFIG.confidence.ceilingCooldownDays` (5), matching the engine's latch cooldown.

**Risk:** widening the schema `state` union can surface a tsc exhaustiveness break in a frontend consumer — Task 5 step 2 checks for it and defers UI handling to Plan 4.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-03-scoring-convex-wiring.md`. Execute via subagent-driven-development (fresh subagent per task, spec + quality review between). Implementers stage only — owner commits. Note: `convex-test` actions (Task 4) exercise the real `recomputeForUserDate` path end-to-end.
