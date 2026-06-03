# Catch-Up Sheet Implementation Plan (Plan 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dismissible "Yesterday in 10 seconds" bottom sheet that appears on the first app-open of a new day when yesterday has gaps — showing ONLY the missing pillars, each with one-tap smart-prefill backfill or a "skip" marker. Soft gate: never blocks, per-day dismissal. Also lands the retroactive per-pillar skip UI deferred from Plan 3.

**Architecture:** A `catchUpSuggestions` Convex query returns yesterday's missing pillars + safe suggested values (sleep median, last weight). The `CatchUpSheet` (built on the existing `drawer.tsx` vaul primitive) renders the gaps with: one-tap confirm for sleep (median) and weight (last value, editable — never silently guessed), "open" deep-links for wellness/meals, and a per-pillar "skip" that calls Plan 3's `markedSkips.setSkip`. Backfill reuses existing `logSleep`/`logWeight` mutations (they already accept a `date`). Trigger + dismissal via localStorage day-gates, mirroring the existing confetti gate.

**Tech Stack:** Convex (+`convex-test`), React + vaul drawer + motion, Playwright (`localhost:8080`).

**Project note on commits:** Owner commits manually; tools never run `git commit`. "Stage" = `git add`.

**Prereqs:** Plans 1–5 done. `markedSkips.setSkip({date,pillar})` exists (Plan 3). `logSleep({date,hours})`, `logWeight({date,weightKg})` exist and accept past dates. `weeklyCompleteness` exists (Plan 5) — its per-day `logged` map can seed the "what's missing yesterday" logic, OR query directly.

**Validation note:** Per the owner's choice, live Playwright validation is deferred until the owner deploys the staged Convex functions (`npx convex dev`). UI tasks here verify with tsc + build, and a best-effort Playwright render-without-crash check; full interactive validation happens post-deploy.

---

## Verified facts
- **Backfill mutations** accept a date: `convex/sleep_logs.ts:46 logSleep({date,hours})`, `convex/weight_logs.ts:52 logWeight({date,weightKg})`. Wellness = `convex/wellness.ts:80 upsertCheckin({...})` (multi-field → deep-link, don't auto-fill). Meals = richer → deep-link to `/nutrition`.
- **Skip** = `api.markedSkips.setSkip({date, pillar})` where pillar ∈ sleep|weight|nutrition|wellness (Plan 3).
- **Bottom sheet primitive**: `src/components/ui/drawer.tsx` (vaul). Used by `TechniqueDetailSheet.tsx` etc. — match that usage.
- **Per-pillar "logged yesterday"**: reuse the `weeklyCompleteness` row for yesterday (`days[5]` when `days[6]` is today), or query per-table. Pillars: weight, training, sleep, wellness, meals.
- **Dismissal gate pattern**: `localStorage` day-key, like `today_log_celebrated_${yyyy-MM-dd}` in `TodayStrip.tsx`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `convex/fightFormScore.ts` | `catchUpSuggestions` query | Modify (add export) |
| `convex/__tests__/catchUpSuggestions.test.ts` | query coverage | **Create** |
| `src/components/dashboard/CatchUpSheet.tsx` | the sheet + trigger + backfill/skip | **Create** |
| `src/pages/Dashboard.tsx` | mount + trigger the sheet | Modify |

---

## Task 1: `catchUpSuggestions` query

**Files:**
- Modify: `convex/fightFormScore.ts`
- Test: `convex/__tests__/catchUpSuggestions.test.ts`

Returns, for a target date (the dashboard passes *yesterday*): which of the 5 pillars are unlogged AND not already skipped, plus safe suggestions (`suggestedSleepHours` = median of last 7 logged nights or null; `lastWeightKg` = most recent weigh-in or null).

- [ ] **Step 1: READ** `loggedTodayBundle` (per-pillar logic) + how `marked_skips` is queried (Plan 3) + the imports.

- [ ] **Step 2: Failing test** — create `convex/__tests__/catchUpSuggestions.test.ts`:

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

describe("catchUpSuggestions", () => {
  it("lists missing pillars for the date and suggests sleep median + last weight", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });
    const target = "2026-05-14"; // "yesterday"

    await t.run(async (ctx) => {
      // sleep history for the median (last 7 nights before/around target)
      await ctx.db.insert("sleep_logs", { userId, date: "2026-05-10", hours: 7 } as any);
      await ctx.db.insert("sleep_logs", { userId, date: "2026-05-11", hours: 8 } as any);
      await ctx.db.insert("sleep_logs", { userId, date: "2026-05-12", hours: 7 } as any);
      // a recent weigh-in (most recent before/at target)
      await ctx.db.insert("weight_logs", { userId, date: "2026-05-12", weightKg: 79 } as any);
      // target day: only wellness logged → weight/training/sleep/meals are missing
      await ctx.db.insert("daily_wellness_checkins", {
        userId, date: target, hooperIndex: 5, sleepQuality: 7, fatigueLevel: 3, sorenessLevel: 2, stressLevel: 2,
      } as any);
      // mark nutrition as skipped on target → must NOT appear as missing
      await ctx.db.insert("marked_skips", { userId, date: target, pillar: "nutrition" });
    });

    const r = await asUser.query(api.fightFormScore.catchUpSuggestions, { date: target });
    expect(r).not.toBeNull();
    expect(r!.date).toBe(target);
    expect(r!.missing).toContain("weight");
    expect(r!.missing).toContain("sleep");
    expect(r!.missing).toContain("training");
    expect(r!.missing).not.toContain("wellness");   // logged
    expect(r!.missing).not.toContain("nutrition");  // skipped
    expect(r!.suggestedSleepHours).toBeCloseTo(7, 5); // median of 7,8,7
    expect(r!.lastWeightKg).toBe(79);
  });

  it("returns empty missing when fully logged", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });
    const target = "2026-05-14";
    await t.run(async (ctx) => {
      await ctx.db.insert("weight_logs", { userId, date: target, weightKg: 80 } as any);
      await ctx.db.insert("sleep_logs", { userId, date: target, hours: 8 } as any);
      await ctx.db.insert("daily_wellness_checkins", { userId, date: target, hooperIndex: 5, sleepQuality: 7, fatigueLevel: 3, sorenessLevel: 2, stressLevel: 2 } as any);
      await ctx.db.insert("gym_sessions", { userId, date: target, status: "completed", durationMinutes: 45, perceivedFatigue: 6, sessionType: "BJJ", updatedAt: Date.now() } as any);
      await ctx.db.insert("meals", { userId, date: target, mealType: "lunch", mealName: "x", isAiGenerated: false } as any);
    });
    const r = await asUser.query(api.fightFormScore.catchUpSuggestions, { date: target });
    expect(r!.missing).toHaveLength(0);
  });
});
```

(If schema requires more non-optional fields on these inserts, READ the schema and add them — report which.)

- [ ] **Step 3:** Run → FAIL.

- [ ] **Step 4: Implement `catchUpSuggestions`** in `convex/fightFormScore.ts`:

```ts
export const catchUpSuggestions = query({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const userId = await optionalUserId(ctx);
    if (!userId) return null;
    const targetDate = date ?? todayInUtc();

    const at = async (table: "weight_logs" | "sleep_logs" | "daily_wellness_checkins" | "meals") =>
      ctx.db.query(table).withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", targetDate)).first();
    const [weight, sleep, wellness, meal] = await Promise.all([
      at("weight_logs"), at("sleep_logs"), at("daily_wellness_checkins"), at("meals"),
    ]);
    const sessions = await ctx.db.query("gym_sessions").withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", targetDate)).collect();
    const calendar = await ctx.db.query("fight_camp_calendar").withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", targetDate)).collect();
    const training = sessions.some((s) => s.status === "completed") || calendar.length > 0;
    const skips = await ctx.db.query("marked_skips").withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", targetDate)).collect();
    const skipped = new Set(skips.map((s) => s.pillar)); // sleep|weight|nutrition|wellness

    const logged: Record<"weight" | "training" | "sleep" | "wellness" | "nutrition", boolean> = {
      weight: weight != null, training, sleep: sleep != null, wellness: wellness != null, nutrition: meal != null,
    };
    // Map pillar key → marked_skips pillar name for the skip filter.
    const SKIP_NAME: Record<string, string> = { weight: "weight", sleep: "sleep", wellness: "wellness", nutrition: "nutrition" };
    const PILLARS = ["weight", "training", "sleep", "wellness", "nutrition"] as const;
    const missing = PILLARS.filter((p) => !logged[p] && !(SKIP_NAME[p] && skipped.has(SKIP_NAME[p])));

    // Sleep median over the trailing 7 nights up to targetDate.
    const sevenStart = new Date(targetDate + "T00:00:00Z"); sevenStart.setUTCDate(sevenStart.getUTCDate() - 6);
    const recentSleep = await ctx.db.query("sleep_logs")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", sevenStart.toISOString().slice(0, 10)).lte("date", targetDate))
      .collect();
    const hrs = recentSleep.map((s) => s.hours).sort((a, b) => a - b);
    const suggestedSleepHours = hrs.length ? hrs[Math.floor((hrs.length - 1) / 2)] : null;

    // Most recent weigh-in at or before targetDate.
    const priorWeights = await ctx.db.query("weight_logs")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).lte("date", targetDate))
      .collect();
    const lastWeightKg = priorWeights.length
      ? [...priorWeights].sort((a, b) => a.date.localeCompare(b.date))[priorWeights.length - 1].weightKg
      : null;

    return { date: targetDate, missing, suggestedSleepHours, lastWeightKg };
  },
});
```

(NOTE the median: for `[7,7,8]` sorted, index `floor((3-1)/2)=1` → `7`. For an even count it takes the lower-middle — fine for a suggestion. Adjust if your test expects the average; the test above expects `7`.)

- [ ] **Step 5:** Run → PASS; `npx vitest run convex 2>&1 | tail -12` (all pass except pre-existing); `npx tsc --noEmit 2>&1 | grep -i "convex/fightFormScore" | head` (none).

- [ ] **Step 6: Stage** — `git add convex/fightFormScore.ts convex/__tests__/catchUpSuggestions.test.ts`
Commit msg: `feat(convex): catchUpSuggestions query for the catch-up sheet`

---

## Task 2: `CatchUpSheet` component + trigger

**Files:**
- Create: `src/components/dashboard/CatchUpSheet.tsx`
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: READ** `src/components/ui/drawer.tsx` + one consumer (`src/components/skilltree/TechniqueDetailSheet.tsx`) for the open/close API; `TodayStrip.tsx` for tokens/icons/haptics + the pillar→route map; `convex/sleep_logs.ts`/`weight_logs.ts` for the mutation arg names; `src/pages/Dashboard.tsx` for `liveTodayStr` + how mutations/queries are wired.

- [ ] **Step 2: Build `CatchUpSheet.tsx`.** Props: `targetDate: string` (yesterday), `open: boolean`, `onOpenChange: (o:boolean)=>void`. Inside:
  - `const data = useQuery(api.fightFormScore.catchUpSuggestions, open ? { date: targetDate } : "skip")`.
  - Header: `Yesterday in 10 seconds` + a friendly subhead (`{data.missing.length} to tidy up`). A "Not now" / close affordance.
  - For each missing pillar render a row with a one-tap action:
    - **sleep** → a confirm chip `Slept ~{suggestedSleepHours ?? 7}h? Confirm` → `useMutation(api.sleep_logs.logSleep)({ date: targetDate, hours: suggestedSleepHours ?? 7 })`.
    - **weight** → a small numeric input prefilled with `lastWeightKg` (editable; NEVER auto-write without the user confirming) + a `Save` button → `logWeight({ date: targetDate, weightKg })`.
    - **training** → an `Open` link to `/training-calendar` (rich entry) + a `Rest day` quick action → write a Rest calendar entry via `api.fight_camp.createCalendarEntry` (date: targetDate, sessionType:"Rest", intensity:"Rest", durationMinutes:0, rpe:0) — mirrors Plan 3.
    - **wellness** → `Open` link to `/recovery/check-in`.
    - **nutrition** → `Open` link to `/nutrition`.
  - Each row also has a quiet secondary "Skip" affordance (a small `···` or "Skip" text) → for sleep/weight/nutrition/wellness call `useMutation(api.markedSkips.setSkip)({ date: targetDate, pillar })` (map training→ a Rest day instead, since training skips go through rest). On skip/confirm/save, the row collapses (the reactive `catchUpSuggestions` re-fetch drops it from `missing`). When `missing` becomes empty, show a tiny "All caught up" state and allow auto-close.
  - Use the `drawer.tsx` primitive (bottom sheet). Honor `useReducedMotion`. Fire `triggerHaptic`/`triggerHapticSuccess` appropriately. Match the dark card idioms.

- [ ] **Step 3: Trigger + dismissal in `Dashboard.tsx`.**
  - Compute `yesterday` = `liveTodayStr` minus 1 day (local).
  - On mount (a `useEffect`): read `localStorage.getItem("catchup_last_open")`. If it !== today AND not previously dismissed for this yesterday (`localStorage.getItem("catchup_dismissed_" + yesterday)` is null), set state `catchUpOpen = true` — but ONLY open if there are actually gaps. Practical approach: render `<CatchUpSheet targetDate={yesterday} open={catchUpOpen} onOpenChange=... />`; the sheet itself queries `catchUpSuggestions` and, if `missing.length === 0`, calls `onOpenChange(false)` immediately (so it never shows a pointless empty sheet). Set `localStorage.setItem("catchup_last_open", today)` once evaluated.
  - On close/dismiss: `localStorage.setItem("catchup_dismissed_" + yesterday, "1")` so it doesn't reappear that day.
  - Never block the dashboard: the drawer is dismissible (swipe / Not now / backdrop).

- [ ] **Step 4: Typecheck + build** — `npx tsc --noEmit 2>&1 | grep -iE "CatchUpSheet|Dashboard" | head` (none); `npm run build 2>&1 | tail -6` (success).

- [ ] **Step 5: Best-effort Playwright on http://localhost:8080** (full interactive validation is post-deploy per owner's choice)
  - `pkill -f "mcp-chrome"` if locked, then `browser_navigate` to `/dashboard`.
  - Confirm the dashboard renders without crashing and 0 *new* console errors (the `catchUpSuggestions` query may be undeployed → the sheet should gracefully not open / no-op, same as the meter). Screenshot `plan6-dashboard.png`.
  - Note in the report that interactive sheet validation requires the deployed query; do not fabricate an interactive pass.

- [ ] **Step 6: Stage** — `git add src/components/dashboard/CatchUpSheet.tsx src/pages/Dashboard.tsx`
Commit msg: `feat(dashboard): morning catch-up sheet with one-tap backfill + skip`

---

## Task 3: Full verification

- [ ] **Step 1:** `npx vitest run 2>&1 | tail -15` — all pass except the known pre-existing failure.
- [ ] **Step 2:** `npx tsc --noEmit 2>&1 | tail -20` — none.
- [ ] **Step 3:** `npm run build 2>&1 | tail -5` — success.
- [ ] **Step 4:** Report counts, the dashboard-renders-without-crash Playwright note, final staged files.

---

## Self-Review

**Spec coverage (design doc §5, §6 retroactive skip):**
- Morning trigger, only-the-gaps, per-day dismissal → Task 2 Step 3. ✓
- One-tap prefill: sleep (median confirm), weight (last value, editable — never silently guessed) → Task 2. ✓
- Heavier pillars (wellness/meals/training) → deep-link/open → Task 2. ✓
- Retroactive per-pillar "skip" markers (Plan 3 deferral) → Task 2 (calls `markedSkips.setSkip`; training→Rest entry). ✓
- Never blocks (dismissible drawer) → Task 2. ✓

**Placeholder scan:** UI pixel detail deferred to implementer + read-the-primitive, consistent with prior UI tasks; the query + trigger logic are concrete.

**Type/contract consistency:** `catchUpSuggestions` returns `{date, missing[], suggestedSleepHours, lastWeightKg}`, consumed by the sheet; backfill uses the verified `logSleep`/`logWeight` arg shapes; skip uses Plan 3's `setSkip` pillar union (sleep|weight|nutrition|wellness). Weight is confirm-to-save (no silent write), per spec.

**Risk:** weight must never be auto-written from a guess — Task 2 makes it an editable input with an explicit Save. Live interactive validation is deferred to post-deploy (owner's choice); tsc+build+unit tests gate correctness meanwhile.

---

## Execution Handoff

Saved to `docs/superpowers/plans/2026-06-03-catch-up-sheet.md`. Execute via subagent-driven-development; implementers stage only.
