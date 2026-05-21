# Training Summary — Flashcards (retention)

**Status:** Approved 2026-05-21. Replaces the existing step-by-step technique-instruction output (which now overlaps Training Coach) with a retention-focused weekly flashcard deck + stats strip + browsable history.

## Why

Training Coach already handles forward-looking, progressive step-by-step instructions ("do this next session"). The Training Summary should do the OPPOSITE — backward-looking knowledge retention so fighters remember what they trained.

## Concept

Each Sunday (or whenever the auto-summary toggle fires), AI distills the week's session notes into 3–6 flashcards. Each card has:
- **front** — a recall prompt or question (e.g. "Scissor sweep — what's the base-leg cue?")
- **back** — a 1–2 line memorable answer
- **cue** — optional mnemonic ("Trap-Then-Tilt")

Cards persist as their own table with spaced-repetition state. "Got it" pushes the next review out (Leitner doubling). "Forgot" resets it to tomorrow.

Above the deck: a small stats strip (sessions, minutes, top discipline, avg RPE). Below: a "Due today" chip + a horizontal timeline of past weeks.

## Data model

`training_summaries` table — unchanged. `summaryData: v.any()` already accepts the new shape.

**New table** `training_summary_cards`:
```ts
training_summary_cards: defineTable({
  userId: v.id("users"),
  sport: v.string(),
  weekStart: v.string(),               // YYYY-MM-DD; the week the card was born in
  cardKey: v.string(),                 // hash of (sport + normalised front) — dedup across weeks
  front: v.string(),                   // ≤ 120 chars
  back: v.string(),                    // ≤ 240 chars
  cue: v.optional(v.string()),         // ≤ 40 chars mnemonic
  sourceSessionDate: v.optional(v.string()),
  // Leitner / spaced repetition state:
  intervalDays: v.number(),            // current interval; 1 for new
  dueAt: v.number(),                   // unix ms
  reviews: v.number(),                 // total review count
  lapses: v.number(),
  lastReviewedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_user_due", ["userId", "dueAt"])
  .index("by_user_card_key", ["userId", "cardKey"])
  .index("by_user_week", ["userId", "weekStart"]);
```

## Action — `convex/actions/trainingSummary.ts`

Args unchanged: `{ weekStart: v.string() }`.

New return shape:
```ts
{
  weekHeadline: string,        // 1 sentence (≤ 140 chars)
  stats: {
    sessionsLogged: number,
    totalMinutes: number,
    topDiscipline: string,
    avgRpe?: number,
    avgSleepHours?: number,
  },
  cards: Array<{
    sport: string,
    front: string,
    back: string,
    cue?: string,
    sourceSessionDate?: string,
  }>,                          // 3–6
}
```

Model: `openai/gpt-oss-120b` (bump from llama for nuance). JSON mode. Zod validation.

System prompt direction (key sentences):
> "You write FLASHCARDS for a combat-sports athlete to memorise what they trained this week. Each card has a `front` (a short recall PROMPT or QUESTION — never the answer) and a `back` (the answer/cue, 1–2 lines, second person, memorable). Optional `cue` is a single mnemonic phrase ≤ 4 words ('Trap-Then-Tilt')."
> "Pull cards from the notes — techniques mentioned, coach feedback, specific lessons. DO NOT write generic motivation. DO NOT prescribe next steps (the Coach feature does that). Front MUST be retrievable from the back's content."
> "3-6 cards, balanced across the disciplines the athlete trained this week."

After validation, the action calls a new internal mutation `internal.training_summary_cards.upsertCardsFromSummary` which:
- For each generated card, computes `cardKey = sha1(sport + normalize(front))`.
- If a row with that `cardKey` exists for the user → patch `back`/`cue`/`sourceSessionDate` (don't reset SR state — preserves learned cards across re-generations).
- Else → insert with `intervalDays=1, dueAt=tomorrow, reviews=0, lapses=0`.

Stats are computed server-side from the already-fetched session rows (RPE/sleep/intensity are already pulled but currently unused).

## SR helper — `convex/lib/srSchedule.ts`

```ts
export function scheduleNext(prev: { intervalDays: number; lapses: number }, recall: "got" | "forgot") {
  const now = Date.now();
  if (recall === "forgot") {
    return { intervalDays: 1, dueAt: now + DAY_MS, lapses: prev.lapses + 1 };
  }
  const next = Math.min(prev.intervalDays * 2, 30);
  return { intervalDays: next, dueAt: now + next * DAY_MS, lapses: prev.lapses };
}
```

(Frontend mirrors at `src/lib/srSchedule.ts`.)

## Queries / mutations — `convex/training_summary_cards.ts`

- `query getDueToday` → cards with `dueAt <= now`, sorted by `dueAt asc`
- `query getCardsForWeek({ weekStart })` → all cards born that week
- `query listSummarisedWeeks` → distinct `weekStart` values (for the timeline)
- `mutation recallCard({ cardId })` → schedule using `srSchedule("got")`; increments `reviews`
- `mutation forgetCard({ cardId })` → schedule using `srSchedule("forgot")`
- `internalMutation upsertCardsFromSummary({ userId, weekStart, cards })` — called by the action

## UI

`src/components/fightcamp/TrainingSummarySection.tsx` — rewrite the render block (keep toggle, fingerprint, change detection, AICompactOverlay, gating, deletion flow):

1. **Stats strip** — small horizontal row at the top. 4 stats inline: sessions · minutes · top discipline · avg RPE. `text-micro uppercase` labels with `tabular-nums` numerals.
2. **Week headline** — `text-body-sm font-semibold leading-tight`. Replaces the old `weekOverview`.
3. **Flashcard deck** — `<FlashcardDeck cards={cards}>`. Renders one card at a time, flippable. Below: progress dots (3 of 6). After flip, two buttons inline: `Got it ✓` / `Forgot ✗`. Tap advances. Empty state ("All cards reviewed!") with a haptic + tiny celebratory chip.
4. **Due today** chip — small pill below the deck: `🔁 4 cards due from earlier weeks`, tap to open a Sheet with the review queue (same FlashcardDeck reused).
5. **Weekly timeline** — horizontal scroll of past-week chips (`Wk 21 · 5 cards`, `Wk 20 · 4 cards`…). Tap → loads that week's cards into the deck (read-only context for past weeks; tapping cards still flips & schedules).

New components:
- `src/components/fightcamp/Flashcard.tsx` — single card flip animation (CSS 3D rotation), front/back faces.
- `src/components/fightcamp/FlashcardDeck.tsx` — manages current index, flip state, scheduling mutations.
- `src/components/fightcamp/WeeklyTimeline.tsx` — past-week chip row.

## Migration / backward compat

- The shape change in `summaryData` means OLD week summaries will fail the new runtime guard.
- Strategy: on read, if `summaryData` doesn't have a `cards` array, render a small **"Legacy summary"** chip with a "Regenerate" action (calls `refreshMission`-style mutation). Don't auto-overwrite — the user opts in.
- New `training_summary_cards` table starts empty; cards only land on subsequent (re-)generation.

## Pro gating

Unchanged — `AI_TRAINING_SUMMARY` already covers the action. `recallCard` / `forgetCard` are free interactions on already-generated cards.

## Out of scope (v1)

- SM-2 / Anki-grade scheduling (Leitner doubling is the floor we ship with)
- Reordering / pinning specific cards
- Custom card creation by the user (manual additions)
- Cross-week dedup of "back" content (only `front` is dedup'd via `cardKey`)
- Notifications for due cards (future)

## Testing

- Playwright: tap a flashcard → flips → "Got it" advances → "Due today" decrements. Toggle the week timeline chip → past week loads.
- Spot-check mobile (390×844) and tablet — cards should keep aspect ratio, two action buttons remain reachable.
