# Rolling 7-Day Completeness Meter Implementation Plan (Plan 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the missing "streak" with a forgiving momentum mechanic — a slim 7-segment meter showing how completely the user logged each of the last 7 days, that dips gracefully on a miss (6/7, not reset-to-0) and surfaces which days/pillars are incomplete.

**Architecture:** One Convex query (`weeklyCompleteness`) aggregates per-day, per-pillar logged state over the trailing 7 days (mirroring `loggedTodayBundle`'s per-pillar logic, extended to 5 pillars incl. meals, and marking rest/skip days). One dashboard component (`CompletenessMeter`) renders the 7 notches (green=full / gold=partial / hollow=gap / dash=rest-or-skip) + a "N of last 7 days logged" label; tapping a notch expands a small day-detail with chips linking to the missing pillars' log pages. No streak, no reset.

**Tech Stack:** Convex (+`convex-test`), React + Tailwind/motion, Playwright (`localhost:8080`).

**Project note on commits:** Owner commits manually; tools never run `git commit`. "Stage" = `git add`.

**Prereqs:** Plans 1–4 done. `marked_skips` table exists (Plan 3). `loggedTodayBundle` (per-pillar today logic) and `calibrationProgress` (7-day aggregation pattern) exist in `convex/fightFormScore.ts`.

**Validation:** the UI task ends with a live Playwright playthrough on `http://localhost:8080`; blocked = honest report, never faked.

---

## Verified patterns
- **Per-pillar "logged today"** (`loggedTodayBundle`, `convex/fightFormScore.ts:55`): weight=`weight_logs` row exists; sleep=`sleep_logs`; wellness=`daily_wellness_checkins`; training=`gym_sessions` with `status==="completed"` OR ANY `fight_camp_calendar` entry (incl. rest). Uses `optionalUserId`, `todayInUtc()`.
- **Meals** are NOT in `loggedTodayBundle` (dashboard tracks `mealsLoggedToday` separately); the meter's 5th pillar = `meals` table has a row for the date.
- **7-day window** (`calibrationProgress`, ~line 120): `end = new Date(date+"T00:00:00Z")`, `sevenStart = end − 6 days`, `Promise.all` of per-table `gte(lookbackIso)` queries.
- **Dashboard** renders `<TodayStrip>` at `src/pages/Dashboard.tsx` (the Fight Form branch); placement for the meter is directly above/below it.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `convex/fightFormScore.ts` | `weeklyCompleteness` query | Modify (add export) |
| `convex/__tests__/weeklyCompleteness.test.ts` | query coverage | **Create** |
| `src/components/dashboard/CompletenessMeter.tsx` | the 7-notch meter + day-detail | **Create** |
| `src/pages/Dashboard.tsx` | render the meter + wire the query | Modify |

---

## Task 1: `weeklyCompleteness` query

**Files:**
- Modify: `convex/fightFormScore.ts`
- Test: `convex/__tests__/weeklyCompleteness.test.ts`

Returns the trailing 7 days (oldest→newest), each with per-pillar logged flags, a count, a derived status, and a `weekday` label. A day is `rest` when it has NO real logs but DOES have a rest entry (`fight_camp_calendar` sessionType "rest") or any `marked_skips` row.

- [ ] **Step 1: READ** `loggedTodayBundle` + `calibrationProgress` + the `optionalUserId`/`todayInUtc` imports at the top of `convex/fightFormScore.ts`. Confirm the `meals` and `marked_skips` tables' `by_user_date` indexes.

- [ ] **Step 2: Failing test** — create `convex/__tests__/weeklyCompleteness.test.ts`:

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

describe("weeklyCompleteness", () => {
  it("returns 7 days oldest→newest with per-pillar flags, count and status", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });
    const today = "2026-05-15";

    await t.run(async (ctx) => {
      // Fully logged day: 2026-05-15 (all 5 pillars)
      await ctx.db.insert("weight_logs", { userId, date: today, weightKg: 80 } as any);
      await ctx.db.insert("sleep_logs", { userId, date: today, hours: 8 } as any);
      await ctx.db.insert("daily_wellness_checkins", { userId, date: today, hooperIndex: 5 } as any);
      await ctx.db.insert("gym_sessions", { userId, date: today, status: "completed", durationMinutes: 45, perceivedFatigue: 6 } as any);
      const mealId = await ctx.db.insert("meals", { userId, date: today, mealType: "lunch", mealName: "x" } as any);
      void mealId;
      // Partial day: 2026-05-14 (only sleep)
      await ctx.db.insert("sleep_logs", { userId, date: "2026-05-14", hours: 7 } as any);
      // Rest day: 2026-05-13 (no real logs, a rest calendar entry)
      await ctx.db.insert("fight_camp_calendar", { userId, date: "2026-05-13", sessionType: "Rest", intensity: "Rest", durationMinutes: 0, rpe: 0 } as any);
    });

    const days = await asUser.query(api.fightFormScore.weeklyCompleteness, { date: today });
    expect(days).toHaveLength(7);
    expect(days[6].date).toBe(today);          // newest last
    expect(days[0].date).toBe("2026-05-09");   // 7 days span

    const d15 = days[6];
    expect(d15.count).toBe(5);
    expect(d15.status).toBe("full");
    expect(d15.logged.weight).toBe(true);
    expect(d15.logged.meals).toBe(true);

    const d14 = days[5];
    expect(d14.count).toBe(1);
    expect(d14.status).toBe("partial");

    const d13 = days[4];
    expect(d13.status).toBe("rest");           // rest entry, no real logs
    expect(d13.count).toBe(0);

    const d12 = days[3];
    expect(d12.status).toBe("none");           // nothing
  });
});
```

(NOTE: training counts a `fight_camp_calendar` entry as logged — so the rest day at 2026-05-13 ALSO ticks training. Decide the precedence: a day with ONLY a rest entry (no weight/sleep/wellness/meals/real-session) is `rest`, NOT `partial`. Implement that precedence; if the test's rest-day expectation needs the count to be 0, ensure a lone rest entry does not inflate `count`/`logged.training` — i.e. compute `restOrSkip` first and, when the only "training" signal is a rest entry and nothing else is logged, classify the day `rest` with count 0. If you choose to count a rest entry as training-logged, adjust the test to `status: "rest"` with `logged.training: true` and document the choice. Pick the cleaner model and make the test assert it.)

- [ ] **Step 3:** Run → FAIL. `npx vitest run convex/__tests__/weeklyCompleteness.test.ts 2>&1 | tail -25`

- [ ] **Step 4: Implement `weeklyCompleteness`** in `convex/fightFormScore.ts`:

```ts
export const weeklyCompleteness = query({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const userId = await optionalUserId(ctx);
    if (!userId) return null;
    const targetDate = date ?? todayInUtc();
    const end = new Date(targetDate + "T00:00:00Z");
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    const startIso = start.toISOString().slice(0, 10);

    const [weights, sleep, wellness, sessions, calendar, meals, skips] = await Promise.all([
      ctx.db.query("weight_logs").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("sleep_logs").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("daily_wellness_checkins").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("gym_sessions").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("fight_camp_calendar").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("meals").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
      ctx.db.query("marked_skips").withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", startIso)).collect(),
    ]);

    const has = (rows: Array<{ date: string }>, d: string) => rows.some((r) => r.date === d);
    const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const dd = new Date(end);
      dd.setUTCDate(dd.getUTCDate() - i);
      const d = dd.toISOString().slice(0, 10);

      const restEntry = calendar.some((c) => c.date === d && (c.sessionType ?? "").toLowerCase() === "rest");
      const realSession =
        sessions.some((s) => s.date === d && s.status === "completed") ||
        calendar.some((c) => c.date === d && (c.sessionType ?? "").toLowerCase() !== "rest");
      const logged = {
        weight: has(weights, d),
        training: realSession,
        sleep: has(sleep, d),
        wellness: has(wellness, d),
        meals: has(meals, d),
      };
      const count = Object.values(logged).filter(Boolean).length;
      const skipped = has(skips, d);

      let status: "full" | "partial" | "none" | "rest";
      if (count === 5) status = "full";
      else if (count > 0) status = "partial";
      else if (restEntry || skipped) status = "rest";
      else status = "none";

      days.push({ date: d, weekday: WEEKDAYS[dd.getUTCDay()], logged, count, total: 5, status });
    }
    return days;
  },
});
```

- [ ] **Step 5:** Run → PASS; then `npx vitest run convex 2>&1 | tail -12` (all pass except the known pre-existing failure). `npx tsc --noEmit 2>&1 | grep -i "convex/fightFormScore" | head` (none).

- [ ] **Step 6: Stage** — `git add convex/fightFormScore.ts convex/__tests__/weeklyCompleteness.test.ts`
Commit msg: `feat(convex): weeklyCompleteness query for the 7-day completeness meter`

---

## Task 2: `CompletenessMeter` component + dashboard placement

**Files:**
- Create: `src/components/dashboard/CompletenessMeter.tsx`
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: READ** `src/components/dashboard/TodayStrip.tsx` (for the card recipe, `func-recovery-green`, motion `springs`, `Icon`, haptics, the `PILLS` label/href/icon map — reuse the pillar→route mapping) and `src/pages/Dashboard.tsx` (where `<TodayStrip>` renders, and how queries are called — add `useQuery(api.fightFormScore.weeklyCompleteness, ...)`).

- [ ] **Step 2: Build `CompletenessMeter.tsx`.** Props: `days: WeeklyDay[] | null | undefined` (the query result type). Render:
  - A slim card (reuse `card-surface rounded-2xl` or render inline above TodayStrip — keep it visually lighter than the strip; a thin row is fine).
  - Header: `{fullOrPartialCount} of last 7 days logged` where the headline number counts days with `count > 0` OR status `rest` (i.e. "days you showed up"); keep the copy forgiving — NO "streak", NO reset language.
  - 7 notches (oldest→newest), one per day: color by status — `full`→`func-recovery-green`, `partial`→gold (`func-warning-yellow`), `rest`→a neutral dash/zzz (muted), `none`→hollow outline. Each notch is a button with `aria-label="{weekday}: {status}"` and the weekday initial beneath (small, muted), with today emphasized.
  - Tapping a notch toggles a small **day-detail** row below the meter: the selected day's 5 pillars as small chips (logged = green/check, missing = muted) — each MISSING pillar chip is a `<Link>` to that pillar's log route (reuse TodayStrip's pillar→href map; e.g. weight→/weight, training→/training-calendar, sleep→/sleep, wellness→/recovery, meals→/nutrition). Fire `triggerHaptic` on notch tap. (Prefilled-date backfill is Plan 6 — here the chip just routes to the log page.)
  - Honor `useReducedMotion`. Handle `null`/loading gracefully (render nothing or a skeleton row).

- [ ] **Step 3: Place in `Dashboard.tsx`.** In the Fight Form branch, add `const weekly = useQuery(api.fightFormScore.weeklyCompleteness, FEATURE_FLAGS.enableFightFormScore ? {} : "skip");` and render `<CompletenessMeter days={weekly} />` directly ABOVE `<TodayStrip>` (so the week's momentum sits above today's checklist). Match the existing spacing/stack.

- [ ] **Step 4: Typecheck + build** — `npx tsc --noEmit 2>&1 | grep -iE "CompletenessMeter|Dashboard" | head` (none); `npm run build 2>&1 | tail -6` (success).

- [ ] **Step 5: REQUIRED live Playwright on http://localhost:8080**
  - If browser lock: `pkill -f "mcp-chrome"` then retry navigate.
  - Navigate to `/dashboard`. `browser_snapshot` + `browser_take_screenshot` (`plan5-meter.png`). Confirm the meter renders above TodayStrip with 7 notches reflecting recent days (the dev account has several logged days → expect a mix of full/partial). `browser_click` a notch → confirm the day-detail expands with pillar chips; screenshot. 0 console errors.
  - Honest partial/blocked report if the dev server/browser can't be reached. Never fabricate.

- [ ] **Step 6: Stage** — `git add src/components/dashboard/CompletenessMeter.tsx src/pages/Dashboard.tsx`
Commit msg: `feat(dashboard): rolling 7-day completeness meter`

---

## Task 3: Full verification

- [ ] **Step 1:** `npx vitest run 2>&1 | tail -15` — all pass except the known pre-existing failure. Report counts.
- [ ] **Step 2:** `npx tsc --noEmit 2>&1 | tail -20` — none.
- [ ] **Step 3:** `npm run build 2>&1 | tail -5` — success.
- [ ] **Step 4:** Playwright screenshots + observations (meter rendered? notch tap expanded detail?) or precise blocker. Final staged file list.

---

## Self-Review

**Spec coverage (design doc §4):**
- 7-segment meter, color per status, "N of last 7 days logged", no streak/reset → Task 2. ✓
- Tap a notch → that day's detail with backfill entry points → Task 2 (routes to log pages; prefilled-date backfill is Plan 6). ✓
- Backed by a query over the 5 TodayStrip pillars → Task 1. ✓
- Rest/skip days shown distinctly (dash) → Task 1 status `rest` + Task 2 rendering. ✓

**Placeholder scan:** UI pixel details deferred to the implementer (read-the-component + Playwright gate), consistent with prior UI tasks. The query + status logic are concrete.

**Type/contract consistency:** the meter consumes the `weeklyCompleteness` row shape (`{date, weekday, logged{5}, count, total, status}`); the pillar→route map reuses TodayStrip's. `status` union (`full|partial|none|rest`) is shared between query and component.

**Risk:** the rest-vs-training precedence (a lone rest entry shouldn't read as "training logged / partial") is the one judgment call — Task 1 Step 2 forces the implementer to pick the cleaner model and assert it. The headline "days you showed up" count is intentionally forgiving (counts partial + rest), matching the anti-streak goal.

---

## Execution Handoff

Saved to `docs/superpowers/plans/2026-06-03-completeness-meter.md`. Execute via subagent-driven-development; implementers stage only. Task 2 requires a live Playwright attempt on `localhost:8080`.
