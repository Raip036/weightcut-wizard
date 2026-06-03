# Rest/Skip Markers Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users record *intentional* non-logging — a planned rest day or a deliberately skipped pillar — so the engine stops treating that gap as silent staleness, and a future catch-up sheet won't nag about it. Ship the data layer, the engine semantics, and the proactive "Rest day" toggle on the Today Strip.

**Architecture:** A new `marked_skips` table `(userId, date, pillar)` for the non-training pillars (sleep/weight/nutrition/wellness), with set/clear mutations that trigger a recompute. Training rest already works via a `fight_camp_calendar` row with `sessionType:"Rest"` (the engine already reads it as `restDays`), so the training piece is purely UI. The engine gains an optional `markedSkips` input: a marked-skip date counts as recency for that pillar in `lastLogDates`, pausing staleness decay (the user told us why the gap exists) without inventing a fake value. `fetchScoringInputs` maps user-facing skip pillars to `SubScoreKey` and feeds them in.

**Tech Stack:** Convex (TS) + `convex-test`, Vitest for the engine, React + Playwright (on `localhost:8080`) for the UI.

**Project note on commits:** Owner commits manually in GitHub Desktop; tools never run `git commit`. "Stage" = `git add` only.

**Prereqs:** Plans 1, 1b, 2 complete (engine has `lastLogDates`/staleness decay and `ScoringInputs`; `fetchScoringInputs`/`recomputeForUserDate` exist; `fight_form_scores` widened).

**Validation:** UI work MUST be validated with a live Playwright playthrough on `http://localhost:8080` (per project rule) — `npm run dev` serves on 8080.

**Run tests:** `npx vitest run src/scoring` (engine), `npx vitest run convex` (Convex).

---

## Scope boundary
- **In scope:** `marked_skips` table + CRUD; engine `markedSkips` staleness-pause; `fetchScoringInputs`/`recompute` wiring; the proactive "Rest day" toggle on the Today Strip training pill.
- **Deferred to Plan 6 (catch-up sheet):** the *retroactive* per-pillar "mark skipped" UI for sleep/weight/nutrition/wellness — that table + engine support ships here so Plan 6 only adds the UI affordance.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `convex/schema.ts` | `marked_skips` table | Modify |
| `convex/markedSkips.ts` | `setSkip` / `clearSkip` mutations, `skipsForDate` query | **Create** |
| `convex/fightFormScore_internal.ts` | fetch marked skips → `markedSkips` on inputs | Modify |
| `convex/fightFormScore.ts` | thread `markedSkips` into `scoringInputs` | Modify |
| `src/scoring/types.ts` | `ScoringInputs.markedSkips` | Modify |
| `src/scoring/staleness.ts` | fold skip dates into `lastLogDates` | Modify |
| `src/scoring/__tests__/staleness.test.ts` | skip-recency tests | Modify |
| `src/scoring/__tests__/compose.test.ts` | skip-pauses-decay integration test | Modify |
| `convex/__tests__/markedSkips.test.ts` | CRUD + recompute wiring | **Create** |
| `src/components/dashboard/TodayStrip.tsx` | "Rest day" toggle on training pill | Modify |
| `src/pages/Dashboard.tsx` | wire the rest-day mutation callback | Modify |

---

## Task 1: `marked_skips` table + Convex CRUD

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/markedSkips.ts`
- Test: `convex/__tests__/markedSkips.test.ts`

- [ ] **Step 1: Add the table to `convex/schema.ts`**

Add a new table definition (near the other per-day log tables):

```ts
  // Intentional non-logging. A row means "the user deliberately skipped this
  // pillar on this date" — distinct from a silent missing log. The engine
  // treats a skip as recency for that pillar (pauses staleness decay) and the
  // catch-up sheet won't nag about it. Training rest is recorded separately as
  // a fight_camp_calendar `sessionType:"Rest"` row, so it is NOT a pillar here.
  marked_skips: defineTable({
    userId: v.id("users"),
    date: v.string(),
    pillar: v.union(
      v.literal("sleep"),
      v.literal("weight"),
      v.literal("nutrition"),
      v.literal("wellness"),
    ),
  }).index("by_user_date", ["userId", "date"])
    .index("by_user_date_pillar", ["userId", "date", "pillar"]),
```

- [ ] **Step 2: Write the failing CRUD test**

Create `convex/__tests__/markedSkips.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
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

describe("marked_skips CRUD", () => {
  it("setSkip creates a row, is idempotent, and skipsForDate returns it", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });

    await asUser.mutation(api.markedSkips.setSkip, { date: "2026-05-10", pillar: "sleep" });
    await asUser.mutation(api.markedSkips.setSkip, { date: "2026-05-10", pillar: "sleep" }); // idempotent

    const rows = await t.run(async (ctx) =>
      ctx.db.query("marked_skips").withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", "2026-05-10")).collect(),
    );
    expect(rows.length).toBe(1);

    const skips = await asUser.query(api.markedSkips.skipsForDate, { date: "2026-05-10" });
    expect(skips).toContain("sleep");
  });

  it("clearSkip removes the row", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });

    await asUser.mutation(api.markedSkips.setSkip, { date: "2026-05-10", pillar: "weight" });
    await asUser.mutation(api.markedSkips.clearSkip, { date: "2026-05-10", pillar: "weight" });

    const skips = await asUser.query(api.markedSkips.skipsForDate, { date: "2026-05-10" });
    expect(skips).not.toContain("weight");
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (`api.markedSkips` doesn't exist).

Run: `npx vitest run convex/__tests__/markedSkips.test.ts 2>&1 | tail -20`

- [ ] **Step 4: Implement `convex/markedSkips.ts`**

Match the `convex/sleep_logs.ts` pattern (auth via `requireUserId`, upsert, fire-and-forget `scheduleRecompute`).

```ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUserId } from "./lib/auth";

const PILLAR = v.union(
  v.literal("sleep"),
  v.literal("weight"),
  v.literal("nutrition"),
  v.literal("wellness"),
);

export const setSkip = mutation({
  args: { date: v.string(), pillar: PILLAR },
  handler: async (ctx, { date, pillar }) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("marked_skips")
      .withIndex("by_user_date_pillar", (q) =>
        q.eq("userId", userId).eq("date", date).eq("pillar", pillar),
      )
      .unique();
    if (!existing) {
      await ctx.db.insert("marked_skips", { userId, date, pillar });
    }
    try {
      await ctx.runMutation(internal.fightFormScore.scheduleRecompute, { userId, date });
    } catch (err) {
      console.warn("fight-form recompute schedule failed", err);
    }
  },
});

export const clearSkip = mutation({
  args: { date: v.string(), pillar: PILLAR },
  handler: async (ctx, { date, pillar }) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("marked_skips")
      .withIndex("by_user_date_pillar", (q) =>
        q.eq("userId", userId).eq("date", date).eq("pillar", pillar),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    try {
      await ctx.runMutation(internal.fightFormScore.scheduleRecompute, { userId, date });
    } catch (err) {
      console.warn("fight-form recompute schedule failed", err);
    }
  },
});

export const skipsForDate = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("marked_skips")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date))
      .collect();
    return rows.map((r) => r.pillar);
  },
});
```

- [ ] **Step 5: Run the test — expect PASS**, then the convex suite.

Run: `npx vitest run convex/__tests__/markedSkips.test.ts 2>&1 | tail -15` (PASS)
Run: `npx vitest run convex 2>&1 | tail -12` (all pass except the known pre-existing `extractCandidates` failure)

- [ ] **Step 6: Typecheck + stage**

Run: `npx tsc --noEmit 2>&1 | grep -i "convex/markedSkips\|convex/schema" | head` (expect none)

```bash
git add convex/schema.ts convex/markedSkips.ts convex/__tests__/markedSkips.test.ts
```

Suggested commit message: `feat(convex): add marked_skips table + set/clear/query for intentional skips`

---

## Task 2: Engine — a marked skip pauses staleness decay

**Files:**
- Modify: `src/scoring/types.ts`, `src/scoring/staleness.ts`
- Test: `src/scoring/__tests__/staleness.test.ts`, `src/scoring/__tests__/compose.test.ts`

A marked skip means "this gap is intentional." The engine treats a skip date as recency for that pillar, so `staleDaysFor` measures from the skip (not the last real log) — pausing decay and keeping the pillar's last-known value authoritative. It does NOT fabricate a value: if the pillar has no real data in its window as-of the last real log, it still cold-starts out.

- [ ] **Step 1: Add `markedSkips` to `ScoringInputs` (`types.ts`)**

After the `restDays?` field:

```ts
  /**
   * Dates the user explicitly marked as skipped, per pillar (sleep/weight/
   * nutrition/wellness). A skip counts as recency for that pillar — staleness
   * decay is paused (the gap is intentional, not forgotten) — but it does not
   * fabricate a value. Optional; absent in legacy callers.
   */
  markedSkips?: ReadonlyArray<{ date: string; pillar: SubScoreKey }>;
```

- [ ] **Step 2: Write the failing staleness test**

In `src/scoring/__tests__/staleness.test.ts`, add to the `lastLogDates` describe block:

```ts
  it("treats a marked skip as recency for its pillar (pauses staleness)", () => {
    const inputs = emptyInputs();
    inputs.sleepHours = [{ date: "2026-05-03", hours: 8 }]; // last real log 7 days before asOf
    inputs.markedSkips = [{ date: "2026-05-09", pillar: "sleep" }]; // skipped 1 day before asOf (2026-05-10)
    const last = lastLogDates(inputs);
    expect(last.sleep).toBe("2026-05-09"); // skip is more recent than the real log
  });

  it("ignores a skip for a different pillar", () => {
    const inputs = emptyInputs();
    inputs.sleepHours = [{ date: "2026-05-03", hours: 8 }];
    inputs.markedSkips = [{ date: "2026-05-09", pillar: "weightCut" }];
    const last = lastLogDates(inputs);
    expect(last.sleep).toBe("2026-05-03"); // unaffected by a weightCut skip
  });
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx vitest run src/scoring/__tests__/staleness.test.ts -t "marked skip" 2>&1 | tail -15`

- [ ] **Step 4: Implement in `staleness.ts`**

Update `lastLogDates` so each pillar's recency also folds in any marked-skip dates for that pillar. Replace the `lastLogDates` body's per-pillar `maxDate([...])` calls so each includes the skip dates:

```ts
export function lastLogDates(inputs: ScoringInputs): Record<SubScoreKey, string | null> {
  const skipsFor = (key: SubScoreKey): string[] =>
    (inputs.markedSkips ?? []).filter((s) => s.pillar === key).map((s) => s.date);
  return {
    trainingLoad: maxDate([
      ...inputs.sessions.map((s) => s.date),
      ...((inputs.restDays ?? []) as string[]),
      ...skipsFor("trainingLoad"),
    ]),
    sleep: maxDate([...inputs.sleepHours.map((s) => s.date), ...skipsFor("sleep")]),
    weightCut: maxDate([...inputs.weights.map((w) => w.date), ...skipsFor("weightCut")]),
    wellness: maxDate([...inputs.hooperByDate.map((h) => h.date), ...skipsFor("wellness")]),
    nutritionAdherence: maxDate([...inputs.meals.map((m) => m.date), ...skipsFor("nutritionAdherence")]),
    recovery: inputs.healthSignals ? inputs.date : null,
  };
}
```

- [ ] **Step 5: Run staleness tests — expect PASS**

Run: `npx vitest run src/scoring/__tests__/staleness.test.ts 2>&1 | tail -15`

- [ ] **Step 6: Add a compose integration test (skip pauses decay)**

In `src/scoring/__tests__/compose.test.ts`, add before the final `});`:

```ts
  describe("marked skip pauses staleness decay", () => {
    it("a recent skip keeps a pillar's value from decaying", () => {
      // Sleep logged strong (8h) but the freshest real log is 8 days before
      // `date` → would decay. A skip yesterday makes the gap intentional.
      const staleSleep = Array.from({ length: 7 }, (_, i) => {
        const d = new Date("2026-04-23"); d.setDate(d.getDate() - i);
        return { date: d.toISOString().slice(0, 10), hours: 8 };
      });
      const decayed = computeFightFormScore(baseInputs({ sleepHours: staleSleep }), ScoringConfigV1);
      const withSkip = computeFightFormScore(
        baseInputs({ sleepHours: staleSleep, markedSkips: [{ date: "2026-04-30", pillar: "sleep" }] }),
        ScoringConfigV1,
      );
      // The skip (1 day before `date`) resets recency → no decay → higher value.
      expect(withSkip.subScores.sleep.value).toBeGreaterThan(decayed.subScores.sleep.value);
      expect(withSkip.subScores.sleep.value).toBeGreaterThanOrEqual(99);
    });
  });
```

- [ ] **Step 7: Run — expect PASS, then full scoring suite**

Run: `npx vitest run src/scoring/__tests__/compose.test.ts -t "marked skip pauses" 2>&1 | tail -15` (PASS)
Run: `npx vitest run src/scoring 2>&1 | tail -12` (all pass)

- [ ] **Step 8: Typecheck + stage**

Run: `npx tsc --noEmit 2>&1 | grep -i "src/scoring" | head` (none)

```bash
git add src/scoring/types.ts src/scoring/staleness.ts src/scoring/__tests__/staleness.test.ts src/scoring/__tests__/compose.test.ts
```

Suggested commit message: `feat(scoring): a marked skip pauses staleness decay for its pillar`

---

## Task 3: Feed `markedSkips` through Convex into the engine

**Files:**
- Modify: `convex/fightFormScore_internal.ts`, `convex/fightFormScore.ts`
- Test: `convex/__tests__/markedSkips.test.ts`

`marked_skips` rows store user-facing pillar names (`sleep`/`weight`/`nutrition`/`wellness`); the engine wants `SubScoreKey` (`sleep`/`weightCut`/`nutritionAdherence`/`wellness`). Map in `fetchScoringInputs`.

- [ ] **Step 1: Failing end-to-end test**

Add to `convex/__tests__/markedSkips.test.ts`:

```ts
import { internal } from "../_generated/api";

describe("marked skips flow into scoring inputs", () => {
  it("fetchScoringInputs maps skip pillars to SubScoreKey", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("marked_skips", { userId, date: "2026-05-10", pillar: "weight" });
      await ctx.db.insert("marked_skips", { userId, date: "2026-05-10", pillar: "nutrition" });
    });
    const inputs = await t.query(internal.fightFormScore_internal.fetchScoringInputs, {
      userId, date: "2026-05-10",
    });
    expect(inputs.markedSkips).toBeDefined();
    const byPillar = inputs.markedSkips!.map((s) => s.pillar);
    expect(byPillar).toContain("weightCut");          // "weight" → weightCut
    expect(byPillar).toContain("nutritionAdherence"); // "nutrition" → nutritionAdherence
    expect(byPillar).not.toContain("weight");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`inputs.markedSkips` undefined).

Run: `npx vitest run convex/__tests__/markedSkips.test.ts -t "maps skip pillars" 2>&1 | tail -20`

- [ ] **Step 3: Build `markedSkips` in `fetchScoringInputs`**

In `convex/fightFormScore_internal.ts`, near the other lookback queries, fetch skips for the target date (skips are per-day intent; the staleness pause only needs the relevant recent dates — query the same lookback window the other data uses for safety). Add:

```ts
    // Marked skips within the lookback window. Map user-facing pillar names to
    // the engine's SubScoreKey so a skip pauses the right pillar's staleness.
    const skipRows = await ctx.db
      .query("marked_skips")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", lookbackStartIso))
      .collect();
    const SKIP_PILLAR_TO_KEY: Record<string, "sleep" | "weightCut" | "nutritionAdherence" | "wellness"> = {
      sleep: "sleep",
      weight: "weightCut",
      nutrition: "nutritionAdherence",
      wellness: "wellness",
    };
    const markedSkips = skipRows
      .map((r) => ({ date: r.date, pillar: SKIP_PILLAR_TO_KEY[r.pillar] }))
      .filter((s): s is { date: string; pillar: "sleep" | "weightCut" | "nutritionAdherence" | "wellness" } => s.pillar != null);
```

(`lookbackStartIso` is the existing window-start string used by the other queries in this handler — confirm its name by reading the file; if it differs, use the same variable the sleep/weights queries use.)

Add `markedSkips,` to the `return { ... }` object.

- [ ] **Step 4: Thread into `recomputeForUserDate`**

In `convex/fightFormScore.ts`, in the `scoringInputs` object, after `priorCeilings: inputs.priorCeilings,` add:

```ts
      markedSkips: inputs.markedSkips,
```

- [ ] **Step 5: Run — expect PASS, then full convex suite**

Run: `npx vitest run convex/__tests__/markedSkips.test.ts 2>&1 | tail -15` (all pass)
Run: `npx vitest run convex 2>&1 | tail -12` (all pass except the known pre-existing failure)

- [ ] **Step 6: Typecheck + stage**

Run: `npx tsc --noEmit 2>&1 | grep -i "convex/fightFormScore" | head` (none)

```bash
git add convex/fightFormScore_internal.ts convex/fightFormScore.ts convex/__tests__/markedSkips.test.ts
```

Suggested commit message: `feat(convex): feed marked skips into scoring inputs (pillar-mapped)`

---

## Task 4: Proactive "Rest day" toggle on the Today Strip

**Files:**
- Modify: `src/components/dashboard/TodayStrip.tsx`
- Modify: `src/pages/Dashboard.tsx`

Training rest is recorded as a `fight_camp_calendar` `sessionType:"Rest"` row (the engine already reads it as `restDays`, and `loggedTodayBundle` already counts any calendar entry — including rest — as `training` logged). So this task is UI only: when training is not yet logged today, offer a one-tap "Rest day" that writes that row.

**READ FIRST:** Read `src/components/dashboard/TodayStrip.tsx` (the `PILLS` map + the `<Link>` pill render) and `src/pages/Dashboard.tsx` (where `<TodayStrip>` is rendered with `adherence`/`mealsLoggedToday`). Match the existing card/pill style, motion (`springs`), haptics (`triggerHaptic`), and `Icon` usage. Read `convex/fight_camp.ts` `createCalendarEntry` for the exact args.

- [ ] **Step 1: Add an optional rest-day callback to `TodayStrip`**

Extend `Props`:

```ts
type Props = {
  adherence: Adherence;
  mealsLoggedToday: boolean;
  /** Marks today as a rest day (writes a Rest calendar entry). Absent → control hidden. */
  onMarkRestDay?: () => void | Promise<void>;
};
```

Render a small, unobtrusive control **only when `onMarkRestDay` is provided AND `!logged.training`**: a quiet text/chip button beneath the pills row — e.g. `"· Rest day today?"` — styled with the muted `text-[11px]`/`tracking` tokens already used in the header. On tap: fire `triggerHaptic(ImpactStyle.Light)`, call `onMarkRestDay()`. Do not block; the reactive query flips the training pill to logged. Keep it visually minor (it must not compete with the pills). Follow the file's existing className idioms; do not introduce a new color.

- [ ] **Step 2: Wire it in `Dashboard.tsx`**

Add `const markRestDay = useMutation(api.fight_camp.createCalendarEntry);` (match the import style already used for other mutations in the file). Pass to `<TodayStrip ... onMarkRestDay={...} />`:

```tsx
onMarkRestDay={async () => {
  await markRestDay({
    date: liveTodayStr,
    sessionType: "Rest",
    // Provide the minimal required args per createCalendarEntry's signature
    // (read convex/fight_camp.ts) — e.g. intensity/durationMinutes/rpe defaults
    // appropriate for a rest day (0 duration, rpe 0). Use the same defaults the
    // training-calendar UI uses when it creates a Rest entry.
  });
}}
```

Read `createCalendarEntry`'s arg validator and supply exactly the required fields with rest-appropriate values (0 duration / 0 rpe / a "Rest" intensity). Use `liveTodayStr` (the same local-today string the dashboard already passes to `loggedTodayBundle`).

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit 2>&1 | grep -iE "TodayStrip|Dashboard" | head` (expect none)
Run: `npm run build 2>&1 | tail -15` (expect success)

- [ ] **Step 4: Live Playwright playthrough on `localhost:8080`** (REQUIRED)

Start the dev server (`npm run dev` — serves on 8080) if not running. Using the Playwright MCP tools:
1. `browser_navigate` to `http://localhost:8080`, sign in / reach the dashboard (use an existing test/dev session if available; if auth blocks, report what's needed).
2. `browser_snapshot` the Today Strip; confirm the "Rest day" control appears when training is NOT logged.
3. `browser_click` the rest-day control.
4. Wait for the reactive update; `browser_snapshot` again and confirm the **training pill flips to logged** (recovery-green / check badge) and the done-count increments.
5. `browser_take_screenshot` before and after for the report.
6. Confirm the control hides once training is logged.

If the dev server isn't reachable or auth can't be satisfied in this environment, STOP and report exactly what blocked the playthrough (do not claim it passed without observing it).

- [ ] **Step 5: Stage**

```bash
git add src/components/dashboard/TodayStrip.tsx src/pages/Dashboard.tsx
```

Suggested commit message: `feat(dashboard): one-tap Rest day toggle on the Today Strip training pill`

---

## Task 5: Full verification

- [ ] **Step 1:** `npx vitest run 2>&1 | tail -20` — all pass except the known pre-existing `extractCandidates` failure. Report counts.
- [ ] **Step 2:** `npx tsc --noEmit 2>&1 | tail -30` — no new errors.
- [ ] **Step 3:** Report the Playwright observations (with screenshots) and final staged file list.

---

## Self-Review

**Spec coverage (design doc §1.1, §6):**
- §1.1 `marked_skips` table + training `status` → table created (Task 1); training rest uses the existing `fight_camp_calendar` "Rest" row rather than a new status column (documented choice — the engine already consumes it). ✓
- §6 proactive "Rest day" toggle → Task 4. ✓
- §6 scoring semantics (skip ≠ silent missing; pauses staleness) → Task 2 + Task 3. ✓
- §6 retroactive per-pillar skip UI → **deferred to Plan 6** (catch-up sheet); the data + engine support ships here so Plan 6 only adds the affordance. (Flagged.)

**Placeholder scan:** The UI task intentionally defers exact `createCalendarEntry` args and pixel styling to the implementer (who must read the component + mutation), with Playwright as the behavioral gate — this is guidance for a design-sensitive change, not a code placeholder in a logic task.

**Type/contract consistency:** `markedSkips` is `{date, pillar: SubScoreKey}` in `ScoringInputs`; `fetchScoringInputs` maps the table's user-facing pillar → `SubScoreKey` before emitting; `lastLogDates` folds skip dates per `SubScoreKey`. `setSkip`/`clearSkip`/`skipsForDate` pillar union matches the table.

**Risk:** The UI task can't be unit-TDD'd (no component test harness); Playwright is the verification gate per project rule. If auth blocks Playwright in this environment, that's a hard stop to surface, not a silent pass.

---

## Execution Handoff

Saved to `docs/superpowers/plans/2026-06-03-rest-skip-markers.md`. Execute via subagent-driven-development; implementers stage only. Task 4 needs a live Playwright run on `localhost:8080`.
