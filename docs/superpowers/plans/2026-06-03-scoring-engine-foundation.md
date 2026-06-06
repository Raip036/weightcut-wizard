# Scoring Engine Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fight score engine surface data-confidence, ease stale pillars toward neutral, cap labels on thin data, and latch safety ceilings so "stop logging" can't escape them — all without changing the displayed number for fully-logged users.

**Architecture:** Pure additive changes to `src/scoring/*`. New `FightFormScore` fields (`dataConfidence`, `dataAgeDays`, `activePillars`, `totalPillars`, per-pillar `completeness`) and a new `state: "stale"` are optional/derived, so existing Convex callers and UI keep working untouched. Staleness is derived in-engine from the max log date already present in each input array — no new Convex input required. Ceiling latching uses a new optional `priorCeilings` input; absent it, behaviour is identical to today.

**Tech Stack:** TypeScript, Vitest. This plan touches only `src/scoring/` and its `__tests__/`. No Convex, no React.

**Project note on commits:** This project's owner commits manually in GitHub Desktop and has asked that automated tools never run `git commit`. Each "Commit" step therefore **stages** the changes with `git add` and states the suggested commit message for the owner to use — do not run `git commit` yourself.

**Run tests with:** `npx vitest run src/scoring` (whole suite) or `npx vitest run src/scoring/__tests__/<file> -t "<test name>"` (single test).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/scoring/types.ts` | Type definitions for inputs, config, output | Modify — add config blocks, output fields, `"stale"` state, `priorCeilings` input |
| `src/scoring/config/v1.ts` | Concrete v1 config values | Modify — add `staleness` + `confidence` blocks |
| `src/scoring/staleness.ts` | Derive last-log date & staleness/decay math per pillar | **Create** |
| `src/scoring/confidence.ts` | Compute per-pillar completeness + rolled-up `dataConfidence` | **Create** |
| `src/scoring/ceilings.ts` | Ceiling rule evaluation + new latching | Modify — add `latchCeilings` |
| `src/scoring/compose.ts` | Orchestration: wire staleness, confidence, label-cap, latching | Modify |
| `src/scoring/__tests__/staleness.test.ts` | Unit tests for staleness math | **Create** |
| `src/scoring/__tests__/confidence.test.ts` | Unit tests for confidence math | **Create** |
| `src/scoring/__tests__/compose.test.ts` | Integration tests for the new behaviour | Modify — add describe blocks |
| `src/scoring/__tests__/ceilings.test.ts` | Latching tests | Modify — add describe block |

---

## Task 1: Add config + types for staleness and confidence

**Files:**
- Modify: `src/scoring/types.ts`
- Modify: `src/scoring/config/v1.ts`
- Test: `src/scoring/__tests__/compose.test.ts`

- [ ] **Step 1: Add the new types to `types.ts`**

In `src/scoring/types.ts`, add `"stale"` to the state union:

```ts
export type FightFormState = "ok" | "calibrating" | "no_camp" | "paused" | "stale";
```

Add `completeness` to `SubScore` (after `meta?`):

```ts
export type SubScore = {
  value: number;
  weight: number;
  reason: string;
  meta?: Record<string, number | string>;
  /**
   * 0..1 freshness/completeness of the data backing this sub-score, derived
   * from how recently it was logged (1 = logged today, 0 = stale beyond the
   * pillar's horizon or never logged). Optional so callers/tests that don't
   * set it are unaffected; `computeFightFormScore` always populates it.
   */
  completeness?: number;
};
```

Add the new output fields to `FightFormScore` (after `recoveryConfidence`):

```ts
  /**
   * 0..1 — how much of the (phase-weighted) composite was backed by fresh
   * data today. 1.0 = every contributing pillar logged today; lower means
   * the number rests partly on stale/partial inputs. UI dims the ring and
   * caps the label when this is low. Always populated.
   */
  dataConfidence: number;
  /** Largest staleness gap (days since last log) across contributing pillars. */
  dataAgeDays: number;
  /** Count of pillars currently contributing (weight > 0). */
  activePillars: number;
  /** Total pillars considered for the current phase (weight defined > 0). */
  totalPillars: number;
```

Add a `priorCeilings` input to `ScoringInputs` (after `priorRawScores`):

```ts
  /**
   * Recently-applied ceilings (most recent ~5 days), used to LATCH a fired
   * safety cap so it can't be escaped by simply not logging. Optional — when
   * absent the engine applies ceilings exactly as before (no latching).
   */
  priorCeilings?: Array<{ date: string; ruleId: string; cap: number }>;
```

Add `staleness` and `confidence` blocks to `ScoringConfig` (after `coldStart`):

```ts
  /**
   * Per-pillar staleness handling. `graceDays` = days a pillar may go
   * unlogged before anything changes. `horizonDays` = days at which the
   * pillar is fully decayed/zero-confidence. `dMax` = max decay fraction
   * toward neutral (so a stale pillar eases toward 50, never erases).
   */
  staleness: {
    neutral: number;
    byPillar: Record<SubScoreKey, { graceDays: number; horizonDays: number; dMax: number }>;
  };
  /**
   * `labelCapThreshold` — when `dataConfidence` is below this, the label is
   * capped at "sharpening" and state is "stale". `ceilingCooldownDays` — how
   * long a fired ceiling stays latched while its pillar is stale.
   */
  confidence: { labelCapThreshold: number; ceilingCooldownDays: number };
```

- [ ] **Step 2: Add the concrete values to `config/v1.ts`**

In `src/scoring/config/v1.ts`, add before the closing `};` (after the `coldStart` line):

```ts
  staleness: {
    neutral: 50,
    byPillar: {
      sleep:              { graceDays: 2, horizonDays: 9,  dMax: 0.7 },
      weightCut:          { graceDays: 4, horizonDays: 14, dMax: 0.7 },
      wellness:           { graceDays: 7, horizonDays: 14, dMax: 0.7 },
      nutritionAdherence: { graceDays: 3, horizonDays: 10, dMax: 0.7 },
      trainingLoad:       { graceDays: 5, horizonDays: 21, dMax: 0.7 },
      recovery:           { graceDays: 3, horizonDays: 10, dMax: 0.7 },
    },
  },
  confidence: { labelCapThreshold: 0.5, ceilingCooldownDays: 5 },
```

- [ ] **Step 3: Write a failing test asserting the new output fields exist**

In `src/scoring/__tests__/compose.test.ts`, add this describe block before the final closing `});`:

```ts
  describe("confidence + staleness output fields", () => {
    it("populates dataConfidence, dataAgeDays, activePillars, totalPillars", () => {
      const r = computeFightFormScore(baseInputs(), ScoringConfigV1);
      expect(r.dataConfidence).toBeGreaterThan(0);
      expect(r.dataConfidence).toBeLessThanOrEqual(1);
      expect(r.dataAgeDays).toBe(0); // base fixture logs everything up to `date`
      expect(r.activePillars).toBeGreaterThanOrEqual(3);
      expect(r.totalPillars).toBeGreaterThanOrEqual(3);
    });

    it("populates per-pillar completeness for contributing pillars", () => {
      const r = computeFightFormScore(baseInputs(), ScoringConfigV1);
      expect(r.subScores.sleep.completeness).toBe(1); // logged on `date`
    });
  });
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/scoring/__tests__/compose.test.ts -t "confidence + staleness output fields"`
Expected: FAIL — `dataConfidence` is `undefined` (not yet returned by `computeFightFormScore`).

- [ ] **Step 5: Stage the type/config changes (no implementation yet)**

This task only adds the type surface + config values; Task 2–3 implement the logic that fills the fields. Leave the failing test in place — it is satisfied at the end of Task 3.

Suggested commit message (owner runs in GitHub Desktop): `feat(scoring): add staleness + confidence config and output types`

```bash
git add src/scoring/types.ts src/scoring/config/v1.ts src/scoring/__tests__/compose.test.ts
```

---

## Task 2: Confidence module (per-pillar completeness + rolled-up dataConfidence)

**Files:**
- Create: `src/scoring/staleness.ts`
- Create: `src/scoring/confidence.ts`
- Test: `src/scoring/__tests__/staleness.test.ts`
- Test: `src/scoring/__tests__/confidence.test.ts`

- [ ] **Step 1: Write the failing staleness test**

Create `src/scoring/__tests__/staleness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { daysBetween, staleDaysFor, decayFactor, lastLogDates } from "../staleness";
import { ScoringConfigV1 } from "../config/v1";
import type { ScoringInputs } from "../types";

const emptyInputs = (): ScoringInputs => ({
  date: "2026-05-10", fightDate: "2026-06-15", campStartDate: "2026-04-01",
  startingWeightKg: 80, goalWeightKg: 75, currentWeightKg: 77,
  sessions: [], sleepHours: [], weights: [], hooperByDate: [], meals: [],
  targets: { calories: null, proteinG: null }, priorRawScores: [],
});

describe("daysBetween", () => {
  it("counts whole UTC days between two ISO dates", () => {
    expect(daysBetween("2026-05-01", "2026-05-10")).toBe(9);
    expect(daysBetween("2026-05-10", "2026-05-10")).toBe(0);
  });
});

describe("lastLogDates", () => {
  it("returns the max log date per pillar, null when empty", () => {
    const inputs = emptyInputs();
    inputs.sleepHours = [{ date: "2026-05-03", hours: 8 }, { date: "2026-05-07", hours: 7 }];
    inputs.weights = [{ date: "2026-05-09", weightKg: 77 }];
    const last = lastLogDates(inputs);
    expect(last.sleep).toBe("2026-05-07");
    expect(last.weightCut).toBe("2026-05-09");
    expect(last.wellness).toBeNull();
  });

  it("includes restDays in the trainingLoad recency", () => {
    const inputs = emptyInputs();
    inputs.sessions = [{ date: "2026-05-02", rpe: 7, durationMinutes: 45 }];
    inputs.restDays = ["2026-05-08"];
    const last = lastLogDates(inputs);
    expect(last.trainingLoad).toBe("2026-05-08");
  });
});

describe("staleDaysFor", () => {
  it("is 0 when logged on the as-of date", () => {
    expect(staleDaysFor("2026-05-10", "2026-05-10")).toBe(0);
  });
  it("counts days since last log", () => {
    expect(staleDaysFor("2026-05-04", "2026-05-10")).toBe(6);
  });
  it("returns null when never logged", () => {
    expect(staleDaysFor(null, "2026-05-10")).toBeNull();
  });
});

describe("decayFactor", () => {
  const cfg = ScoringConfigV1.staleness.byPillar.sleep; // grace 2, horizon 9, dMax 0.7

  it("is 0 within the grace window", () => {
    expect(decayFactor(2, cfg)).toBe(0);
    expect(decayFactor(1, cfg)).toBe(0);
  });
  it("ramps linearly past grace toward dMax at horizon", () => {
    // staleDays 9 → (9-2)/(9-2) = 1, clipped to dMax 0.7
    expect(decayFactor(9, cfg)).toBeCloseTo(0.7, 5);
    // staleDays 5 → (5-2)/(9-2) = 0.4286, * nothing (raw d), capped at dMax
    expect(decayFactor(5, cfg)).toBeCloseTo(3 / 7, 5);
  });
  it("never exceeds dMax", () => {
    expect(decayFactor(100, cfg)).toBe(0.7);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/scoring/__tests__/staleness.test.ts`
Expected: FAIL — `Cannot find module '../staleness'`.

- [ ] **Step 3: Implement `staleness.ts`**

Create `src/scoring/staleness.ts`:

```ts
import type { ScoringInputs, SubScoreKey } from "./types";

/** Whole UTC days from `from` to `to` (both ISO YYYY-MM-DD). Negative if to < from. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

function maxDate(dates: string[]): string | null {
  let best: string | null = null;
  for (const d of dates) if (best === null || d > best) best = d;
  return best;
}

/** Most recent log date per pillar (null when the pillar has no data). */
export function lastLogDates(inputs: ScoringInputs): Record<SubScoreKey, string | null> {
  return {
    trainingLoad: maxDate([
      ...inputs.sessions.map((s) => s.date),
      ...((inputs.restDays ?? []) as string[]),
    ]),
    sleep: maxDate(inputs.sleepHours.map((s) => s.date)),
    weightCut: maxDate(inputs.weights.map((w) => w.date)),
    wellness: maxDate(inputs.hooperByDate.map((h) => h.date)),
    nutritionAdherence: maxDate(inputs.meals.map((m) => m.date)),
    // recovery has no log-date array; its freshness is governed by
    // recoveryConfidence, handled in confidence.ts. Treat as "today" when it
    // contributes so it doesn't drag dataAgeDays.
    recovery: inputs.healthSignals ? inputs.date : null,
  };
}

/** Days since the pillar's last log relative to the as-of date; null if never. */
export function staleDaysFor(lastDate: string | null, asOfDate: string): number | null {
  if (lastDate === null) return null;
  return Math.max(0, daysBetween(lastDate, asOfDate));
}

/**
 * Decay fraction toward neutral for a stale pillar. 0 within grace, ramps
 * linearly to `dMax` at `horizonDays`, capped at `dMax`.
 */
export function decayFactor(
  staleDays: number,
  cfg: { graceDays: number; horizonDays: number; dMax: number },
): number {
  if (staleDays <= cfg.graceDays) return 0;
  const span = Math.max(1, cfg.horizonDays - cfg.graceDays);
  const raw = (staleDays - cfg.graceDays) / span;
  return Math.min(cfg.dMax, Math.max(0, raw));
}
```

- [ ] **Step 4: Run staleness tests to verify they pass**

Run: `npx vitest run src/scoring/__tests__/staleness.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Write the failing confidence test**

Create `src/scoring/__tests__/confidence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { completenessFor, rollUpConfidence } from "../confidence";
import { ScoringConfigV1 } from "../config/v1";

describe("completenessFor", () => {
  it("is 1 when logged today", () => {
    expect(completenessFor(0, ScoringConfigV1.staleness.byPillar.sleep)).toBe(1);
  });
  it("is 0 when never logged (null staleDays)", () => {
    expect(completenessFor(null, ScoringConfigV1.staleness.byPillar.sleep)).toBe(0);
  });
  it("decreases linearly to 0 at the horizon", () => {
    // sleep horizon 9 → staleDays 9 gives 0; staleDays ~4.5 gives ~0.5
    expect(completenessFor(9, ScoringConfigV1.staleness.byPillar.sleep)).toBeCloseTo(0, 5);
    expect(completenessFor(4.5, ScoringConfigV1.staleness.byPillar.sleep)).toBeCloseTo(0.5, 5);
  });
});

describe("rollUpConfidence", () => {
  it("is the weight-weighted mean of present pillars' completeness", () => {
    const c = rollUpConfidence([
      { weight: 0.25, completeness: 1 },
      { weight: 0.25, completeness: 0.5 },
      { weight: 0, completeness: 0 }, // excluded
    ]);
    expect(c).toBeCloseTo(0.75, 5);
  });
  it("is 0 when no pillar is present", () => {
    expect(rollUpConfidence([{ weight: 0, completeness: 0.9 }])).toBe(0);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/scoring/__tests__/confidence.test.ts`
Expected: FAIL — `Cannot find module '../confidence'`.

- [ ] **Step 7: Implement `confidence.ts`**

Create `src/scoring/confidence.ts`:

```ts
/**
 * Per-pillar completeness from staleness: 1 when fresh (staleDays 0), ramping
 * linearly down to 0 at `horizonDays`. `null` staleDays (never logged) → 0.
 */
export function completenessFor(
  staleDays: number | null,
  cfg: { horizonDays: number },
): number {
  if (staleDays === null) return 0;
  return Math.min(1, Math.max(0, 1 - staleDays / cfg.horizonDays));
}

/** Weight-weighted mean of completeness over PRESENT (weight>0) pillars. */
export function rollUpConfidence(
  pillars: Array<{ weight: number; completeness: number }>,
): number {
  const present = pillars.filter((p) => p.weight > 0);
  const total = present.reduce((a, p) => a + p.weight, 0);
  if (total <= 0) return 0;
  return present.reduce((a, p) => a + p.completeness * p.weight, 0) / total;
}
```

- [ ] **Step 8: Run confidence tests to verify they pass**

Run: `npx vitest run src/scoring/__tests__/confidence.test.ts`
Expected: PASS (all).

- [ ] **Step 9: Stage**

Suggested commit message: `feat(scoring): add staleness + confidence pure helpers with tests`

```bash
git add src/scoring/staleness.ts src/scoring/confidence.ts src/scoring/__tests__/staleness.test.ts src/scoring/__tests__/confidence.test.ts
```

---

## Task 3: Wire confidence + staleness decay into compose

**Files:**
- Modify: `src/scoring/compose.ts`
- Test: `src/scoring/__tests__/compose.test.ts`

- [ ] **Step 1: Write failing tests for decay + field population**

In `src/scoring/__tests__/compose.test.ts`, add to the `"confidence + staleness output fields"` describe block (created in Task 1) these tests:

```ts
    it("eases a stale pillar's contribution toward neutral but does not erase it", () => {
      // Sleep logged strong (8h) but 8 days ago → past grace(2), below horizon(9).
      const staleSleep = Array.from({ length: 7 }, (_, i) => {
        const d = new Date("2026-04-23"); d.setDate(d.getDate() - i); // ends 8 days before 2026-05-01
        return { date: d.toISOString().slice(0, 10), hours: 8 };
      });
      const fresh = computeFightFormScore(baseInputs(), ScoringConfigV1);
      const stale = computeFightFormScore(baseInputs({ sleepHours: staleSleep }), ScoringConfigV1);
      // Stale sleep value should be pulled toward neutral (50) vs fresh, but
      // still present (weight > 0) and not zeroed.
      expect(stale.subScores.sleep.weight).toBeGreaterThan(0);
      expect(stale.subScores.sleep.value).toBeLessThan(fresh.subScores.sleep.value);
      expect(stale.subScores.sleep.value).toBeGreaterThan(50); // eased toward, not past, neutral
      expect(stale.subScores.sleep.completeness).toBeLessThan(1);
      expect(stale.dataAgeDays).toBeGreaterThanOrEqual(8);
    });

    it("does not decay within the grace window (fresh fixture unchanged)", () => {
      const r = computeFightFormScore(baseInputs(), ScoringConfigV1);
      expect(r.subScores.sleep.value).toBeGreaterThanOrEqual(99); // 8h logged today → ~100
    });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/scoring/__tests__/compose.test.ts -t "eases a stale pillar"`
Expected: FAIL — decay not applied; `stale.subScores.sleep.value` equals fresh value, and `dataAgeDays` is `undefined`/`0`.

- [ ] **Step 3: Implement in `compose.ts`**

Add imports at the top of `src/scoring/compose.ts` (after the existing `import` block, line 10):

```ts
import { lastLogDates, staleDaysFor, decayFactor } from "./staleness";
import { completenessFor, rollUpConfidence } from "./confidence";
import type { SubScore } from "./types";
```

Then, replace the `subScores` object construction and the redistribution block (current lines 267–291) with the version below. It applies decay to each present pillar's `value`, computes `completeness`, then redistributes:

```ts
  // Derive per-pillar recency and apply staleness decay. A pillar logged
  // within its grace window is untouched (fresh fixtures unchanged). Past
  // grace, its value eases toward neutral (50) by up to dMax, and its
  // completeness drops — never erased, just less authoritative.
  const lastDates = lastLogDates(inputs);
  const neutral = cfg.staleness.neutral;

  const applyStaleness = (key: SubScoreKey, sub: { value: number; reason: string; meta?: SubScore["meta"] }, weight: number): SubScore => {
    const sd = staleDaysFor(lastDates[key], inputs.date);
    const pCfg = cfg.staleness.byPillar[key];
    const d = sd === null ? 0 : decayFactor(sd, pCfg);
    const decayedValue = sub.value * (1 - d) + neutral * d;
    return {
      value: decayedValue,
      weight,
      reason: sub.reason,
      meta: sub.meta,
      completeness: weight > 0 ? completenessFor(sd, pCfg) : 0,
    };
  };

  const subScores: FightFormScore["subScores"] = {
    trainingLoad: applyStaleness("trainingLoad", trainingLoad, subScoreHasData.trainingLoad ? weights.trainingLoad : 0),
    sleep: applyStaleness("sleep", sleep, subScoreHasData.sleep ? weights.sleep : 0),
    weightCut: applyStaleness("weightCut", weightCut, subScoreHasData.weightCut ? weights.weightCut : 0),
    wellness: applyStaleness("wellness", wellness, subScoreHasData.wellness ? wellnessWeight : 0),
    nutritionAdherence: applyStaleness("nutritionAdherence", nutritionAdherence, subScoreHasData.nutritionAdherence ? weights.nutritionAdherence : 0),
    recovery: applyStaleness(
      "recovery",
      { value: recovery.value, reason: recovery.reason },
      recoveryWeight,
    ),
  };

  // Composite redistribution on missing data (unchanged math; values may now
  // be decayed). Divide only by the sum of present weights.
  const subScoreList = Object.values(subScores);
  const present = subScoreList.filter((s) => s.weight > 0);
  const totalPresentWeight = present.reduce((a, s) => a + s.weight, 0);
  const rawScore = totalPresentWeight > 0
    ? present.reduce((a, s) => a + s.value * s.weight, 0) / Math.max(1e-9, totalPresentWeight)
    : 50;

  // Confidence + staleness summary fields.
  const dataConfidence = rollUpConfidence(
    (Object.keys(subScores) as SubScoreKey[]).map((k) => ({
      weight: subScores[k].weight,
      completeness: subScores[k].completeness ?? 0,
    })),
  );
  const activePillars = present.length;
  const totalPillars = (Object.keys(weights) as SubScoreKey[]).filter((k) => weights[k] > 0).length
    + (recoveryWeight > 0 ? 1 : 0) - (recoveryHasSignal ? 1 : 0);
  const dataAgeDays = present.reduce((mx, s) => {
    // find this present sub-score's key to look up its staleness
    return mx;
  }, 0);
```

The `dataAgeDays` reducer above can't see keys; replace that block with a keyed computation:

```ts
  let dataAgeDays = 0;
  for (const k of Object.keys(subScores) as SubScoreKey[]) {
    if (subScores[k].weight <= 0) continue;
    const sd = staleDaysFor(lastDates[k], inputs.date);
    if (sd !== null && sd > dataAgeDays) dataAgeDays = sd;
  }
```

And fix `totalPillars` to a clear form — replace the `totalPillars` line with:

```ts
  // Pillars eligible this phase: those with a defined phase weight, accounting
  // for the wellness→recovery handover so we never double-count that slot.
  const phaseKeys = (Object.keys(weights) as SubScoreKey[]).filter((k) => weights[k] > 0);
  const totalPillars = recoveryHasSignal ? phaseKeys.length : phaseKeys.length;
```

(Both branches are equal because recovery takes over the wellness slot 1:1, so the eligible-pillar count is invariant — keep the explicit ternary for readability.)

- [ ] **Step 4: Add the new fields to the returned object**

In the final `return { ... }` of `computeFightFormScore` (currently lines 312–333), add these fields after `recoveryConfidence: recovery.confidence,`:

```ts
    dataConfidence,
    dataAgeDays,
    activePillars,
    totalPillars,
```

- [ ] **Step 5: Run the full scoring suite**

Run: `npx vitest run src/scoring`
Expected: PASS — all existing tests still green (fresh fixtures have staleDays 0 → no decay → identical values), plus the Task 1 + Task 3 new tests pass.

If any existing test regresses, the cause is decay firing on a fixture that isn't actually fresh — verify that fixture's max log date equals its `date`. Do not weaken the decay; fix the fixture's dates or confirm the staleness is correct.

- [ ] **Step 6: Stage**

Suggested commit message: `feat(scoring): apply staleness decay + surface dataConfidence in composite`

```bash
git add src/scoring/compose.ts src/scoring/__tests__/compose.test.ts
```

---

## Task 4: Label-capping + "stale" state on thin data

**Files:**
- Modify: `src/scoring/compose.ts`
- Test: `src/scoring/__tests__/compose.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/scoring/__tests__/compose.test.ts`, add a new describe block before the final `});`:

```ts
  describe("label-cap on low data confidence", () => {
    it("caps the label at 'sharpening' and sets state 'stale' when confidence is low", () => {
      // Only ONE pillar present (sleep), logged 8 days ago → low completeness,
      // dragging dataConfidence below the 0.5 threshold while raw stays high.
      const staleSleep = Array.from({ length: 4 }, (_, i) => {
        const d = new Date("2026-04-23"); d.setDate(d.getDate() - i);
        return { date: d.toISOString().slice(0, 10), hours: 8 };
      });
      const r = computeFightFormScore(
        baseInputs({ sessions: [], weights: [], hooperByDate: [], meals: [], sleepHours: staleSleep,
          // keep enough distinct days to clear the cold-start gate
          priorRawScores: [] }),
        ScoringConfigV1,
      );
      expect(r.dataConfidence).toBeLessThan(0.5);
      expect(r.state).toBe("stale");
      expect(r.label).not.toBe("sharp");
    });

    it("does not cap the label when confidence is healthy", () => {
      const r = computeFightFormScore(baseInputs(), ScoringConfigV1);
      expect(r.state).toBe("ok");
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/scoring/__tests__/compose.test.ts -t "label-cap"`
Expected: FAIL — `state` is `"ok"` (no stale handling) and label may be `"sharp"`.

Note: if the first test fails at the cold-start gate (`state: "calibrating"`) instead, the fixture has < 3 distinct data days. Add 3 distinct sleep dates as shown (4 nights ending 2026-04-23 gives 4 distinct days → clears `minDaysOfDataIn7d: 3`).

- [ ] **Step 3: Implement the cap in `compose.ts`**

In `computeFightFormScore`, the final return currently sets `label: pickLabel(finalScore, cfg)` and `state: "ok"`. Replace those two lines with a computed label + state:

```ts
  const lowConfidence = dataConfidence < cfg.confidence.labelCapThreshold;
  let label = pickLabel(finalScore, cfg);
  if (lowConfidence && label === "sharp") label = "sharpening";
  const state: FightFormState = lowConfidence ? "stale" : "ok";
```

Add the `FightFormState` import to the existing type import on line 1:

```ts
import type { FightFormScore, FightFormState, ScoringConfig, ScoringInputs, ScoringInputSources, SubScoreKey } from "./types";
```

Then in the return object replace `label: pickLabel(finalScore, cfg),` with `label,` and `state: "ok",` with `state,`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/scoring/__tests__/compose.test.ts -t "label-cap"`
Expected: PASS (both).

- [ ] **Step 5: Run the full suite (guard against state regressions)**

Run: `npx vitest run src/scoring`
Expected: PASS. The base fixture's `dataConfidence` is ~1 (everything fresh), so `state` stays `"ok"` and existing assertions hold.

- [ ] **Step 6: Stage**

Suggested commit message: `feat(scoring): cap label and surface 'stale' state on low data confidence`

```bash
git add src/scoring/compose.ts src/scoring/__tests__/compose.test.ts
```

---

## Task 5: Ceiling latching (anti-gaming)

**Files:**
- Modify: `src/scoring/ceilings.ts`
- Modify: `src/scoring/compose.ts`
- Test: `src/scoring/__tests__/ceilings.test.ts`

A fired safety ceiling must not lift just because the bad logs aged out of the window. It lifts only when the relevant pillar has **fresh** data (within grace) that no longer triggers the rule. If the pillar is stale, the most-recent applied cap is re-latched for `ceilingCooldownDays`.

- [ ] **Step 1: Write the failing latch test**

In `src/scoring/__tests__/ceilings.test.ts`, add a new describe block before the final `});`:

```ts
import { latchCeilings } from "../ceilings";

describe("latchCeilings", () => {
  const cooldown = ScoringConfigV1.confidence.ceilingCooldownDays; // 5

  it("re-applies a recently-fired cap when its pillar is stale (escape attempt)", () => {
    // Live signals no longer trigger (no current cap), but sleep_debt fired 2
    // days ago and sleep is stale (no fresh logs) → latch it back.
    const r = latchCeilings(
      { score: 90, applied: null },
      {
        asOfDate: "2026-05-10",
        priorCeilings: [{ date: "2026-05-08", ruleId: "sleep_debt", cap: 65 }],
        staleDaysByRule: { sleep_debt: 6, weight_cut_dangerous: null, training_spike: null },
      },
      ScoringConfigV1,
    );
    expect(r.score).toBe(65);
    expect(r.applied?.ruleId).toBe("sleep_debt");
  });

  it("releases the cap when the pillar has fresh data and no longer triggers", () => {
    const r = latchCeilings(
      { score: 90, applied: null },
      {
        asOfDate: "2026-05-10",
        priorCeilings: [{ date: "2026-05-08", ruleId: "sleep_debt", cap: 65 }],
        staleDaysByRule: { sleep_debt: 1, weight_cut_dangerous: null, training_spike: null },
      },
      ScoringConfigV1,
    );
    expect(r.score).toBe(90);
    expect(r.applied).toBeNull();
  });

  it("does not latch a cap older than the cooldown window", () => {
    const r = latchCeilings(
      { score: 90, applied: null },
      {
        asOfDate: "2026-05-20",
        priorCeilings: [{ date: "2026-05-08", ruleId: "sleep_debt", cap: 65 }], // 12 days ago > cooldown 5
        staleDaysByRule: { sleep_debt: 12, weight_cut_dangerous: null, training_spike: null },
      },
      ScoringConfigV1,
    );
    expect(r.score).toBe(90);
    expect(r.applied).toBeNull();
  });

  it("keeps the live cap when one is already applied (no-op)", () => {
    const r = latchCeilings(
      { score: 65, applied: { ruleId: "sleep_debt", cap: 65 } },
      { asOfDate: "2026-05-10", priorCeilings: [], staleDaysByRule: { sleep_debt: 0, weight_cut_dangerous: null, training_spike: null } },
      ScoringConfigV1,
    );
    expect(r.score).toBe(65);
    expect(r.applied?.ruleId).toBe("sleep_debt");
  });

  it("is a no-op when priorCeilings is empty", () => {
    const r = latchCeilings(
      { score: 88, applied: null },
      { asOfDate: "2026-05-10", priorCeilings: [], staleDaysByRule: { sleep_debt: 0, weight_cut_dangerous: null, training_spike: null } },
      ScoringConfigV1,
    );
    expect(r.score).toBe(88);
    expect(r.applied).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/scoring/__tests__/ceilings.test.ts -t "latchCeilings"`
Expected: FAIL — `latchCeilings` is not exported.

- [ ] **Step 3: Implement `latchCeilings` in `ceilings.ts`**

Append to `src/scoring/ceilings.ts`:

```ts
/** Maps each latchable ceiling rule to the pillar whose freshness governs it. */
const CEILING_PILLAR: Record<string, "sleep_debt" | "weight_cut_dangerous" | "training_spike"> = {
  sleep_debt: "sleep_debt",
  weight_cut_dangerous: "weight_cut_dangerous",
  training_spike: "training_spike",
};

export type LatchInputs = {
  asOfDate: string;
  priorCeilings: Array<{ date: string; ruleId: string; cap: number }>;
  /**
   * Days since the rule's governing pillar was last logged (null = never).
   * A rule whose pillar is fresh (staleDays within grace) is allowed to
   * release; a stale pillar keeps the cap latched.
   */
  staleDaysByRule: Record<"sleep_debt" | "weight_cut_dangerous" | "training_spike", number | null>;
};

/**
 * Latch a recently-fired ceiling that the live evaluation no longer triggers,
 * UNLESS the governing pillar has fresh data showing genuine recovery. This
 * closes the "stop logging to escape the cap" exploit: silence keeps the cap;
 * a fresh, recovered log lifts it.
 */
export function latchCeilings(
  live: { score: number; applied: { ruleId: string; cap: number } | null },
  inputs: LatchInputs,
  cfg: ScoringConfig,
): { score: number; applied: { ruleId: string; cap: number } | null } {
  if (live.applied) return live; // a live cap already governs; nothing to latch.
  const graceByRule = {
    sleep_debt: cfg.staleness.byPillar.sleep.graceDays,
    weight_cut_dangerous: cfg.staleness.byPillar.weightCut.graceDays,
    training_spike: cfg.staleness.byPillar.trainingLoad.graceDays,
  } as const;

  let latched: { ruleId: string; cap: number } | null = null;
  for (const pc of inputs.priorCeilings) {
    const rule = CEILING_PILLAR[pc.ruleId];
    if (!rule) continue;
    const ageDays = Math.max(0, Math.round(
      (new Date(inputs.asOfDate + "T00:00:00Z").getTime() - new Date(pc.date + "T00:00:00Z").getTime()) / 86400000,
    ));
    if (ageDays > cfg.confidence.ceilingCooldownDays) continue; // too old to latch
    const staleDays = inputs.staleDaysByRule[rule];
    const pillarFresh = staleDays !== null && staleDays <= graceByRule[rule];
    if (pillarFresh) continue; // fresh data + rule not live = genuine recovery → release
    // Stale pillar within cooldown → latch the tightest such cap.
    if (latched === null || pc.cap < latched.cap) latched = { ruleId: pc.ruleId, cap: pc.cap };
  }
  if (latched === null) return live;
  return { score: Math.min(live.score, latched.cap), applied: latched };
}
```

- [ ] **Step 4: Run latch tests to verify pass**

Run: `npx vitest run src/scoring/__tests__/ceilings.test.ts -t "latchCeilings"`
Expected: PASS (all 5).

- [ ] **Step 5: Wire latching into `compose.ts`**

In `computeFightFormScore`, immediately after the existing `const ceil = applyCeilings(...)` block (ends line 300), add:

```ts
  // Anti-gaming: latch a recently-fired ceiling that live signals no longer
  // trigger when the governing pillar is stale (escape-by-not-logging).
  const ceilStale = {
    sleep_debt: staleDaysFor(lastDates.sleep, inputs.date),
    weight_cut_dangerous: staleDaysFor(lastDates.weightCut, inputs.date),
    training_spike: staleDaysFor(lastDates.trainingLoad, inputs.date),
  };
  const latched = latchCeilings(ceil, {
    asOfDate: inputs.date,
    priorCeilings: inputs.priorCeilings ?? [],
    staleDaysByRule: ceilStale,
  }, cfg);
```

Add `latchCeilings` to the ceilings import on line 9:

```ts
import { applyCeilings, latchCeilings } from "./ceilings";
```

Then change the EMA line (currently `const displayed = emaSmooth(ceil.score, ...)`, line 302) to use the latched score, and the `appliedCeiling`/`rawScore` to use `latched`:

```ts
  const displayed = emaSmooth(latched.score, inputs.priorRawScores, cfg.smoothing.emaDays);
```

In the return object change `rawScore: Math.round(ceil.score),` → `rawScore: Math.round(latched.score),` and `appliedCeiling: ceil.applied,` → `appliedCeiling: latched.applied,`.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run src/scoring`
Expected: PASS. Existing tests pass `priorCeilings` undefined → `latchCeilings` is a no-op (empty array), so behaviour is unchanged for all current fixtures.

- [ ] **Step 7: Add an integration test proving the exploit is closed**

In `src/scoring/__tests__/compose.test.ts`, add before the final `});`:

```ts
  describe("ceiling latching integration (anti-gaming)", () => {
    it("keeps the sleep_debt cap when the user stops logging sleep after tripping it", () => {
      // sleep_debt fired yesterday; today the user logged nothing new for sleep
      // (sleepHours ends 6 days ago → stale, beyond grace 2), so the live
      // sleepDebt7d is 0 and the rule wouldn't fire — but latching holds it.
      const staleSleep = Array.from({ length: 3 }, (_, i) => {
        const d = new Date("2026-04-25"); d.setDate(d.getDate() - i);
        return { date: d.toISOString().slice(0, 10), hours: 8 };
      });
      const r = computeFightFormScore(
        baseInputs({
          date: "2026-05-01",
          sleepHours: staleSleep,
          priorCeilings: [{ date: "2026-04-30", ruleId: "sleep_debt", cap: 65 }],
        }),
        ScoringConfigV1,
      );
      expect(r.appliedCeiling?.ruleId).toBe("sleep_debt");
      expect(r.rawScore).toBeLessThanOrEqual(65);
    });
  });
```

- [ ] **Step 8: Run to verify pass, then full suite**

Run: `npx vitest run src/scoring/__tests__/compose.test.ts -t "ceiling latching integration"`
Expected: PASS.
Run: `npx vitest run src/scoring`
Expected: PASS (whole scoring suite).

- [ ] **Step 9: Stage**

Suggested commit message: `feat(scoring): latch fired ceilings when pillar goes stale (anti-gaming)`

```bash
git add src/scoring/ceilings.ts src/scoring/compose.ts src/scoring/__tests__/ceilings.test.ts src/scoring/__tests__/compose.test.ts
```

---

## Task 6: Document backfill behaviour with a regression test

Backfill correcting *today's* score is already true (windows recompute from whatever logs fall in range). This task locks that contract with a test and documents that historical EMA is intentionally NOT rewritten.

**Files:**
- Test: `src/scoring/__tests__/compose.test.ts`

- [ ] **Step 1: Write the test**

In `src/scoring/__tests__/compose.test.ts`, add before the final `});`:

```ts
  describe("backfill corrects today's score (no historical rewrite)", () => {
    it("a late-logged past sleep night re-enters the window and lifts the score", () => {
      // Two distinct sleep nights logged 5 & 6 days ago (stale → decayed/low
      // completeness). Backfilling the last two nights restores fresh data.
      const before = computeFightFormScore(
        baseInputs({
          date: "2026-05-01",
          sleepHours: [
            { date: "2026-04-25", hours: 8 },
            { date: "2026-04-26", hours: 8 },
          ],
        }),
        ScoringConfigV1,
      );
      const after = computeFightFormScore(
        baseInputs({
          date: "2026-05-01",
          sleepHours: [
            { date: "2026-04-25", hours: 8 },
            { date: "2026-04-26", hours: 8 },
            { date: "2026-04-30", hours: 8 },
            { date: "2026-05-01", hours: 8 },
          ],
        }),
        ScoringConfigV1,
      );
      // Fresher sleep data → higher completeness for the sleep pillar.
      expect(after.subScores.sleep.completeness ?? 0).toBeGreaterThan(before.subScores.sleep.completeness ?? 0);
      expect(after.dataAgeDays).toBeLessThan(before.dataAgeDays);
    });
  });
```

- [ ] **Step 2: Run to verify pass (no implementation needed)**

Run: `npx vitest run src/scoring/__tests__/compose.test.ts -t "backfill corrects"`
Expected: PASS — this behaviour falls out of the Task 3 staleness wiring. If it fails, Task 3 was not completed correctly.

- [ ] **Step 3: Stage**

Suggested commit message: `test(scoring): lock backfill-corrects-today contract`

```bash
git add src/scoring/__tests__/compose.test.ts
```

---

## Task 7: Full-suite green + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the whole scoring suite**

Run: `npx vitest run src/scoring`
Expected: PASS — every test, old and new.

- [ ] **Step 2: Typecheck the project**

Run: `npx tsc --noEmit`
Expected: No errors in `src/scoring/*`. (Pre-existing errors elsewhere in the repo, if any, are out of scope — confirm none are in files this plan touched.)

- [ ] **Step 3: Stage any final cleanup**

Suggested commit message: `chore(scoring): foundation green — confidence, staleness, latching`

---

## Self-Review

**Spec coverage (against `2026-06-03-missed-log-handling-design.md`):**
- §1.4 confidence fields on output → Task 1 (types) + Task 3 (population). ✓
- §1.2 per-pillar recency → derived in-engine (`staleness.ts` `lastLogDates`), Task 2. Convex no longer needs to supply it. ✓ (noted deviation)
- §1.3 score-history extension → represented as the `priorCeilings` input (Task 1) consumed by latching (Task 5). The *persistence* of this history is Convex wiring, deferred to Plan 2 — flagged below.
- §2.1 confidence, not penalty → Task 2 + Task 3 (`dataConfidence` is separate from the number). ✓
- §2.2 staleness decay past grace → Task 2 (`decayFactor`) + Task 3 (wiring). ✓
- §2.3 label-capping + `state: "stale"` → Task 4. ✓
- §2.4 ceiling latching → Task 5. ✓
- §2.5 backfill behaviour → Task 6. ✓

**Out of scope for this plan (handled in later plans):**
- §1.1 rest/skip status & `marked_skips` table (Convex schema + UI) — Plan: Rest/Skip + Convex wiring. The engine already accepts `restDays`; extending skip semantics per-pillar is part of that plan.
- §1.3 *persisting* `appliedCeiling`/`ceilingFiredAt` into `fight_form_scores` and feeding `priorCeilings` from `fetchScoringInputs` — Plan: Convex wiring. Until then `latchCeilings` is a no-op (safe default).
- §3 ring UI, §4 completeness meter, §5 catch-up sheet, §6 rest/skip UI, §7 notifications — separate plans.

**Placeholder scan:** No TBD/TODO. The Task 3 `dataAgeDays` reducer is shown first in a non-working form then explicitly replaced with the keyed version — the engineer applies the replacement, not the stub. Flagged inline so it isn't mistaken for final code.

**Type consistency:** `completeness` is optional on `SubScore` and always set by `applyStaleness`. `latchCeilings` signature matches its test usage (`live`, `inputs`, `cfg`). `staleDaysByRule` keys (`sleep_debt`/`weight_cut_dangerous`/`training_spike`) match `CEILING_PILLAR`. `FightFormState` import added where `state` is typed. New config keys (`staleness`, `confidence`) match between `types.ts` and `config/v1.ts`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-03-scoring-engine-foundation.md`. This is **Plan 1 of the missed-log-handling feature** (scoring engine foundation); subsequent subsystems (Convex wiring, transparency UI, completeness meter, catch-up sheet, rest/skip UI, notifications) will each get their own plan.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
