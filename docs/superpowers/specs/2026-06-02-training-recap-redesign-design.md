# Training Recap Redesign — Design Spec

**Date:** 2026-06-02
**Status:** Approved (design) — pending spec review
**Supersedes:** `2026-05-21-training-summary-flashcards.md`

## Problem

The Weekly Training Summary ships as spaced-repetition **flashcards**: the LLM
invents a recall question (`front`) over a paraphrase of the athlete's own
session notes, and a Leitner scheduler (`training_summary_cards`,
`srSchedule.ts`) drives a flip/quiz/"Due today" review loop.

The framing is forced:

- Self-quizzing on a paraphrase of notes *you wrote* is circular.
- The Got it / Forgot Leitner loop assumes atomic flashcard facts, but session
  notes are messy and contextual.
- The cross-week "Due today" queue layers an Anki-style obligation onto a
  training log — a chore, not a recap.
- The spec sold a weekly "Sunday" cadence, but reality is fire-on-every-
  session-save, so the deck churns mid-week.

## Goal

Replace flashcards with a **backward-looking recap** that has two surfaces from
a single generation pass:

1. **Weekly Recap** — a per-week coach-voice debrief.
2. **Technique Log** — an all-time, searchable library of what you've drilled.

This keeps the feature's original intent (knowledge retention from session
notes, the inverse of the forward-looking Training Coach) without the quiz.

## Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Concept | Hybrid: Weekly Debrief + all-time Technique Journal |
| Cross-week history | Searchable all-time technique log |
| Generation trigger | Manual refresh only |
| Old SR tables/engine | Remove entirely |

## Keep / Remove

**Keep (durable core, format-agnostic):**

- `computeStats` (`trainingSummary.ts`) — server-computed stats strip. LLM-free.
- Notes-mining + `sanitizeUserText` prompt-injection pipeline.
- `weekHeadline` (one-sentence focus summary).
- `training_summaries` snapshot table (`summaryData: v.any()` — absorbs the new
  shape without migration).
- The `AI_TRAINING_SUMMARY` Pro gate.
- `notesFingerprint` change-detection + idempotent upsert on `(userId, weekStart)`.
- `WeeklyTimeline` component (week browsing).

**Remove (flashcard-specific):**

- `training_summary_cards` table + all SR fields (`intervalDays`, `dueAt`,
  `reviews`, `lapses`, `lastReviewedAt`, `cardKey`).
- `convex/lib/srSchedule.ts` and `src/lib/srSchedule.ts`.
- SR queries/mutations in `training_summary_cards.ts`: `getDueToday`,
  `getCardsForWeek`, `recallCard`, `forgetCard`, `upsertCardsFromSummary`, and
  the `cardKey`/`normaliseFront`/`sha256Hex` dedup machinery.
- Card schema (`front`/`back`/`cue` recall framing) + the "invent a recall
  question" prompting.
- UI: `Flashcard.tsx`, `FlashcardDeck.tsx`, the "Due today" Sheet.
- The dead `(api as any).training_summary_cards` defensive casts in
  `TrainingSummarySection.tsx` / `FlashcardDeck.tsx`, plus legacy
  `sportSections` / `mergeSummaries` code paths.

## Data Model

### `training_summaries` (keep; new `summaryData` shape)

```ts
summaryData: {
  weekHeadline: string;
  stats: WeekStats;                 // unchanged: sessionsLogged, totalMinutes,
                                    // topDiscipline, avgRpe?, avgSleepHours?
  debrief: {
    takeaways: Array<{
      discipline: string;           // session_type, verbatim
      technique: string;
      cue?: string;                 // optional ≤4-word mnemonic
      detail: string;               // one line, ≤200 chars, second person
      sourceSessionDate?: string;   // YYYY-MM-DD metadata
    }>;
    watchOut?: string;              // optional recurring-issue note, ≤200 chars
  };
}
```

### `training_techniques` (new — replaces `training_summary_cards`)

```ts
training_techniques: defineTable({
  userId: v.id("users"),
  discipline: v.string(),           // session_type, verbatim
  technique: v.string(),
  techniqueNormalized: v.string(),  // lowercased, whitespace-collapsed, punct-stripped
  cue: v.optional(v.string()),
  detail: v.string(),
  sourceSessionDate: v.optional(v.string()),
  timesLogged: v.number(),
  firstSeenWeek: v.string(),        // weekStart YYYY-MM-DD
  lastSeenWeek: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_discipline", ["userId", "discipline"])
  .index("by_user_norm", ["userId", "techniqueNormalized"]); // dedup lookups
```

**Dedup/merge:** key = `(userId, normalize(discipline + "::" + technique))`. On
upsert: if a row exists, bump `timesLogged`, set `lastSeenWeek`, and refresh
`detail`/`cue`/`sourceSessionDate` to the latest; else insert with
`timesLogged = 1`, `firstSeenWeek = lastSeenWeek = weekStart`.

## Backend

### `convex/actions/trainingSummary.ts`

- New `LLMOutSchema`:
  ```ts
  z.object({
    weekHeadline: z.string().min(8).max(160),
    debrief: z.object({
      takeaways: z.array(z.object({
        discipline: z.string().min(1).max(40),
        technique: z.string().min(2).max(120),
        cue: z.string().max(60).optional(),
        detail: z.string().min(4).max(200),
        sourceSessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })).min(1).max(4),
      watchOut: z.string().max(200).optional(),
    }),
  })
  ```
- Rewrite the system prompt: distil techniques/cues + a one-sentence headline +
  optional watch-out. Drop all recall-question framing. Keep the
  no-temporal-framing rule for `technique`/`detail`/`cue`/`watchOut` (dates live
  only in `sourceSessionDate`). Keep `SECOND_PERSON_DIRECTIVE` and
  `PROMPT_INJECTION_GUARD_INSTRUCTION`.
- On success: persist the recap snapshot via `fight_camp.upsertSummary`, then
  upsert each takeaway into `training_techniques` via a new internal mutation
  `training_techniques.upsertFromDebrief({ userId, weekStart, takeaways })`.
- Keep `_runInternal`? **Remove it** along with the auto-triggers below —
  manual-only means the public (authenticated) `run` is the only caller, which
  never had the auth bug. (`trainingCoachPlanner._runInternal` stays.)
- Keep `logDecision` (now awaited) for the audit trail.

### `convex/training_techniques.ts` (new)

- `upsertFromDebrief` (internalMutation) — dedup/merge per the rule above.
- `listTechniques({ search?, discipline? })` (query) — returns the user's
  techniques (capped, e.g. 500), newest-`lastSeenWeek` first; server applies the
  optional discipline filter, client groups + free-text filters. Anonymous → `[]`.
- `getTechniqueStats` (query, optional) — counts per discipline for headers.

### Triggers — `convex/fight_camp.ts`

- Remove the two `internal.actions.trainingSummary._runInternal` scheduler calls
  (in `createCalendarEntry` and `updateCalendarEntry`) and their surrounding
  `autoSummary` lookups.
- Remove `setAutoSummary` usage; drop the `autoSummary` field from
  `user_coach_settings` (schema + mutation) and its UI toggle. *(If a clean
  schema removal is risky mid-flight, mark the field deprecated and stop reading
  it — implementer's call during the plan.)*
- **Unchanged:** all `trainingCoachPlanner._runInternal` scheduler calls (that
  feature keeps its auto-triggers and the auth fix).

## Frontend (`src/components/fightcamp/`)

- **Delete:** `Flashcard.tsx`, `FlashcardDeck.tsx`.
- **New `WeeklyRecap.tsx`:** renders stats strip + `weekHeadline` + takeaways
  (discipline-tagged, optional cue pill, detail line) + optional watch-out
  callout. Discipline color via existing `coachColors`.
- **New `TechniqueLog.tsx`:** searchable list grouped by discipline, fed by
  `listTechniques`; a search input + discipline filter chips; each row shows
  technique, cue, detail, and a subtle `timesLogged ×N` badge.
- **`TrainingSummarySection.tsx`:** drop the auto-summary toggle, the "Due today"
  pill/Sheet, and legacy/`(api as any)` cruft. Keep the manual "Refresh now"
  button (primary entry) + `WeeklyTimeline` for past-week recaps. Add a "View
  technique log" entry that opens `TechniqueLog` (sheet or sub-route).

## Error Handling

- Generation reuses `callGroqWithRetry` (Zod retry) — unchanged behaviour.
- `training_techniques.upsertFromDebrief` failures are best-effort (try/catch +
  `console.warn`), mirroring today's card-upsert handling, so a technique-log
  write failure never blocks the recap from rendering.
- No-notes week → stats strip + calm placeholder headline + empty takeaways
  (existing graceful path, retained).

## Testing

- Unit: `training_techniques` dedup/merge (new technique inserts; recurring
  technique bumps `timesLogged` + `lastSeenWeek`, preserves `firstSeenWeek`;
  normalization collapses case/whitespace/punctuation).
- Unit: `computeStats` (unchanged — keep existing coverage).
- Manual (Playwright, localhost:8080): generate a recap from a week with notes →
  recap renders with takeaways; open technique log → entries grouped + search
  filters; generate a second week with an overlapping technique → `timesLogged`
  increments rather than duplicating.

## Out of Scope

- No weekly cron (manual-only).
- No migration of existing flashcard data (removed entirely).
- No changes to the forward-looking Training Coach feature beyond leaving its
  `_runInternal` auth fix in place.
