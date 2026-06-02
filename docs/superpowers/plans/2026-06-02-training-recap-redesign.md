# Training Recap Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the weekly flashcards (front/back/cue + Leitner spaced repetition) with a manual-only Weekly Recap (coach-voice debrief) plus an all-time, searchable Technique Log.

**Architecture:** One AI pass per manual generation mines session notes into `{ weekHeadline, debrief: { takeaways[], watchOut? } }`, snapshots it into the existing `training_summaries` table (`summaryData: v.any()`), and upserts each takeaway into a new `training_techniques` table (dedup/merge by normalized discipline+technique). The Leitner engine, SR table, and flip/quiz UI are removed. Auto-on-session-save generation is dropped (manual refresh only).

**Tech Stack:** Convex (actions/mutations/queries), Zod, Groq `gpt-oss-120b` via `callGroqWithRetry`, React + shadcn/ui, vitest + convex-test.

**Spec:** `docs/superpowers/specs/2026-06-02-training-recap-redesign-design.md`

---

## File Structure

- **Modify** `convex/schema.ts` — add `training_techniques`; remove `training_summary_cards`; remove `autoSummary` field from `user_coach_settings`.
- **Create** `convex/training_techniques.ts` — `normalizeTechniqueKey`, `upsertFromDebrief` (internalMutation), `listTechniques` (query).
- **Create** `convex/__tests__/training_techniques.test.ts` — dedup/merge + normalization tests.
- **Modify** `convex/actions/trainingSummary.ts` — new schema/prompt; persist recap + upsert techniques; remove `_runInternal`.
- **Modify** `convex/fight_camp.ts` — remove the two auto-summary scheduler calls + `autoSummary` lookups.
- **Modify** `convex/user_coach_settings.ts` — remove `autoSummary` get/set.
- **Delete** `convex/training_summary_cards.ts`, `convex/lib/srSchedule.ts`, `src/lib/srSchedule.ts`.
- **Delete** `src/components/fightcamp/Flashcard.tsx`, `src/components/fightcamp/FlashcardDeck.tsx`.
- **Create** `src/components/fightcamp/WeeklyRecap.tsx`, `src/components/fightcamp/TechniqueLog.tsx`.
- **Modify** `src/components/fightcamp/TrainingSummarySection.tsx` — consume new shape, drop auto toggle + Due-today + dead casts, add Technique Log entry.

Ordering keeps the tree compiling after every task: additive schema/module first, backend producer next, frontend consumer, then trigger removal, then deletions last (once nothing references them).

---

### Task 1: Add `training_techniques` table to schema

**Files:**
- Modify: `convex/schema.ts` (near `training_summary_cards`, ~line 855)

- [ ] **Step 1: Add the table definition**

In `convex/schema.ts`, add alongside the other training tables:

```ts
  // All-time technique log distilled from weekly recaps. Replaces the
  // flashcard SR table. Dedup/merge keyed on (userId, techniqueNormalized)
  // so a technique drilled across multiple weeks accumulates rather than
  // duplicating. See docs/superpowers/specs/2026-06-02-training-recap-redesign-design.md
  training_techniques: defineTable({
    userId: v.id("users"),
    discipline: v.string(),
    technique: v.string(),
    techniqueNormalized: v.string(),
    cue: v.optional(v.string()),
    detail: v.string(),
    sourceSessionDate: v.optional(v.string()),
    timesLogged: v.number(),
    firstSeenWeek: v.string(),
    lastSeenWeek: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_discipline", ["userId", "discipline"])
    .index("by_user_norm", ["userId", "techniqueNormalized"]),
```

- [ ] **Step 2: Regenerate types and typecheck**

Run: `npx convex codegen && npx tsc --noEmit`
Expected: exits 0 (the table is additive; nothing references it yet).

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts convex/_generated
git commit -m "feat(training): add training_techniques table"
```

---

### Task 2: Create `training_techniques.ts` module (normalize + upsert + list)

**Files:**
- Create: `convex/training_techniques.ts`
- Test: `convex/__tests__/training_techniques.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/__tests__/training_techniques.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal, api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

async function seedUser(t: ReturnType<typeof convexTest>): Promise<Id<"users">> {
  return await t.run(async (ctx) => ctx.db.insert("users", {} as any));
}

describe("training_techniques.upsertFromDebrief", () => {
  it("inserts new techniques with timesLogged=1", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    await t.mutation(internal.training_techniques.upsertFromDebrief, {
      userId,
      weekStart: "2026-05-18",
      takeaways: [
        { discipline: "BJJ", technique: "Scissor sweep", cue: "Hook-Push-Tilt", detail: "Tilt onto the open side." },
      ],
    });
    const rows = await t.run((ctx) =>
      ctx.db.query("training_techniques").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].timesLogged).toBe(1);
    expect(rows[0].firstSeenWeek).toBe("2026-05-18");
  });

  it("merges a recurring technique: bumps timesLogged + lastSeenWeek, keeps firstSeenWeek", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const base = { discipline: "BJJ", technique: "Scissor Sweep!", detail: "x" };
    await t.mutation(internal.training_techniques.upsertFromDebrief, {
      userId, weekStart: "2026-05-18", takeaways: [{ ...base, technique: "Scissor sweep" }],
    });
    await t.mutation(internal.training_techniques.upsertFromDebrief, {
      userId, weekStart: "2026-05-25", takeaways: [{ ...base, detail: "updated" }],
    });
    const rows = await t.run((ctx) =>
      ctx.db.query("training_techniques").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
    );
    expect(rows).toHaveLength(1); // "Scissor sweep" and "Scissor Sweep!" normalize equal
    expect(rows[0].timesLogged).toBe(2);
    expect(rows[0].firstSeenWeek).toBe("2026-05-18");
    expect(rows[0].lastSeenWeek).toBe("2026-05-25");
    expect(rows[0].detail).toBe("updated");
  });

  it("listTechniques returns [] for anonymous callers", async () => {
    const t = convexTest(schema);
    const rows = await t.query(api.training_techniques.listTechniques, {});
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run convex/__tests__/training_techniques.test.ts`
Expected: FAIL — `internal.training_techniques.upsertFromDebrief` does not exist.

- [ ] **Step 3: Write the module**

Create `convex/training_techniques.ts`:

```ts
/**
 * All-time technique log. Replaces the flashcard SR engine. Weekly recaps
 * (convex/actions/trainingSummary.ts) upsert their takeaways here; the
 * Technique Log UI reads them back grouped by discipline.
 */
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { getAuthUserId } from "./lib/auth";

/** Normalize a discipline+technique into a dedup key: lowercase, collapse
 *  whitespace, strip surrounding punctuation. "Scissor Sweep!" === "scissor sweep". */
export function normalizeTechniqueKey(discipline: string, technique: string): string {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  return `${norm(discipline)}::${norm(technique)}`;
}

const takeawayValidator = v.object({
  discipline: v.string(),
  technique: v.string(),
  cue: v.optional(v.string()),
  detail: v.string(),
  sourceSessionDate: v.optional(v.string()),
});

export const upsertFromDebrief = internalMutation({
  args: {
    userId: v.id("users"),
    weekStart: v.string(),
    takeaways: v.array(takeawayValidator),
  },
  handler: async (ctx, { userId, weekStart, takeaways }) => {
    const now = Date.now();
    for (const tk of takeaways) {
      const key = normalizeTechniqueKey(tk.discipline, tk.technique);
      const existing = await ctx.db
        .query("training_techniques")
        .withIndex("by_user_norm", (q) =>
          q.eq("userId", userId).eq("techniqueNormalized", key),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          timesLogged: existing.timesLogged + 1,
          lastSeenWeek: weekStart,
          detail: tk.detail,
          cue: tk.cue ?? existing.cue,
          sourceSessionDate: tk.sourceSessionDate ?? existing.sourceSessionDate,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("training_techniques", {
          userId,
          discipline: tk.discipline,
          technique: tk.technique,
          techniqueNormalized: key,
          cue: tk.cue,
          detail: tk.detail,
          sourceSessionDate: tk.sourceSessionDate,
          timesLogged: 1,
          firstSeenWeek: weekStart,
          lastSeenWeek: weekStart,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  },
});

export const listTechniques = query({
  args: { discipline: v.optional(v.string()) },
  handler: async (ctx, { discipline }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = discipline
      ? await ctx.db
          .query("training_techniques")
          .withIndex("by_user_discipline", (q) =>
            q.eq("userId", userId).eq("discipline", discipline),
          )
          .collect()
      : await ctx.db
          .query("training_techniques")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();
    // Newest activity first; cap to keep the payload bounded.
    return rows
      .sort((a, b) => b.lastSeenWeek.localeCompare(a.lastSeenWeek))
      .slice(0, 500);
  },
});
```

- [ ] **Step 4: Regenerate types, run tests**

Run: `npx convex codegen && npx vitest run convex/__tests__/training_techniques.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/training_techniques.ts convex/__tests__/training_techniques.test.ts convex/_generated
git commit -m "feat(training): technique log module (upsert + list + dedup)"
```

---

### Task 3: Rewrite `trainingSummary.ts` to produce a debrief + log techniques

**Files:**
- Modify: `convex/actions/trainingSummary.ts`

- [ ] **Step 1: Replace the LLM output schema**

Replace `CardSchema` + `LLMOutSchema` (around lines 38-52) with:

```ts
const TakeawaySchema = z.object({
  discipline: z.string().min(1).max(40),
  technique: z.string().min(2).max(120),
  cue: z.string().max(60).optional(),
  detail: z.string().min(4).max(200),
  sourceSessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const LLMOutSchema = z.object({
  weekHeadline: z.string().min(8).max(160),
  debrief: z.object({
    takeaways: z.array(TakeawaySchema).min(1).max(4),
    watchOut: z.string().max(200).optional(),
  }),
});
```

- [ ] **Step 2: Replace the system prompt**

Replace the `systemPrompt` string (the flashcard instructions) with:

```ts
    const systemPrompt = `You write a WEEKLY TRAINING DEBRIEF for a combat-sports athlete from their own session notes. Output two things: a one-sentence weekHeadline summarising the week's focus, and a "debrief" with up to 4 "takeaways" plus an optional "watchOut".

Each takeaway distils ONE concrete thing the athlete drilled or learned this week, pulled from their notes:
- "discipline": the session_type EXACTLY as given (Boxing is not Muay Thai). Do not merge or rename disciplines.
- "technique": the specific move/skill (e.g. "Scissor sweep", "Check hook").
- "cue": OPTIONAL single mnemonic of at most 4 words ("Hook-Push-Tilt"). Omit if there isn't a clean one.
- "detail": one line, second person, that captures the actual lesson/cue from the notes (<=200 chars).
- "sourceSessionDate": YYYY-MM-DD of the session it came from, when one note clearly seeded it. Metadata only.

"watchOut" (optional): a single recurring issue the notes reveal (e.g. a habit that keeps costing them). Omit it entirely if the notes show no clear recurring problem. Do NOT invent one.

Pull ONLY from the notes below. DO NOT write generic motivation. DO NOT prescribe next steps or step-by-step instructions (the Training Coach feature owns forward-looking prescriptions). NEVER include calendar dates, day names, or week references inside technique/detail/cue/watchOut — dates live only in sourceSessionDate.

${SECOND_PERSON_DIRECTIVE}

${PROMPT_INJECTION_GUARD_INSTRUCTION}

Return ONLY valid JSON in this EXACT shape:
{
  "weekHeadline": "one sentence summarising the week's training focus (<= 140 chars, second person)",
  "debrief": {
    "takeaways": [
      { "discipline": "BJJ", "technique": "Scissor sweep", "cue": "Hook-Push-Tilt", "detail": "Hook the far ankle, push the near knee through, tilt them onto the open side.", "sourceSessionDate": "2026-05-19" }
    ],
    "watchOut": "Your left hook keeps dropping when you reset your stance."
  }
}`;
```

- [ ] **Step 3: Update the user prompt + result handling**

Change the user prompt line (was "Write flashcards...") to:

```ts
    const userPrompt = `Here are my training sessions from this week. Give me a debrief of what I worked on:\n\n${sessionsText}`;
```

Replace the `summaryData` assembly + the two persistence blocks. The new `summaryData`:

```ts
    const summaryData = {
      weekHeadline: llmOut.weekHeadline,
      stats,
      debrief: llmOut.debrief,
    };
```

Keep the `fight_camp.upsertSummary` block unchanged. Replace the
`upsertCardsFromSummary` block with a technique-log upsert:

```ts
    try {
      await ctx.runMutation(internal.training_techniques.upsertFromDebrief, {
        userId,
        weekStart,
        takeaways: llmOut.debrief.takeaways,
      });
    } catch (err) {
      console.warn("[trainingSummary] upsertFromDebrief failed", err);
    }
```

Also update the no-notes early return to use the new shape:

```ts
      return {
        weekHeadline:
          allSessions.length === 0
            ? "No training logged this week."
            : "Add session notes to unlock your weekly debrief.",
        stats,
        debrief: { takeaways: [] as Array<{
          discipline: string; technique: string; cue?: string;
          detail: string; sourceSessionDate?: string;
        }>, watchOut: undefined as string | undefined },
      };
```

Update the top-of-file doc comment to describe the debrief + technique log (remove the flashcard/spaced-repetition wording).

- [ ] **Step 4: Remove the now-unused `_runInternal`**

> Sequencing note: this export is still referenced by `fight_camp.ts` until Task 4. Do Task 4's scheduler removal in the SAME commit as this step, OR keep `_runInternal` here and delete it at the end of Task 4. Recommended: delete the `fight_camp.ts` calls first (Task 4 Steps 1-2), then remove `_runInternal` here.

Remove the `export const _runInternal = internalAction({ ... })` block and, if no longer used, drop `internalAction` and `type ActionCtx`/`Id` imports that only it needed. Keep `runTrainingSummary` as the function the public `run` calls.

- [ ] **Step 5: Typecheck**

Run: `npx convex codegen && npx tsc --noEmit`
Expected: exits 0 (after Task 4 removes the scheduler references). If run before Task 4, expect errors in `fight_camp.ts` referencing `_runInternal` — that is the cue to do Task 4 now.

- [ ] **Step 6: Commit** (combine with Task 4)

```bash
git add convex/actions/trainingSummary.ts convex/_generated
git commit -m "feat(training): weekly debrief + technique log generation (replaces flashcards)"
```

---

### Task 4: Drop auto-summary triggers + autoSummary setting

**Files:**
- Modify: `convex/fight_camp.ts` (two scheduler blocks: in `createCalendarEntry` ~line 581-596, and `updateCalendarEntry` ~line 717-743)
- Modify: `convex/user_coach_settings.ts`
- Modify: `convex/schema.ts` (`user_coach_settings.autoSummary`, line 837)

- [ ] **Step 1: Remove the auto-summary block in `createCalendarEntry`**

Delete the entire `try { const cs = ... if (cs?.autoSummary) { ... internal.actions.trainingSummary._runInternal ... } } catch ...` block (the auto-summary one — NOT the missions or disciplineXp blocks).

- [ ] **Step 2: Remove the auto-summary block in `updateCalendarEntry`**

Delete the `notesChanged` autoSummary block that schedules `internal.actions.trainingSummary._runInternal`. Leave the missions block and fight-form recompute intact.

- [ ] **Step 3: Remove `autoSummary` from `user_coach_settings.ts`**

Remove the `setAutoSummary` mutation and the `autoSummary` fields from the get/internal queries. If a query would return an empty object, keep it returning `{ isPro }` (drop `autoSummary`). Remove the `autoSummary` arg/patch usage.

- [ ] **Step 4: Remove the schema field**

In `convex/schema.ts`, remove `autoSummary: v.boolean(),` from `user_coach_settings`. (Convex tolerates dropping an optional-in-practice field; existing rows keep the value as orphan data, which is harmless. If `autoSummary` is required in the validator and existing rows would fail validation on read, instead make it `v.optional(v.boolean())` and stop reading it.)

- [ ] **Step 5: Typecheck (now `_runInternal` removal from Task 3 is consistent)**

Run: `npx convex codegen && npx tsc --noEmit`
Expected: exits 0. Any remaining error naming `autoSummary` or `_runInternal` points to a missed reference (grep `grep -rn "autoSummary\|trainingSummary._runInternal" convex src`).

- [ ] **Step 6: Commit**

```bash
git add convex/fight_camp.ts convex/user_coach_settings.ts convex/schema.ts convex/actions/trainingSummary.ts convex/_generated
git commit -m "refactor(training): manual-only recap; drop autoSummary trigger + setting"
```

---

### Task 5: Frontend — WeeklyRecap, TechniqueLog, rewire TrainingSummarySection

**Files:**
- Create: `src/components/fightcamp/WeeklyRecap.tsx`
- Create: `src/components/fightcamp/TechniqueLog.tsx`
- Modify: `src/components/fightcamp/TrainingSummarySection.tsx`
- Delete: `src/components/fightcamp/Flashcard.tsx`, `src/components/fightcamp/FlashcardDeck.tsx`

- [ ] **Step 1: Create `WeeklyRecap.tsx`**

```tsx
import { coachColors } from "@/lib/coachColors";

type Takeaway = {
  discipline: string; technique: string; cue?: string;
  detail: string; sourceSessionDate?: string;
};
type Debrief = { takeaways: Takeaway[]; watchOut?: string };

export function WeeklyRecap({ headline, debrief }: { headline: string; debrief?: Debrief }) {
  const takeaways = debrief?.takeaways ?? [];
  return (
    <div className="space-y-4">
      <p className="text-base font-medium text-foreground/90">{headline}</p>
      {takeaways.length > 0 && (
        <ul className="space-y-3">
          {takeaways.map((t, i) => (
            <li key={i} className="rounded-2xl border border-border/50 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold" style={{ color: coachColors(t.discipline) }}>
                  {t.discipline}
                </span>
                <span className="text-sm font-medium">{t.technique}</span>
                {t.cue && (
                  <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs">{t.cue}</span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t.detail}</p>
            </li>
          ))}
        </ul>
      )}
      {debrief?.watchOut && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <span className="font-semibold text-amber-500">Watch out: </span>
          {debrief.watchOut}
        </div>
      )}
    </div>
  );
}
```

> If `coachColors` is not a function export, match the existing usage in `Flashcard.tsx` before deleting it (read it first) and mirror that call shape.

- [ ] **Step 2: Create `TechniqueLog.tsx`**

```tsx
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Input } from "@/components/ui/input";
import { coachColors } from "@/lib/coachColors";

export function TechniqueLog() {
  const techniques = useQuery(api.training_techniques.listTechniques, {}) ?? [];
  const [q, setQ] = useState("");
  const grouped = useMemo(() => {
    const filtered = techniques.filter(
      (t) =>
        t.technique.toLowerCase().includes(q.toLowerCase()) ||
        t.detail.toLowerCase().includes(q.toLowerCase()) ||
        t.discipline.toLowerCase().includes(q.toLowerCase()),
    );
    const map = new Map<string, typeof filtered>();
    for (const t of filtered) {
      const arr = map.get(t.discipline) ?? [];
      arr.push(t);
      map.set(t.discipline, arr);
    }
    return Array.from(map.entries());
  }, [techniques, q]);

  return (
    <div className="space-y-4">
      <Input placeholder="Search your technique log" value={q} onChange={(e) => setQ(e.target.value)} />
      {grouped.length === 0 && (
        <p className="text-sm text-muted-foreground">No techniques logged yet.</p>
      )}
      {grouped.map(([discipline, items]) => (
        <div key={discipline} className="space-y-2">
          <h4 className="text-xs font-semibold" style={{ color: coachColors(discipline) }}>{discipline}</h4>
          <ul className="space-y-2">
            {items.map((t) => (
              <li key={t._id} className="rounded-xl border border-border/50 p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t.technique}</span>
                  {t.cue && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{t.cue}</span>}
                  {t.timesLogged > 1 && (
                    <span className="ml-auto text-xs text-muted-foreground">×{t.timesLogged}</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{t.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

> Confirm the `api` import path the repo uses for Convex (`@/convex/_generated/api` vs a relative path) by matching `TrainingSummarySection.tsx`'s existing import before writing.

- [ ] **Step 3: Rewire `TrainingSummarySection.tsx`**

- Read the file first. Remove: the auto-summary toggle UI + its `setAutoSummary`/`getCoachSettings` wiring, the "Due today" pill + Sheet, `FlashcardDeck` import/usage, and all `(api as any).training_summary_cards.*` casts + the legacy `sportSections`/`mergeSummaries` code paths.
- Read `summaryData` as the new shape: render `<WeeklyRecap headline={summaryData.weekHeadline} debrief={summaryData.debrief} />` plus the existing stats strip. Treat a missing `debrief` (legacy rows) as `{ takeaways: [] }` so old snapshots render the headline + stats without crashing.
- Keep the manual "Refresh now"/"Generate" button calling `trainingSummaryAction({ weekStart })` and the `WeeklyTimeline` for past weeks.
- Add a "View technique log" control (e.g. a button opening a shadcn `Sheet`) that renders `<TechniqueLog />`.

- [ ] **Step 4: Delete the flashcard components**

```bash
git rm src/components/fightcamp/Flashcard.tsx src/components/fightcamp/FlashcardDeck.tsx
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: exits 0. Grep for stragglers: `grep -rn "FlashcardDeck\|training_summary_cards\|getDueToday\|setAutoSummary" src` → no results.

- [ ] **Step 6: Manual verification (Playwright on localhost:8080)**

Start `npm run dev`. As a Pro user with a logged session that has notes: open the Training Calendar → Training Summary section → tap Refresh → confirm the recap renders takeaways + (optional) watch-out, no flip/quiz UI. Open "View technique log" → confirm grouped + search works.

- [ ] **Step 7: Commit**

```bash
git add src/components/fightcamp/
git commit -m "feat(training): weekly recap + technique log UI (removes flashcard deck)"
```

---

### Task 6: Delete the dead SR engine + table

**Files:**
- Delete: `convex/training_summary_cards.ts`, `convex/lib/srSchedule.ts`, `src/lib/srSchedule.ts`
- Modify: `convex/schema.ts` (remove `training_summary_cards` table)

- [ ] **Step 1: Confirm nothing references them**

Run: `grep -rn "training_summary_cards\|srSchedule\|scheduleNext\|initialState" convex src | grep -v _generated`
Expected: only the files about to be deleted (and the schema table). If anything else appears, resolve it before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm convex/training_summary_cards.ts convex/lib/srSchedule.ts src/lib/srSchedule.ts
```

- [ ] **Step 3: Remove the schema table**

In `convex/schema.ts`, delete the entire `training_summary_cards: defineTable({ ... })...,` block (and its comment).

- [ ] **Step 4: Regenerate + full typecheck + build**

Run: `npx convex codegen && npx tsc --noEmit && npm run build`
Expected: exits 0.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS (including the new `training_techniques` tests).

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/_generated
git commit -m "chore(training): remove flashcard SR table + Leitner scheduler"
```

---

## Self-Review

**Spec coverage:**
- Hybrid debrief + journal → Task 3 (debrief) + Task 2/5 (journal). ✓
- Keep stats/notes-mining/weekHeadline → retained in Task 3 (only schema/prompt/persistence changed). ✓
- New `summaryData` shape → Task 3 Step 3. ✓
- `training_techniques` table + dedup/merge → Task 1 + Task 2. ✓
- Manual-only triggers → Task 4. ✓
- Remove SR table/engine/queries/UI → Task 5 (UI) + Task 6 (backend/table). ✓
- Searchable all-time log → Task 2 `listTechniques` + Task 5 `TechniqueLog`. ✓
- Pro gate retained → `enforceFeatureGate` untouched in `runTrainingSummary`. ✓
- `trainingCoachPlanner._runInternal` left intact → not touched by any task. ✓

**Type consistency:** `upsertFromDebrief` args (`userId`, `weekStart`, `takeaways`) match the call in Task 3 Step 3 and the test in Task 2. Takeaway field names (`discipline`, `technique`, `cue`, `detail`, `sourceSessionDate`) are identical across the Zod schema (Task 3), the mutation validator (Task 2), the table (Task 1), and the UI types (Task 5). `listTechniques` returns full rows incl. `_id`, `timesLogged`, `cue`, `detail` used in `TechniqueLog`. ✓

**Sequencing:** Tasks 1-2 additive; Task 3 producer (depends on Task 2); Task 4 removes the `_runInternal` references in the same commit window as its deletion; Task 5 consumer; Task 6 deletes only after all references are gone. Compiles after each committed task.

**Known caveats flagged inline:** `coachColors` call shape and the `api` import path must be matched to existing usage before writing the new components (Task 5 Steps 1-2 notes); `autoSummary` schema removal vs. `v.optional` fallback (Task 4 Step 4).
