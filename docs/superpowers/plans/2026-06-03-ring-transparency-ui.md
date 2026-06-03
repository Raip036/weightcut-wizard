# Ring Transparency UI Implementation Plan (Plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fight-score ring tell the truth about its data — surface confidence/staleness so the user always understands why the number is where it is. Render a confidence underlay + desaturation on the ring, a "holding on stale data" delta state, a "based on N of M signals" band in the sheet, stale-pillar copy, and handle the new `"stale"` state everywhere it's read.

**Architecture:** First expose the engine fields through the `getToday` query (they're persisted but not returned). Then thread `dataConfidence`/`dataAgeDays`/`activePillars`/`totalPillars`/`state:"stale"`/per-pillar `completeness` into the ring, delta banner, and sheet, and add a `"stale"` branch to the 9 consumers that switch/guard on score `state`. A small shared `isScoredState` helper keeps the consumer changes consistent (stale = a real, scored-but-dimmed state, not "no score").

**Tech Stack:** React + TypeScript, Convex (+`convex-test`), Vitest, Playwright (`localhost:8080`).

**Project note on commits:** Owner commits manually; tools never run `git commit`. "Stage" = `git add`.

**Prereqs:** Plans 1–3 complete. The score row persists `dataConfidence`/`dataAgeDays`/`activePillars`/`totalPillars`/`formMomentum` + per-pillar `completeness`, and `state` can be `"stale"`.

**Validation:** UI tasks MUST end with a live Playwright playthrough on `http://localhost:8080` (per project rule). A blocked browser/auth is a hard-stop to report, never a fabricated pass.

**Run tests:** `npx vitest run convex` / `npx vitest run` / `npx tsc --noEmit`.

---

## Key facts (verified)

- **`FightFormRing.tsx`** (`src/components/dashboard/`): `state` prop union is `"ok"|"calibrating"|"no_camp"|"paused"` — **missing `"stale"`**. SVG track circle ~line 396, score arc ~424 (color from `LABEL_STROKE[label]`), ghost arc ~407, `LABEL_RGB` ~line 49 (slate fallback exists), atmosphere/halo subcomponent ~356 (`haloPeak`/`particleCount`). Center content switch ~524 (`ok`/`calibrating`/`no_camp`/`paused`). Keyframes in `index.css` (`.ff-ring-*`, `score-bloom`, `unlock-bloom`).
- **`FightFormScoreSheet.tsx`**: derives calibrating internally (no `state` prop); carousel ~585; active `SubScoreCard` (weight>0) vs dashed `SubScorePlaceholderCard` "Log to unlock" ~648–664; placeholder style ~873.
- **`FightFormDeltaBanner.tsx`**: props `{delta, topDriver, topLimiter, onTap}`; returns `null` when `|delta| < 5`; up=green/topDriver, down=red/topLimiter.
- **`getToday`** (`convex/fightFormScore.ts` ~line 12): synthesized fallback + the real row read; the returned shape does **not** include `dataConfidence/dataAgeDays/activePillars/totalPillars/formMomentum`, and `subScores` may omit `completeness`. Dashboard reads it at `src/pages/Dashboard.tsx` ~line 160.
- **`state` consumers needing `"stale"`:** `FightFormInsightStrip.tsx` (exhaustive `if`-chain ~74–96 — no `stale`), `FightFormRing.tsx`, `AthleteHero.tsx` (136–143), `FightFormPanel.tsx` (73/95/101/115/212/219), `FightFormTrendSparkline.tsx` (26), `athleteRowHelpers.ts` (58/83), `athleteChartConfigs.ts` (90/91/177), `CoachDashboard.tsx` (58).
- **Tokens:** `--func-recovery-green: 35 197 153`; `--muted` / `--muted-foreground`; ring uses `rgb(var(--func-...))` and `LABEL_RGB` triplets; slate fallback `148,163,184` already referenced.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `convex/fightFormScore.ts` | `getToday` returns new fields | Modify |
| `convex/__tests__/fightFormScore_wiring.test.ts` | getToday return-shape test | Modify |
| `src/lib/fightFormState.ts` | `isScoredState` + stale copy helpers | **Create** |
| `src/components/dashboard/FightFormRing.tsx` | confidence track + desaturation + `"stale"` | Modify |
| `src/components/dashboard/FightFormDeltaBanner.tsx` | "held on stale data" state | Modify |
| `src/components/dashboard/FightFormScoreSheet.tsx` | confidence band + stale-pillar copy | Modify |
| `src/components/dashboard/FightFormInsightStrip.tsx` | `"stale"` headline branch | Modify |
| `src/pages/Dashboard.tsx` | pass new props through | Modify |
| coach consumers (5 files) | `"stale"` via `isScoredState` | Modify |
| `src/index.css` | (optional) stale desaturation keyframe | Modify |

---

## Task 1: Expose the new fields through `getToday`

**Files:**
- Modify: `convex/fightFormScore.ts`
- Test: `convex/__tests__/fightFormScore_wiring.test.ts`

- [ ] **Step 1: READ** `convex/fightFormScore.ts` `getToday` (~lines 12–48). Note both the synthesized "no row" fallback object AND the path that returns the real DB row (it may `return row` directly or map fields). Determine exactly what shape is returned.

- [ ] **Step 2: Failing test** — add to `convex/__tests__/fightFormScore_wiring.test.ts`:

```ts
describe("getToday exposes confidence/staleness fields", () => {
  it("returns dataConfidence, dataAgeDays, activePillars, totalPillars, formMomentum and per-pillar completeness", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });
    await t.run(async (ctx) => {
      await ctx.db.insert("fight_form_scores", {
        userId, date: "2026-05-15", rawScore: 70, displayedScore: 70,
        label: "sharpening", state: "stale", phase: "build",
        subScores: {
          trainingLoad: { value: 80, weight: 0.2, reason: "ok", completeness: 0.5 },
          sleep: { value: 90, weight: 0.2, reason: "ok", completeness: 1 },
          weightCut: { value: 75, weight: 0.25, reason: "ok", completeness: 0.8 },
          wellness: { value: 60, weight: 0.2, reason: "ok", completeness: 0.4 },
          nutritionAdherence: { value: 100, weight: 0.15, reason: "ok", completeness: 1 },
        },
        appliedCeiling: undefined, topDriver: "sleep", topLimiter: "wellness",
        algorithmVersion: "1.0.0", computedAt: Date.now(),
        dataConfidence: 0.62, dataAgeDays: 3, activePillars: 5, totalPillars: 5, formMomentum: 0,
      } as any);
    });
    const r = await asUser.query(api.fightFormScore.getToday, { date: "2026-05-15" } as any);
    expect(r.state).toBe("stale");
    expect(r.dataConfidence).toBeCloseTo(0.62, 5);
    expect(r.dataAgeDays).toBe(3);
    expect(r.activePillars).toBe(5);
    expect(r.totalPillars).toBe(5);
    expect(r.formMomentum).toBe(0);
    expect(r.subScores.sleep.completeness).toBe(1);
  });
});
```

(If `getToday` takes no `date` arg, drop it and seed the row at the server's "today"; READ the handler to match its arg signature.)

- [ ] **Step 3:** Run → expect FAIL (fields undefined / `state` not surfaced). `npx vitest run convex/__tests__/fightFormScore_wiring.test.ts -t "exposes confidence" 2>&1 | tail -25`

- [ ] **Step 4: Implement.** In `getToday`:
  - If it returns the row directly (`return row`), the new persisted fields already flow — but the **synthesized fallback** object (no-row case) must add `dataConfidence: 0, dataAgeDays: 0, activePillars: 0, totalPillars: 0, formMomentum: 0` so the shape is consistent. Add them.
  - If it maps fields explicitly into a return object, add the five fields (`row.dataConfidence ?? 0`, etc.) and ensure `subScores` is passed through with `completeness`.
  - Ensure the returned `state` type includes `"stale"` (it comes from the row; if there's an explicit return validator/type, widen it).

- [ ] **Step 5:** Run → PASS; then `npx vitest run convex 2>&1 | tail -12` (all pass except known pre-existing failure). Typecheck: `npx tsc --noEmit 2>&1 | grep -i "convex/fightFormScore" | head` (none).

- [ ] **Step 6: Stage** — `git add convex/fightFormScore.ts convex/__tests__/fightFormScore_wiring.test.ts`
Commit msg: `feat(convex): expose confidence/staleness fields on getToday`

---

## Task 2: `isScoredState` helper + handle `"stale"` in all consumers

**Files:**
- Create: `src/lib/fightFormState.ts`
- Modify: the 9 consumers (ring gets its own visual task; here we do the non-visual guards + InsightStrip copy)

The rule: **`"stale"` is a real, scored state** — show the (dimmed) number wherever `"ok"` shows it. Only exclude `"stale"` from places that specifically want *fresh* data (trend sparklines that would otherwise imply continuity).

- [ ] **Step 1: Create `src/lib/fightFormState.ts`**

```ts
export type FightFormState = "ok" | "calibrating" | "no_camp" | "paused" | "stale";

/** True when the row carries a real, displayable score (fresh OR stale). */
export function isScoredState(state: FightFormState | string | undefined | null): boolean {
  return state === "ok" || state === "stale";
}

/** Whether the score should be visually de-emphasised (built on stale/thin data). */
export function isStaleState(state: FightFormState | string | undefined | null): boolean {
  return state === "stale";
}
```

- [ ] **Step 2:** Update the guards. For each `=== "ok"` that gates *displaying a score / readiness*, replace with `isScoredState(state)`. Apply in: `AthleteHero.tsx` (136–143), `FightFormPanel.tsx` (73/95/101/212/219), `athleteRowHelpers.ts` (58/83), `athleteChartConfigs.ts` (90), `CoachDashboard.tsx` (58). Import `isScoredState`. For the **trend sparklines** (`FightFormTrendSparkline.tsx:26`, `FightFormPanel.tsx:115`, `athleteChartConfigs.ts:91`), KEEP excluding non-ok — but include stale: change `.filter(p => p.state === "ok")` to `.filter(p => isScoredState(p.state))` so stale days still plot (they're real scores). After each change, the dimming/“stale” *visual* is handled in the ring/panel tasks; here just stop dropping stale data.

- [ ] **Step 3:** `FightFormInsightStrip.tsx` — add a `"stale"` branch to the `if`-chain (~74–96), placed BEFORE the `state === "ok"` fall-through:

```tsx
  if (p.state === "stale") {
    return p.appliedCeiling
      ? `Score capped and running on older data — log ${limiterLabel} to refresh.`
      : `Score is based on older data — log today to refresh it.`;
  }
```

(Use the file's existing limiter-label variable; READ the surrounding code to match its naming and the copy tone.)

- [ ] **Step 4:** Typecheck — `npx tsc --noEmit 2>&1 | tail -30`. The widened union should now be fully handled; fix any remaining exhaustiveness error by importing/using `isScoredState`/adding the stale branch. Build: `npm run build 2>&1 | tail -8` (success).

- [ ] **Step 5: Stage** — the helper + all touched consumer files.
Commit msg: `feat(ui): handle 'stale' score state across ring consumers`

---

## Task 3: Confidence track + staleness desaturation on `FightFormRing`

**Files:** Modify `src/components/dashboard/FightFormRing.tsx`, `src/pages/Dashboard.tsx`, (optional) `src/index.css`.

- [ ] **Step 1: READ** `FightFormRing.tsx` fully (props, the SVG `<circle>` track + score arc, `LABEL_RGB`, the atmosphere subcomponent, the center-content state switch).

- [ ] **Step 2: Widen the `state` prop** to include `"stale"`. Add optional props:

```ts
  dataConfidence?: number;   // 0..1
  dataAgeDays?: number;
  activePillars?: number;
  totalPillars?: number;
```

- [ ] **Step 3: Confidence track underlay.** Behind the score arc, render the full track split into two arcs by the active fraction `f = totalPillars ? activePillars/totalPillars : 1`:
  - solid muted segment for `f` of the circumference (`stroke hsl(var(--muted))`),
  - a dashed faded segment for the remaining `(1−f)` (`stroke hsl(var(--muted-foreground) / 0.25)`, `strokeDasharray="2 4"`).
  Reuse the existing `strokeDasharray`/circumference math the score arc already uses. Only render the split when `isScoredState(state)` and `f < 1`; otherwise keep the existing single track. No new color.

- [ ] **Step 4: Staleness desaturation.** When `state === "stale"` OR `(dataAgeDays ?? 0) >= 2`:
  - reduce the score number opacity (e.g. `opacity-60`),
  - blend the score-arc stroke ~30% toward slate (use the existing slate fallback `148,163,184` — interpolate or swap the stroke to a `rgba` mix),
  - dampen the halo (pass a reduced `haloPeak`/`particleCount` to the atmosphere — reuse the `off_pace` tier regardless of label),
  - add a hairline subtext under the label: `as of {dataAgeDays}d ago` (only when `dataAgeDays >= 2`).
  Keep it "dimmed/resting", never red.

- [ ] **Step 5: `"stale"` center content.** In the center-content switch, treat `"stale"` like `"ok"` (show the number + label) but with the desaturation from Step 4 and the "as of Nd ago" line. Do NOT route it to the calibrating/paused branches.

- [ ] **Step 6: Wire props in `Dashboard.tsx`** — pass `dataConfidence`, `dataAgeDays`, `activePillars`, `totalPillars` from `ffScoreData` into `<FightFormRing>`.

- [ ] **Step 7: Typecheck + build** — `npx tsc --noEmit 2>&1 | grep -i "FightFormRing\|Dashboard" | head` (none); `npm run build 2>&1 | tail -8` (success).

- [ ] **Step 8: Live Playwright on :8080 (REQUIRED).** Navigate, reach the dashboard, snapshot the ring. If you can find/seed a stale score state, screenshot the desaturated ring + confidence split + "as of Nd ago". If the current account's score is fresh (`state:"ok"`), at minimum confirm the ring still renders correctly (no regression, 0 console errors) and screenshot it; report that the stale visual couldn't be exercised without a stale row. Honest partial report if blocked — never fabricate.

- [ ] **Step 9: Stage** — `git add src/components/dashboard/FightFormRing.tsx src/pages/Dashboard.tsx src/index.css`
Commit msg: `feat(ring): confidence track + staleness desaturation + stale state`

---

## Task 4: "Held on stale data" delta state

**Files:** Modify `src/components/dashboard/FightFormDeltaBanner.tsx`, `src/pages/Dashboard.tsx`.

When the score didn't move because a pillar was excluded/stale (not a real plateau), show a neutral "holding" chip instead of silence.

- [ ] **Step 1:** Add an optional prop `held?: { pillarLabel: string; sinceLabel?: string } | null` (or simpler: `staleHeld?: boolean` + the limiter label). When `held` is set AND `|delta| < 5`, render a neutral pause-style chip: `Holding at {score} · {pillarLabel} not logged{ sinceLabel ? " since "+sinceLabel : "" }` with a neutral glyph (`pauseOutline`/`removeOutline`) in `text-muted-foreground` — reuse the banner pill styling, no green/red caret. Keep the existing up/down behavior when there's real movement.

- [ ] **Step 2:** In `Dashboard.tsx`, compute `held` from `ffScoreData`: when `state === "stale"` (or `dataAgeDays >= 2`) and the day-over-day delta is small, pass the top-limiter's friendly label (+ optionally the stale-age). READ how the dashboard currently derives the delta/yesterday score for the banner and reuse it.

- [ ] **Step 3:** Typecheck + build (as above).

- [ ] **Step 4: Live Playwright** — same approach as Task 3 Step 8 (exercise if a stale state is reachable; else confirm no regression + report). Honest report.

- [ ] **Step 5: Stage**
Commit msg: `feat(ring): 'holding on stale data' delta-banner state`

---

## Task 5: Sheet confidence band + stale-pillar placeholder copy

**Files:** Modify `src/components/dashboard/FightFormScoreSheet.tsx`, `src/pages/Dashboard.tsx`.

- [ ] **Step 1: READ** the sheet's props + the carousel + `SubScorePlaceholderCard`.

- [ ] **Step 2: Pass `state`, `activePillars`, `totalPillars`** (and per-pillar `completeness` via `subScores`) into the sheet from the dashboard.

- [ ] **Step 3: Confidence band.** Above the "What's driving your score" header, render a compact band when `activePillars < totalPillars` OR `state === "stale"`:
  - `Based on {activePillars} of {totalPillars} signals` + a thin proportional bar,
  - one line: *"Pillars you haven't logged aren't counting toward today's number — your score isn't penalised, it's just based on less."*
  Style with `rounded-xs border border-border/40 bg-muted/15` (match the sheet's existing card idioms).

- [ ] **Step 4: Placeholder copy.** In `SubScorePlaceholderCard`, distinguish *never logged* from *stale*: if that pillar has a `completeness` of 0 but the sheet knows it was once logged (no clean signal today — use what's available; if only `completeness`/`weight` are known, keep "Log to unlock" but append the pillar's `reason` when it indicates staleness, e.g. starts with "Only"/"No"). Keep it minimal and truthful; do not invent a "last logged Nd ago" if the data isn't passed. (If you want the exact age, note it as a follow-up needing a per-pillar last-log date in the row — out of scope here.)

- [ ] **Step 5: Typecheck + build.**

- [ ] **Step 6: Live Playwright** — open the sheet (tap the ring / "Open Fight Form Score details" button), snapshot the carousel + confidence band. Exercise with whatever state the account has; screenshot. Honest report if a state can't be reached.

- [ ] **Step 7: Stage**
Commit msg: `feat(sheet): confidence band + truthful stale-pillar placeholder copy`

---

## Task 6: Full verification + playthrough summary

- [ ] **Step 1:** `npx vitest run 2>&1 | tail -20` — all pass except the known pre-existing `extractCandidates` failure. Report counts.
- [ ] **Step 2:** `npx tsc --noEmit 2>&1 | tail -30` — zero errors (the widened `state` union must be fully handled everywhere).
- [ ] **Step 3:** `npm run build 2>&1 | tail -8` — success.
- [ ] **Step 4:** Consolidated Playwright report: screenshots of the ring (fresh + stale if reachable), the sheet confidence band, and the delta banner; or precise notes on what state could/couldn't be exercised. Final staged file list.

---

## Self-Review

**Spec coverage (design doc §3):**
- Confidence track underlay → Task 3. ✓
- Staleness desaturation + "as of Nd ago" → Task 3. ✓
- "Held" delta state → Task 4. ✓
- Sheet confidence band ("based on N of M signals", excluded≠penalised) → Task 5. ✓
- Stale-pillar placeholder copy → Task 5 (truthful; exact "last logged Nd ago" needs a per-pillar last-log date on the row — flagged as a small follow-up, not invented). ✓
- Wake-up micro-animation (§3) → **deferred**: nice-to-have polish; not load-bearing for transparency. Flagged for a later polish pass to avoid over-scoping.
- Handle `"stale"` everywhere → Tasks 1 (query), 2 (consumers + helper), 3 (ring). ✓

**Placeholder scan:** UI tasks intentionally defer pixel-exact code to the implementer (read-the-component + Playwright gate) — consistent with Plan 3 Task 4. The `isScoredState` helper and InsightStrip branch are concrete.

**Type/contract consistency:** `getToday` (Task 1) returns the fields the ring/sheet/banner consume; `isScoredState` centralises the `"ok"|"stale"` predicate so every consumer agrees; the ring `state` prop union is widened to match the query.

**Risk:** widening the `state` union forces exhaustiveness handling — Task 2 + Task 6 typecheck gates catch any missed consumer. The stale *visual* can only be fully eyeballed when a stale score row exists; Playwright steps say to exercise if reachable and honestly report otherwise.

---

## Execution Handoff

Saved to `docs/superpowers/plans/2026-06-03-ring-transparency-ui.md`. Execute via subagent-driven-development; implementers stage only. Tasks 3–5 require a live Playwright attempt on `localhost:8080`; a blocked run is reported, never faked.
