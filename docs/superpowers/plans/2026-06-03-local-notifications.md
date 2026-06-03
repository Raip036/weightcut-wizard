# Local Notifications Implementation Plan (Plan 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gently drive the logging habit with adaptive local notifications — reminders timed to each user's natural logging moment, hard-capped at 2/day, suppressed once a pillar is already logged, and gated behind a friendly onboarding pre-permission prompt so a cold iOS denial doesn't kill the whole feature.

**Architecture:** A pure scheduling planner (`reminderSchedule.ts`) decides WHICH reminders to fire and WHEN, from learned log-times + today's logged state + the 2/day cap — fully unit-testable. A thin Capacitor adapter (`reminderScheduler.ts`) generalises the existing `weightReminder.ts` to schedule the planner's output via `@capacitor/local-notifications` (already a dependency). A Convex query (`loggingTimeStats`) supplies per-pillar median log hours (from doc `_creationTime`). An onboarding step explains reminders before the iOS system permission prompt.

**Tech Stack:** Capacitor `@capacitor/local-notifications` (already used), Convex (+`convex-test`), React, Vitest.

**Project note on commits:** Owner commits manually; tools never run `git commit`. "Stage" = `git add`.

**Prereqs:** Plans 1–6 done. `src/lib/weightReminder.ts` shows the existing pattern (schedule/cancel by fixed id, `Capacitor.isNativePlatform()` gate, settings in localStorage). The onboarding wizard lives in `src/components/onboarding/wizard/` + `src/pages/Onboarding.tsx`.

**VALIDATION REALITY (read this):** Local notifications are a NATIVE iOS feature. They CANNOT be validated in this environment (no Xcode/device/Playwright path). Therefore:
- **Task 1 (pure planner) is fully unit-tested** — that's the real verification.
- **Tasks 2–3 (Capacitor adapter + onboarding step) are build/typecheck-verified only.** Actual notification delivery + the permission flow MUST be validated by the owner on a real iOS device (Xcode build → install → observe). Each native task ends by stating exactly what the owner must device-test. Do not claim native behavior works.

**Run tests:** `npx vitest run src/lib` / `npx vitest run convex`.

---

## Verified facts
- `@capacitor/local-notifications` is imported by `src/lib/weightReminder.ts` (schedule/cancel exist; the existing weight reminder uses fixed id 9001, `schedule: { on: { hour, minute }, every: "day" }`).
- `Capacitor.isNativePlatform()` gates native calls (web is a no-op).
- Onboarding: `src/pages/Onboarding.tsx` + `src/components/onboarding/wizard/*` (e.g. `ConnectHealthStep.tsx` — a step component pattern to mirror).
- Convex docs carry `_creationTime` (ms epoch) — usable as a proxy for "when the user logged".

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/lib/reminderSchedule.ts` | Pure planner: which reminders, when, capped/suppressed | **Create** |
| `src/lib/__tests__/reminderSchedule.test.ts` | Planner unit tests | **Create** |
| `convex/fightFormScore.ts` | `loggingTimeStats` query (median log hour per pillar) | Modify |
| `convex/__tests__/loggingTimeStats.test.ts` | query coverage | **Create** |
| `src/lib/reminderScheduler.ts` | Capacitor adapter (schedule planner output) | **Create** |
| `src/components/onboarding/wizard/ReminderStep.tsx` | pre-permission onboarding step | **Create** |
| `src/pages/Onboarding.tsx` (or wizard index) | insert the step | Modify |

---

## Task 1: Pure reminder planner (fully unit-tested)

**Files:**
- Create: `src/lib/reminderSchedule.ts`
- Test: `src/lib/__tests__/reminderSchedule.test.ts`

The planner is a pure function: given the learned per-pillar reminder time, which pillars are still unlogged today, whether the app was opened today, and config (the 2/day cap, defaults, the "fire N min early" offset), return the ordered list of notifications to schedule.

- [ ] **Step 1: Write the failing test** — create `src/lib/__tests__/reminderSchedule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planReminders, type ReminderPlanInput } from "../reminderSchedule";

const base = (over: Partial<ReminderPlanInput> = {}): ReminderPlanInput => ({
  learnedTimes: { weight: { hour: 7, minute: 30 }, sleep: { hour: 7, minute: 30 }, training: { hour: 19, minute: 0 }, wellness: { hour: 10, minute: 0 }, nutrition: null },
  loggedToday: { weight: false, sleep: false, training: false, wellness: false, nutrition: false },
  openedToday: false,
  config: { maxPerDay: 2, leadMinutes: 30 },
  ...over,
});

describe("planReminders", () => {
  it("suppresses reminders for pillars already logged today", () => {
    const out = planReminders(base({ loggedToday: { weight: true, sleep: true, training: false, wellness: false, nutrition: false } }));
    expect(out.some((n) => n.pillar === "weight")).toBe(false);
    expect(out.some((n) => n.pillar === "sleep")).toBe(false);
  });

  it("caps the number of scheduled reminders at maxPerDay", () => {
    const out = planReminders(base());
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it("fires leadMinutes BEFORE the learned time", () => {
    const out = planReminders(base({ loggedToday: { weight: false, sleep: true, training: true, wellness: true, nutrition: true } }));
    const w = out.find((n) => n.pillar === "weight");
    expect(w).toBeDefined();
    // 07:30 − 30min = 07:00
    expect(w!.hour).toBe(7);
    expect(w!.minute).toBe(0);
  });

  it("prefers earlier reminders when capping (morning weight/sleep before evening training)", () => {
    const out = planReminders(base());
    // With all unlogged and cap 2, the two EARLIEST learned times win.
    const hours = out.map((n) => n.hour).sort((a, b) => a - b);
    expect(hours[0]).toBeLessThanOrEqual(hours[1]);
    expect(out.length).toBe(2);
  });

  it("skips pillars with no learned time (nutrition null)", () => {
    const out = planReminders(base({ loggedToday: { weight: true, sleep: true, training: true, wellness: true, nutrition: false } }));
    expect(out.some((n) => n.pillar === "nutrition")).toBe(false);
  });

  it("schedules nothing when everything is logged", () => {
    const out = planReminders(base({ loggedToday: { weight: true, sleep: true, training: true, wellness: true, nutrition: true } }));
    expect(out).toHaveLength(0);
  });
});
```

- [ ] **Step 2:** Run → FAIL (`Cannot find module '../reminderSchedule'`).

- [ ] **Step 3: Implement `src/lib/reminderSchedule.ts`**:

```ts
export type ReminderPillar = "weight" | "sleep" | "training" | "wellness" | "nutrition";
export type ClockTime = { hour: number; minute: number };

export type ReminderPlanInput = {
  /** Learned natural log time per pillar (null = no signal → don't remind). */
  learnedTimes: Record<ReminderPillar, ClockTime | null>;
  loggedToday: Record<ReminderPillar, boolean>;
  openedToday: boolean;
  config: { maxPerDay: number; leadMinutes: number };
};

export type PlannedReminder = { pillar: ReminderPillar; hour: number; minute: number };

const PILLAR_COPY: Record<ReminderPillar, { title: string; body: string }> = {
  weight:   { title: "Morning weigh-in", body: "Step on the scale ⚖️" },
  sleep:    { title: "Log last night's sleep", body: "How'd you sleep? 😴" },
  training: { title: "Log today's training", body: "Tag your session 🥊" },
  wellness: { title: "Quick wellness check-in", body: "30 seconds — how do you feel?" },
  nutrition:{ title: "Log your meals", body: "Keep your nutrition on track 🍽️" },
};

export function reminderCopy(pillar: ReminderPillar) {
  return PILLAR_COPY[pillar];
}

function minusMinutes(t: ClockTime, mins: number): ClockTime {
  let total = t.hour * 60 + t.minute - mins;
  if (total < 0) total += 24 * 60;
  return { hour: Math.floor(total / 60) % 24, minute: total % 60 };
}

/**
 * Decide which reminders to schedule. Pure. Rules:
 * - skip pillars logged today (suppression) or with no learned time,
 * - fire `leadMinutes` before the learned time,
 * - cap at `maxPerDay`, keeping the EARLIEST candidates (so morning prompts
 *   win over an evening one when capped),
 * - returned ordered earliest→latest.
 */
export function planReminders(input: ReminderPlanInput): PlannedReminder[] {
  const { learnedTimes, loggedToday, config } = input;
  const PILLARS: ReminderPillar[] = ["weight", "sleep", "training", "wellness", "nutrition"];
  const candidates = PILLARS
    .filter((p) => !loggedToday[p] && learnedTimes[p] != null)
    .map((p) => {
      const fire = minusMinutes(learnedTimes[p]!, config.leadMinutes);
      return { pillar: p, hour: fire.hour, minute: fire.minute, sortKey: fire.hour * 60 + fire.minute };
    })
    .sort((a, b) => a.sortKey - b.sortKey);
  return candidates.slice(0, Math.max(0, config.maxPerDay)).map(({ pillar, hour, minute }) => ({ pillar, hour, minute }));
}
```

- [ ] **Step 4:** Run → PASS (all). `npx vitest run src/lib/__tests__/reminderSchedule.test.ts 2>&1 | tail -15`. Typecheck: `npx tsc --noEmit 2>&1 | grep -i "reminderSchedule" | head` (none).

- [ ] **Step 5: Stage** — `git add src/lib/reminderSchedule.ts src/lib/__tests__/reminderSchedule.test.ts`
Commit msg: `feat(reminders): pure planner for adaptive, capped, suppressed reminders`

---

## Task 2: `loggingTimeStats` query (learned times source)

**Files:**
- Modify: `convex/fightFormScore.ts`
- Test: `convex/__tests__/loggingTimeStats.test.ts`

Returns the median local-ish hour:minute the user tends to log each pillar, from the trailing ~14 days of rows' `_creationTime`. `null` per pillar when there's no signal.

- [ ] **Step 1: Failing test** — create `convex/__tests__/loggingTimeStats.test.ts` seeding a few `weight_logs`/`sleep_logs` and asserting `loggingTimeStats` returns a `{weight, sleep, training, wellness, nutrition}` object where logged pillars have `{hour, minute}` and unlogged are `null`. (Because `_creationTime` is set by Convex at insert and convex-test controls time loosely, assert structural shape + that a pillar with inserts is non-null and one without is null, rather than an exact hour. Seed via `t.run` inserts.)

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

async function seedUser(t: ReturnType<typeof convexTest>): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {} as any);
    await ctx.db.insert("profiles", { userId, age: 30, sex: "M", heightCm: 180, currentWeightKg: 80, goalWeightKg: 75, targetDate: "2026-12-01", activityLevel: "moderate", goalType: "weight_loss", role: "fighter", subscriptionTier: "pro" } as any);
    return userId;
  });
}

describe("loggingTimeStats", () => {
  it("returns a per-pillar median time (null when no signal)", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const asUser = t.withIdentity({ subject: userId });
    await t.run(async (ctx) => {
      await ctx.db.insert("weight_logs", { userId, date: "2026-05-10", weightKg: 80 } as any);
      await ctx.db.insert("weight_logs", { userId, date: "2026-05-11", weightKg: 80 } as any);
      await ctx.db.insert("sleep_logs", { userId, date: "2026-05-10", hours: 8 } as any);
    });
    const r = await asUser.query(api.fightFormScore.loggingTimeStats, {});
    expect(r).not.toBeNull();
    expect(r!.weight).not.toBeNull();
    expect(typeof r!.weight!.hour).toBe("number");
    expect(r!.nutrition).toBeNull();
  });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement `loggingTimeStats`** in `convex/fightFormScore.ts`. For each pillar table (weight_logs, sleep_logs, daily_wellness_checkins, gym_sessions+fight_camp_calendar for training, meals), collect rows from the last 14 days (by `date` index), read `_creationTime`, convert to hour:minute (UTC — document that it's a server-time proxy; per-user timezone refinement is a follow-up), take the median per pillar; `null` when no rows. Return `{ weight, sleep, training, wellness, nutrition }`.

```ts
export const loggingTimeStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await optionalUserId(ctx);
    if (!userId) return null;
    const since = new Date(Date.now()); // 14-day window by date string
    since.setUTCDate(since.getUTCDate() - 14);
    const sinceIso = since.toISOString().slice(0, 10);
    const collect = (table: any) =>
      ctx.db.query(table).withIndex("by_user_date", (q: any) => q.eq("userId", userId).gte("date", sinceIso)).collect();
    const [weights, sleep, wellness, sessions, calendar, meals] = await Promise.all([
      collect("weight_logs"), collect("sleep_logs"), collect("daily_wellness_checkins"),
      collect("gym_sessions"), collect("fight_camp_calendar"), collect("meals"),
    ]);
    const medianTime = (rows: Array<{ _creationTime: number }>): { hour: number; minute: number } | null => {
      if (!rows.length) return null;
      const mins = rows.map((r) => { const d = new Date(r._creationTime); return d.getUTCHours() * 60 + d.getUTCMinutes(); }).sort((a, b) => a - b);
      const m = mins[Math.floor((mins.length - 1) / 2)];
      return { hour: Math.floor(m / 60), minute: m % 60 };
    };
    return {
      weight: medianTime(weights),
      sleep: medianTime(sleep),
      training: medianTime([...sessions, ...calendar]),
      wellness: medianTime(wellness),
      nutrition: medianTime(meals),
    };
  },
});
```

- [ ] **Step 4:** Run → PASS; `npx vitest run convex 2>&1 | tail -12` (all pass except pre-existing); tsc clean for the file.

- [ ] **Step 5: Stage** — `git add convex/fightFormScore.ts convex/__tests__/loggingTimeStats.test.ts`
Commit msg: `feat(convex): loggingTimeStats — per-pillar median log time for adaptive reminders`

---

## Task 3: Capacitor adapter + onboarding pre-permission step (build-verified; device-test by owner)

**Files:**
- Create: `src/lib/reminderScheduler.ts`
- Create: `src/components/onboarding/wizard/ReminderStep.tsx`
- Modify: the onboarding wizard to include the step

- [ ] **Step 1: READ** `src/lib/weightReminder.ts` (the schedule/cancel/permission pattern), `src/components/onboarding/wizard/ConnectHealthStep.tsx` (a step's shape/props + how steps are registered in `Onboarding.tsx` / the wizard index), and `@capacitor/local-notifications`'s `requestPermissions`/`schedule` API as used.

- [ ] **Step 2: `src/lib/reminderScheduler.ts`** — generalise `weightReminder.ts`:
  - `requestReminderPermission(): Promise<boolean>` — calls `LocalNotifications.requestPermissions()`, returns granted. No-op `false` off-native.
  - `applyReminderPlan(plan: PlannedReminder[]): Promise<void>` — cancels the app's reminder id-range then schedules one daily notification per planned reminder (stable id per pillar, e.g. weight=9101…nutrition=9105) with `schedule: { on: { hour, minute }, every: "day" }`, title/body from `reminderCopy(pillar)`. Native-gated.
  - `syncAdaptiveReminders(input)` — given the planner input (assembled by the caller from `loggingTimeStats` + today's logged state + a user toggle), compute `planReminders(...)` and `applyReminderPlan(...)`. Respects a localStorage enable flag (default off until the user opts in via onboarding). Native-gated.
  - Export a `REMINDER_IDS` map so cancel covers all pillar ids.
  Keep it a thin imperative shell over the pure planner — NO scheduling decisions here.

- [ ] **Step 3: `ReminderStep.tsx`** — an onboarding step that, BEFORE triggering the iOS permission prompt, explains the value ("Two taps in the morning, one in the evening — we'll nudge you at the times you already log"). A primary "Turn on reminders" button → `requestReminderPermission()`; on grant, set the enable flag + call `syncAdaptiveReminders` (with sensible cold-start defaults since there's no history yet: weight/sleep 07:30, training 19:00, wellness 10:00). A "Maybe later" secondary that proceeds without enabling. Match the existing onboarding step styling/props.

- [ ] **Step 4: Register the step** in the onboarding wizard (mirror how `ConnectHealthStep` is included). Place it after the health-connect step (or wherever permissions cluster). Keep it skippable.

- [ ] **Step 5: Typecheck + build** — `npx tsc --noEmit 2>&1 | grep -iE "reminderScheduler|ReminderStep|Onboarding" | head` (none); `npm run build 2>&1 | tail -6` (success).

- [ ] **Step 6: DEVICE-TEST HANDOFF (owner).** State explicitly in the report that the following require an iOS device build (Xcode → run on device) and CANNOT be verified here:
  - the onboarding step shows and the iOS permission prompt appears on "Turn on reminders",
  - granting schedules the reminders; a reminder fires at the expected time,
  - re-opening the app / logging a pillar reschedules with that pillar suppressed,
  - the 2/day cap holds.
  Note any iOS config the owner may need (Info.plist already supports local notifications if the existing weight reminder works; flag if `pod install` / capabilities are needed for the generalised ids).

- [ ] **Step 7: Stage** — the three files.
Commit msg: `feat(reminders): Capacitor adapter + onboarding pre-permission step`

---

## Task 4: Full verification

- [ ] `npx vitest run 2>&1 | tail -15` — all pass except the known pre-existing failure (the planner + loggingTimeStats tests are the meaningful new coverage).
- [ ] `npx tsc --noEmit 2>&1 | tail -20` — none.
- [ ] `npm run build 2>&1 | tail -5` — success.
- [ ] Report counts + an explicit list of the native behaviors the owner must device-test.

---

## Self-Review

**Spec coverage (design doc §7):**
- Adaptive timing (learned median, fire ~30min early) → Task 1 (`leadMinutes`) + Task 2 (`loggingTimeStats` median). ✓
- Hard 2/day cap + suppression (skip already-logged) → Task 1 (`maxPerDay`, `loggedToday` filter). ✓
- Onboarding pre-permission prompt → Task 3 `ReminderStep`. ✓
- Opened-today downgrade (§7) → `openedToday` is on the planner input; wire a stricter cap when true in the caller (Task 2/3 assembly) — minimal: pass `maxPerDay: openedToday ? 1 : 2`. (Flagged: implement in the `syncAdaptiveReminders` assembly.)

**Placeholder scan:** native UI/integration deferred to implementer-reads-existing-pattern + owner device-test (unavoidable for iOS); the planner + query are concrete and tested.

**Type/contract consistency:** `planReminders` consumes `loggingTimeStats`'s per-pillar `{hour,minute}|null` shape; `reminderScheduler` is a thin shell calling the pure planner; `reminderCopy` centralises strings.

**Risk:** the only fully-verifiable part is the pure planner + the query (both unit-tested). Everything native is build-verified + handed to the owner for device testing — called out explicitly so nothing is falsely claimed working. `_creationTime` is a server-time (UTC) proxy for log time; per-user timezone refinement is a noted follow-up.

---

## Execution Handoff

Saved to `docs/superpowers/plans/2026-06-03-local-notifications.md`. Execute via subagent-driven-development; implementers stage only. Task 1 + Task 2 are unit-tested; Task 3 is build-verified and handed to the owner for iOS device validation.
