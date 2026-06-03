# Scoring Consistency & Reward Implementation Plan (Plan 1b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sustained ideal behavior visibly pay off — give the nutrition pillar a real weight so logging meals on-target raises the score, and add an un-gameable consistency ("form momentum") bonus so a user who stays excellent across all pillars day after day scores higher than one who just had a good day.

**Architecture:** Two additive changes to the pure scoring engine (`src/scoring/*`). (A) Non-zero `nutritionAdherence` phase weights in config — no code change, the composite already redistributes by present weight. (B) A new pure `formMomentum` term computed after the raw composite and before ceilings, gated on all-pillars-fresh + sustained recent raw scores, exposed as a new `FightFormScore.formMomentum` field. Both compose with the staleness/confidence/ceiling-latching work from Plan 1: the bonus is applied *before* `applyCeilings`/latching, so safety caps still override it.

**Tech Stack:** TypeScript, Vitest. Touches only `src/scoring/` and its `__tests__/`.

**Project note on commits:** This project's owner commits manually in GitHub Desktop and has asked that automated tools never run `git commit`. Each "Stage" step runs only `git add`; the owner commits.

**Run tests with:** `npx vitest run src/scoring` (whole suite) or `... -t "<name>"` (single).

**Prereq:** Plan 1 (`2026-06-03-scoring-engine-foundation.md`) is complete — `dataConfidence`, `activePillars`, `totalPillars`, staleness decay, and ceiling latching exist in `compose.ts`.

---

## Tunable product numbers (defaults chosen; easy to adjust in `config/v1.ts`)

**Nutrition phase weights** (each phase sums to 1.0 with the other active pillars; recovery still takes the wellness slot 1:1 when HealthKit is present, so it is unaffected):

| Phase | trainingLoad | sleep | weightCut | wellness | nutritionAdherence |
|-------|---|---|---|---|---|
| build | 0.20 | 0.20 | 0.25 | 0.20 | 0.15 |
| peak | 0.20 | 0.20 | 0.25 | 0.20 | 0.15 |
| fightWeek | 0.15 | 0.25 | 0.30 | 0.15 | 0.15 |

**Consistency bonus:** `maxBonus: 5`, `lookbackDays: 5`, `minRawForBonus: 75`, `fullBonusMean: 92`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/scoring/config/v1.ts` | Concrete weights + new `consistency` block | Modify |
| `src/scoring/types.ts` | `consistency` on `ScoringConfig`; `formMomentum` on `FightFormScore` | Modify |
| `src/scoring/consistency.ts` | Pure `computeFormMomentum` | **Create** |
| `src/scoring/compose.ts` | Wire momentum bonus before ceilings; populate `formMomentum` | Modify |
| `src/scoring/__tests__/consistency.test.ts` | Unit tests for the momentum math | **Create** |
| `src/scoring/__tests__/compose.test.ts` | Update the obsolete "nutrition weight 0" test; add integration tests | Modify |

---

## Task 1: Give nutrition a real phase weight

**Files:**
- Modify: `src/scoring/config/v1.ts`
- Test: `src/scoring/__tests__/compose.test.ts`

- [ ] **Step 1: Update the weights in `config/v1.ts`**

Replace the existing `weights` block (currently all four phases have `nutritionAdherence: 0` and the four others at `0.25`) with:

```ts
  weights: {
    build:     { trainingLoad: 0.20, sleep: 0.20, weightCut: 0.25, wellness: 0.20, nutritionAdherence: 0.15, recovery: 0 },
    peak:      { trainingLoad: 0.20, sleep: 0.20, weightCut: 0.25, wellness: 0.20, nutritionAdherence: 0.15, recovery: 0 },
    fightWeek: { trainingLoad: 0.15, sleep: 0.25, weightCut: 0.30, wellness: 0.15, nutritionAdherence: 0.15, recovery: 0 },
  },
```

- [ ] **Step 2: Replace the obsolete "Nutrition weight = 0" test**

The existing describe block `"Nutrition weight = 0 across all phases"` in `src/scoring/__tests__/compose.test.ts` asserts that changing meals does NOT move the score. That is now intentionally false. REPLACE that entire describe block with:

```ts
  describe("Nutrition now contributes to the composite", () => {
    it("nutritionAdherence carries a non-zero weight when meals are logged", () => {
      const r = computeFightFormScore(baseInputs(), ScoringConfigV1);
      expect(r.subScores.nutritionAdherence.weight).toBeGreaterThan(0);
    });

    it("severely off-target eating lowers the composite vs on-target", () => {
      const onTarget = computeFightFormScore(baseInputs(), ScoringConfigV1);
      const badMeals = Array.from({ length: 7 }, (_, i) => {
        const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
        return { date: d.toISOString().slice(0, 10), calories: 1200, proteinG: 50 };
      });
      const offTarget = computeFightFormScore(baseInputs({ meals: badMeals }), ScoringConfigV1);
      expect(offTarget.rawScore).toBeLessThan(onTarget.rawScore);
    });
  });
```

- [ ] **Step 3: Run those tests**

Run: `npx vitest run src/scoring/__tests__/compose.test.ts -t "Nutrition now contributes" 2>&1 | tail -20`
Expected: both PASS. (On-target meals → nutrition ~100 present at weight 0.15; 1200 kcal vs 2500 target = 52% drift → day score 0 → nutrition ~0, dragging the composite down.)

- [ ] **Step 4: Run the full suite and reconcile any threshold drift**

Run: `npx vitest run src/scoring 2>&1 | tail -20`
Expected: ALL pass. The base fixture's pillars are all ~100, so adding nutrition (also ~100) and reshuffling weights keeps the composite ~96–100 — threshold tests (`>= 85`, `>= 95`) still hold.
If a test fails on a numeric threshold: read it, confirm the new value is *correct* given nutrition now counts (don't force it), and update the threshold to the right value with a comment explaining the weight change. Do NOT revert the weights. Report any test you change and why.

- [ ] **Step 5: Typecheck + stage**

Run: `npx tsc --noEmit 2>&1 | grep -i "src/scoring" | head -20` (expect none).

```bash
git add src/scoring/config/v1.ts src/scoring/__tests__/compose.test.ts
```

Suggested commit message: `feat(scoring): give nutrition a real phase weight so on-target eating counts`

---

## Task 2: Add `consistency` config + `formMomentum` output field

**Files:**
- Modify: `src/scoring/types.ts`
- Modify: `src/scoring/config/v1.ts`
- Test: `src/scoring/__tests__/compose.test.ts`

- [ ] **Step 1: Add types to `types.ts`**

Add to `ScoringConfig` (after the `confidence` block added in Plan 1):

```ts
  /**
   * Consistency reward ("form momentum"). A small additive bonus on the raw
   * composite for users who sustain strong, fully-logged performance. Gated so
   * it rewards consistency of GOOD data, not just logging: requires all
   * eligible pillars present AND a strong recent mean. `maxBonus` points,
   * scaled 0→1 as the mean of the last `lookbackDays` raw scores moves from
   * `minRawForBonus` to `fullBonusMean`, multiplied by data confidence.
   */
  consistency: {
    maxBonus: number;
    lookbackDays: number;
    minRawForBonus: number;
    fullBonusMean: number;
  };
```

Add to `FightFormScore` (after `totalPillars` added in Plan 1):

```ts
  /**
   * 0..maxBonus points added to the raw composite this run as a consistency
   * reward (0 when not earned). Surfaced so the UI can show "form building"
   * feedback. Always populated.
   */
  formMomentum: number;
```

- [ ] **Step 2: Add concrete values to `config/v1.ts`**

After the `confidence: { ... }` line:

```ts
  consistency: { maxBonus: 5, lookbackDays: 5, minRawForBonus: 75, fullBonusMean: 92 },
```

- [ ] **Step 3: Add a failing test for the new field**

In `src/scoring/__tests__/compose.test.ts`, add before the final `});`:

```ts
  describe("formMomentum output field", () => {
    it("is 0 for a user without enough history (priorRawScores empty)", () => {
      const r = computeFightFormScore(baseInputs(), ScoringConfigV1);
      expect(r.formMomentum).toBe(0);
    });
  });
```

- [ ] **Step 4: Run it — expect FAIL**

Run: `npx vitest run src/scoring/__tests__/compose.test.ts -t "formMomentum output field" 2>&1 | tail -15`
Expected: FAIL — `formMomentum` is `undefined`. (Implemented in Task 4.)

- [ ] **Step 5: Stage**

```bash
git add src/scoring/types.ts src/scoring/config/v1.ts src/scoring/__tests__/compose.test.ts
```

Suggested commit message: `feat(scoring): add consistency config + formMomentum output type`

---

## Task 3: Pure `computeFormMomentum`

**Files:**
- Create: `src/scoring/consistency.ts`
- Test: `src/scoring/__tests__/consistency.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/scoring/__tests__/consistency.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeFormMomentum } from "../consistency";
import { ScoringConfigV1 } from "../config/v1";

const cfg = ScoringConfigV1; // maxBonus 5, lookbackDays 5, minRawForBonus 75, fullBonusMean 92

describe("computeFormMomentum", () => {
  it("is 0 when fewer than lookbackDays prior scores exist", () => {
    const m = computeFormMomentum({
      priorRawScores: [{ date: "2026-04-30", rawScore: 95 }],
      rawScore: 95, activePillars: 5, totalPillars: 5, dataConfidence: 1, cfg,
    });
    expect(m).toBe(0);
  });

  it("is 0 when not all eligible pillars are present", () => {
    const priors = Array.from({ length: 5 }, (_, i) => ({ date: `2026-04-2${i}`, rawScore: 95 }));
    const m = computeFormMomentum({
      priorRawScores: priors, rawScore: 95, activePillars: 4, totalPillars: 5, dataConfidence: 1, cfg,
    });
    expect(m).toBe(0);
  });

  it("is 0 when today's rawScore is below minRawForBonus", () => {
    const priors = Array.from({ length: 5 }, (_, i) => ({ date: `2026-04-2${i}`, rawScore: 95 }));
    const m = computeFormMomentum({
      priorRawScores: priors, rawScore: 70, activePillars: 5, totalPillars: 5, dataConfidence: 1, cfg,
    });
    expect(m).toBe(0);
  });

  it("scales from 0 at minRawForBonus mean to maxBonus at fullBonusMean", () => {
    const at75 = Array.from({ length: 5 }, (_, i) => ({ date: `2026-04-2${i}`, rawScore: 75 }));
    const at92 = Array.from({ length: 5 }, (_, i) => ({ date: `2026-04-2${i}`, rawScore: 92 }));
    const mLow = computeFormMomentum({ priorRawScores: at75, rawScore: 80, activePillars: 5, totalPillars: 5, dataConfidence: 1, cfg });
    const mHigh = computeFormMomentum({ priorRawScores: at92, rawScore: 95, activePillars: 5, totalPillars: 5, dataConfidence: 1, cfg });
    expect(mLow).toBeCloseTo(0, 5);          // mean 75 → 0 bonus
    expect(mHigh).toBeCloseTo(5, 5);         // mean 92 → full 5
  });

  it("uses only the most recent lookbackDays scores for the mean", () => {
    // 4 ancient terrible + 5 recent great; only the last 5 count.
    const priors = [
      ...Array.from({ length: 4 }, (_, i) => ({ date: `2026-04-0${i + 1}`, rawScore: 10 })),
      ...Array.from({ length: 5 }, (_, i) => ({ date: `2026-04-1${i + 1}`, rawScore: 92 })),
    ];
    const m = computeFormMomentum({ priorRawScores: priors, rawScore: 95, activePillars: 5, totalPillars: 5, dataConfidence: 1, cfg });
    expect(m).toBeCloseTo(5, 5);
  });

  it("is scaled down by low data confidence", () => {
    const priors = Array.from({ length: 5 }, (_, i) => ({ date: `2026-04-2${i}`, rawScore: 92 }));
    const m = computeFormMomentum({ priorRawScores: priors, rawScore: 95, activePillars: 5, totalPillars: 5, dataConfidence: 0.5, cfg });
    expect(m).toBeCloseTo(2.5, 5); // full 5 × 0.5 confidence
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `npx vitest run src/scoring/__tests__/consistency.test.ts`
Expected: FAIL — `Cannot find module '../consistency'`.

- [ ] **Step 3: Implement `consistency.ts`**

Create `src/scoring/consistency.ts`:

```ts
import type { ScoringConfig } from "./types";

export type FormMomentumInputs = {
  priorRawScores: Array<{ date: string; rawScore: number }>;
  rawScore: number;
  activePillars: number;
  totalPillars: number;
  dataConfidence: number;
  cfg: ScoringConfig;
};

/**
 * Consistency reward. Returns 0..maxBonus points for sustained, fully-logged
 * strong performance. Un-gameable by design: requires every eligible pillar
 * present (can't drop a weak pillar), a strong rawScore TODAY, and a strong
 * MEAN over the recent window (a single good day earns nothing). Scaled by
 * dataConfidence so stale data can't generate a bonus.
 */
export function computeFormMomentum(inputs: FormMomentumInputs): number {
  const { priorRawScores, rawScore, activePillars, totalPillars, dataConfidence, cfg } = inputs;
  const c = cfg.consistency;
  if (priorRawScores.length < c.lookbackDays) return 0;
  if (totalPillars <= 0 || activePillars < totalPillars) return 0;
  if (rawScore <= c.minRawForBonus) return 0;

  const recent = [...priorRawScores]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-c.lookbackDays);
  const mean = recent.reduce((a, s) => a + s.rawScore, 0) / recent.length;

  const span = Math.max(1e-9, c.fullBonusMean - c.minRawForBonus);
  const scaled = Math.min(1, Math.max(0, (mean - c.minRawForBonus) / span));
  return scaled * c.maxBonus * Math.min(1, Math.max(0, dataConfidence));
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/scoring/__tests__/consistency.test.ts`
Expected: PASS (all 6).

- [ ] **Step 5: Stage**

```bash
git add src/scoring/consistency.ts src/scoring/__tests__/consistency.test.ts
```

Suggested commit message: `feat(scoring): add pure form-momentum consistency reward with tests`

---

## Task 4: Wire `formMomentum` into the composite

**Files:**
- Modify: `src/scoring/compose.ts`
- Test: `src/scoring/__tests__/compose.test.ts`

The bonus is added to the raw composite BEFORE ceilings, so a latched/active safety cap still overrides it. It is also exposed on the output.

- [ ] **Step 1: Write failing integration tests**

In `src/scoring/__tests__/compose.test.ts`, add before the final `});`:

```ts
  describe("form momentum integration", () => {
    const strongPriors = Array.from({ length: 6 }, (_, i) => {
      const d = new Date("2026-04-30"); d.setDate(d.getDate() - i);
      return { date: d.toISOString().slice(0, 10), rawScore: 92 };
    });

    it("awards a bonus to a sustained, fully-logged strong user", () => {
      const withHistory = computeFightFormScore(baseInputs({ priorRawScores: strongPriors }), ScoringConfigV1);
      expect(withHistory.formMomentum).toBeGreaterThan(0);
    });

    it("does not let momentum override a safety ceiling", () => {
      // Trip sleep_debt (lots of short nights) AND have strong priors.
      const shortSleep = Array.from({ length: 7 }, (_, i) => {
        const d = new Date("2026-05-01"); d.setDate(d.getDate() - i);
        return { date: d.toISOString().slice(0, 10), hours: 3 }; // ~5h/night debt → >10h in 7d
      });
      const r = computeFightFormScore(
        baseInputs({ sleepHours: shortSleep, priorRawScores: strongPriors }),
        ScoringConfigV1,
      );
      if (r.appliedCeiling) {
        expect(r.rawScore).toBeLessThanOrEqual(r.appliedCeiling.cap);
      }
    });
  });
```

- [ ] **Step 2: Run — expect the first test to FAIL**

Run: `npx vitest run src/scoring/__tests__/compose.test.ts -t "form momentum integration" 2>&1 | tail -20`
Expected: "awards a bonus..." FAILS (`formMomentum` undefined / 0).

- [ ] **Step 3: Wire into `compose.ts`**

(a) Add the import after the confidence import:

```ts
import { computeFormMomentum } from "./consistency";
```

(b) After the summary fields are computed (after the `dataAgeDays` reduce, before `const ceil = applyCeilings(`), add:

```ts
  // Consistency reward — added to the raw composite BEFORE ceilings so safety
  // caps and latching still override it. Rewards sustained all-pillar strength.
  const formMomentum = computeFormMomentum({
    priorRawScores: inputs.priorRawScores,
    rawScore,
    activePillars,
    totalPillars,
    dataConfidence,
    cfg,
  });
  const boostedRaw = Math.min(100, rawScore + formMomentum);
```

(c) Change the `applyCeilings` call to use `boostedRaw` instead of `rawScore`:

```ts
  const ceil = applyCeilings(boostedRaw, {
```

(d) Add `formMomentum` to the main return object (after `totalPillars,`):

```ts
    formMomentum,
```

(e) Add `formMomentum: 0` to EACH of the four early-return objects (paused/no_camp/calibrating/post-fight), alongside the existing `dataConfidence: 0, dataAgeDays: 0, activePillars: 0, totalPillars: 0`.

- [ ] **Step 4: Run integration tests — expect PASS**

Run: `npx vitest run src/scoring/__tests__/compose.test.ts -t "form momentum integration" 2>&1 | tail -20`
Expected: both PASS.

- [ ] **Step 5: Run the FULL suite**

Run: `npx vitest run src/scoring 2>&1 | tail -20`
Expected: ALL pass. Most existing tests pass `priorRawScores: []` (or < 5) → momentum 0 → `boostedRaw === rawScore` → unchanged. The `formMomentum output field` test from Task 2 now passes.
If a test with ≥5 priors and all-pillars-present shifts upward by ≤5 points, confirm it's the intended bonus and update that threshold with a comment. Report any change.

- [ ] **Step 6: Typecheck + stage**

Run: `npx tsc --noEmit 2>&1 | grep -i "src/scoring" | head -20` (expect none).

```bash
git add src/scoring/compose.ts src/scoring/__tests__/compose.test.ts
```

Suggested commit message: `feat(scoring): apply form-momentum bonus before ceilings, expose on output`

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1:** Run `npx vitest run src/scoring 2>&1 | tail -15` — all pass.
- [ ] **Step 2:** Run `npx tsc --noEmit 2>&1 | grep -i src/scoring` — no errors.
- [ ] **Step 3:** Sanity sim (optional): reuse the throwaway ideal-user approach to confirm a sustained ideal user now (a) gets credit for nutrition and (b) shows `formMomentum > 0` after ~5 days. Delete any scratch file; stage nothing extra.

Suggested commit message: `chore(scoring): consistency-reward plan green`

---

## Self-Review

**Spec coverage (against the chosen scope: nutrition weight + consistency bonus):**
- Nutrition pillar now carries weight → Task 1. ✓
- Obsolete "nutrition weight 0" test replaced → Task 1. ✓
- Consistency bonus, un-gameable (all pillars present + sustained mean + confidence-scaled) → Tasks 2–4. ✓
- Bonus applied before ceilings so anti-gaming/latching still wins → Task 4 step 3c + the "does not override a safety ceiling" test. ✓
- `formMomentum` exposed for UI → Task 2 + Task 4. ✓

**Explicitly NOT in this plan** (user did not select): EMA tuning / ratchet; wellness↔HealthKit blend + recovery baseline re-anchor. Tracked as possible future work.

**Placeholder scan:** none.

**Type consistency:** `computeFormMomentum` signature matches its test + the compose call site (same field names). `consistency` config keys match between `types.ts` and `config/v1.ts`. `formMomentum` added to the main return AND all four early returns (required field).

**Risk note:** Changing the four established `0.25` weights can shift numeric-threshold assertions. Task 1 step 4 and Task 4 step 5 explicitly require reconciling any drift by confirming the new value is correct (not by reverting). Base-fixture pillars are ~100 so drift should be minimal.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-03-scoring-consistency-reward.md`. Execute via subagent-driven-development (fresh subagent per task, spec + quality review between). Implementers stage only — owner commits.
