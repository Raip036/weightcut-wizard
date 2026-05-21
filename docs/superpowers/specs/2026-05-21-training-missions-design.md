# Training Missions — Design Spec

**Status:** Approved 2026-05-21. Replaces the entire current "Training Coach" feature (paths / steps / proposals).

## Concept

User logs a training session in the Training Calendar and writes notes in the existing freeform `notes` field. On save, the AI Coach reads those notes for that discipline and generates a **linear checklist** of 3–8 actionable improvements / drills / focus points for the user's next sessions. The user ticks items off as they complete them. When the last item is checked, a **Mission Complete** modal fires; a new mission auto-generates **only if** (a) the prior mission's items are all complete AND (b) new notes exist for that discipline since the mission was created.

Disciplines (BJJ / Muay Thai / Boxing / Wrestling / Sparring / Strength / Run) each have their own active mission in parallel, colour-coded.

## Why

The previous Training Coach (paths + steps + technique-extraction proposals + plateau loop-back) was conceptually heavy: user had to nominate goals, accept proposals, and the system tried to be too clever. Real users write session reflections; turning those reflections directly into linear, tickable progress items is more honest and lower-friction.

## Data model

Drop these tables: `training_paths`, `training_path_steps`, `training_path_proposals`, `training_path_feedback`.

Add:

```ts
training_missions: defineTable({
  userId: v.id("users"),
  sport: v.string(),                 // matches fight_camp_calendar.sessionType
  status: v.union(
    v.literal("active"),
    v.literal("completed"),
    v.literal("archived"),
  ),
  title: v.string(),                 // ≤ 50 chars, e.g. "Sharpen guard retention"
  rationale: v.string(),             // 1–2 sentences, "Based on notes from May 18 + 21…"
  sourceSessionIds: v.array(v.id("fight_camp_calendar")),
  notesWindowStart: v.number(),      // unix ms; next gen pulls notes ≥ this
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
  lastActivityAt: v.number(),        // updated on any item tick
})
  .index("by_user_status", ["userId", "status"])
  .index("by_user_sport_status", ["userId", "sport", "status"]);

training_mission_items: defineTable({
  missionId: v.id("training_missions"),
  position: v.number(),              // 0..N strict order
  text: v.string(),                  // ≤ 120 chars, second-person, actionable
  technique: v.optional(v.string()),
  drillType: v.optional(v.union(
    v.literal("solo"), v.literal("partner"), v.literal("live"), v.literal("shadow"),
  )),
  durationMin: v.optional(v.number()),
  completed: v.boolean(),
  completedAt: v.optional(v.number()),
})
  .index("by_mission_position", ["missionId", "position"]);
```

## Generation flow

Single idempotent Convex action: `convex/actions/trainingMissions/generate.ts`

```ts
generateMissionIfReady({ userId, sport })
```

1. Find latest `(userId, sport)` mission (any status).
2. If it exists and `status === "active"` and any item `!completed` → **skip** (return `{ skipped: "prior_incomplete" }`).
3. If it exists and `status === "active"` and all items completed → mutate `status = "completed"`, `completedAt = now`; continue.
4. Set `cursor = max(latestMission?.notesWindowStart ?? 0, latestMission?.createdAt ?? 0)`.
5. Query `fight_camp_calendar` for `(userId, sessionType = sport, _creationTime >= cursor)` where `notes` is non-empty, sorted ASC.
6. If 0 rows → **skip** (`{ skipped: "no_new_notes" }`).
7. Pro gate: `await enforceFeatureGate(ctx, userId, "AI_TRAINING_COACH_PATHS")`.
8. Sanitize each note via `sanitizeUserText(text, { maxLength: 1500, raw: true })`; join with `\n---\n`.
9. Call `callGroqWithRetry`:
   - model `openai/gpt-oss-120b`, JSON mode, `temperature: 0.4`, `max_tokens: 1500`, `timeoutMs: 15000`
   - Zod schema validates `{ title, rationale, items: [{ text, technique?, drillType?, durationMin? }] }` with `items.length` ∈ [3, 8]
10. Insert mission row, insert items (positions 0..N), set `notesWindowStart = now`.
11. Log via `logDecision` for audit.
12. Return `{ created: missionId }`.

### Trigger points

- **A. Session save** — wherever `fight_camp_calendar` is upserted (`convex/fight_camp.ts: logSession` and friends), append `await ctx.scheduler.runAfter(0, internal.trainingMissions.generate.run, { userId, sport: sessionType })` for sessions with non-empty notes.
- **B. Item tick** — `markItemCompleted` mutation: after the patch, query siblings; if zero remain incomplete, schedule the same action for `(userId, sport)`.
- **C. Manual refresh** — small button on the widget calls a `refreshMission` mutation that just schedules the same action.

### Prompts (system message)

```
You are FightCamp Wizard's Training Coach. Read the athlete's recent session notes for {sport} and produce a linear, progressive checklist of 3–8 items they can work on in their next training sessions.

Rules:
- Items must be progressive (earlier items establish foundations for later ones).
- Be specific: include reps/rounds/time when sensible (e.g., "drill 3x8 scissor sweeps from closed guard").
- Second person. Imperative. ≤ 120 chars per item.
- Each item should be doable in a single training session.
- title: ≤ 50 chars, summarising the mission's theme.
- rationale: 1–2 sentences citing what in the notes drove this.

Return ONLY JSON matching: { title, rationale, items: [{ text, technique?, drillType?, durationMin? }] }.
```

Plus `SECOND_PERSON_DIRECTIVE` and `PROMPT_INJECTION_GUARD_INSTRUCTION` appended from shared helpers.

## UI

### Location

Mission stack lives on `/camp`, replacing the current `TrainingCoachWidget` slot (already moved there earlier in this session).

### Discipline colour tokens

Added to `src/index.css` as HSL custom properties (so opacity stops work via Tailwind's `/15`, `/25`, `/40` syntax via `bg-[hsl(var(--coach-bjj)/0.15)]`).

| Discipline | Token | HSL (dark mode) |
|-----------|-------|-----------------|
| BJJ | `--coach-bjj` | `220 65% 60%` (royal blue) |
| Muay Thai | `--coach-muay-thai` | `350 70% 60%` (red) |
| Boxing | `--coach-boxing` | `30 90% 60%` (orange) |
| Wrestling | `--coach-wrestling` | `45 80% 55%` (mustard) |
| Sparring | `--coach-sparring` | `280 60% 65%` (purple) |
| Strength | `--coach-strength` | `0 0% 70%` (neutral grey) |
| Run | `--coach-run` | `155 50% 55%` (teal) |
| _Unknown_ | `--coach-default` | `var(--primary)` |

Helper: `src/lib/coachColors.ts` exports `disciplineToken(sport: string): string`.

### Components

`src/components/coach/` (new directory; old `dashboard/training-coach/` deleted):

- `MissionStack.tsx` — outer container; queries `getActiveMissions`. Renders one `MissionCard` per active mission, ordered by `lastActivityAt` desc. Empty state: "Log a session with notes and your first mission appears here."
- `MissionCard.tsx` — single mission card. Props: `mission`, `items`. Layout:
  - Left accent stripe in discipline colour (`w-1`, full height)
  - Header row: discipline chip (pill, filled at 15% opacity, text at full discipline colour) + title
  - Rationale paragraph (`text-note text-muted-foreground`)
  - Progress bar (discipline colour) + "{done}/{total}"
  - Item list — collapsed to first 4 visible if total > 5, "Show all" affordance
  - Each item: tappable row with checkbox, text, optional `[technique]` / `[drillType]` chips
- `MissionCompleteDialog.tsx` — full-screen `Dialog` modal: confetti + "Mission Complete!" + discipline icon + title + "Next mission will appear from your next session's notes" (or "Generating your next mission…" if action B fired and it's pending) + close.
- `LockedMissionCard.tsx` — Pro paywall fallback when `enforceFeatureGate` denies. Reuses `openPaywall()`.

### Sizing rules (for the Playwright iteration pass)

- Card vertical rhythm matches existing `Camp.tsx` siblings (`space-y-2`, `p-4`, `rounded-xs`).
- Discipline pill: `h-6 px-2.5 text-[11px] font-bold uppercase`.
- Progress bar: `h-1.5` (matches active camp banner progress).
- Item row min-height `min-h-[44px]` (touch target).
- Checkbox: `h-5 w-5 rounded-xs border border-border` empty / discipline-coloured filled with `Check` icon.

## Mutations

- `internal.trainingMissions.persist.insertMission` — called by the action.
- `markItemCompleted({ itemId })` — patches item, schedules generate if mission now complete, returns `{ missionCompleted: boolean }`.
- `refreshMission({ sport })` — schedules generate.

## Pro gating

Reuse existing `enforceFeatureGate(ctx, userId, "AI_TRAINING_COACH_PATHS")` in the action; `MissionStack` queries a `getMissionFeatureStatus` query that mirrors `pathSlotUsage` and renders `LockedMissionCard` instead when not Pro.

## Error handling

- Groq timeout / 5xx / JSON parse fail → action throws typed `GroqError`. Caller mutation catches and logs; mission is NOT inserted. User sees no change; manual refresh available.
- Schema validation fail (Zod) → 1 retry with feedback injection (already in `callGroqWithRetry`). Two consecutive fails → log + skip.
- Notes contain prompt-injection markers → `sanitizeUserText` strips and `PROMPT_INJECTION_GUARD_INSTRUCTION` defends.

## Testing

Unit:
- Action: prior_incomplete, prior_complete + no_new_notes, prior_complete + new_notes happy path, no_prior + new_notes happy path, fail/retry, locked-tier path.
- Mutation: `markItemCompleted` schedules generate iff all items complete.

UI:
- Storybook stories for each `MissionCard` discipline colour.
- Playwright smoke: log a fake session with notes → mission card appears (mocked Groq fixture).
- Playwright sizing pass: capture full `/camp` at 390×844 mobile + 768×1024 tablet; verify card layout doesn't overflow, accent stripe is visible, progress bar fills correctly.

## Migration

Drop the 4 old tables + delete `convex/actions/_trainingCoach/` + delete `src/components/dashboard/training-coach/`. No data preservation — user's prior "paths" are wiped. (User explicitly chose "Scrap and rebuild from scratch".)

## Out of scope (v1)

- Skip-with-reason on items
- Auto-expire of stale missions
- Sharable mission complete images
- Per-discipline streaks
- Push notifications
