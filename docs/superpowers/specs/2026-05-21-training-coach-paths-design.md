# Training Coach: Linear Improvement Paths — Design Spec

**Date:** 2026-05-21
**Status:** Approved by stakeholder (Pratik), pending implementation plan
**Surface:** User's main Dashboard (Pro-only)
**Owner:** Pratik

---

## 1. Background

The app has two existing AI-driven training surfaces:

- **Training Calendar `TrainingSummarySection`** (`src/components/fightcamp/TrainingSummarySection.tsx`) — generates per-week, per-sport technique reminders from session notes. Output: numbered execution steps + sparring tip + drillFlow (solo → partner → live). **This stays as-is** — it serves the "remind me what I learned this week" job.

- **`convex/actions/trainingInsights.ts`** — already returns `{ interpretation, training_application, pathway: [3 consecutive steps] }`. **Built but not wired to any UI.** This is the seed of the new feature; the design subsumes and replaces it.

What's missing today: a system that helps the user **never plateau**. When the user learns a new combination, the existing summary tells them what they did. It doesn't tell them, week by week, how to integrate it into their game until they own it. This spec adds that progression engine.

The current user-dashboard `TrainingInsightsWidget` is also a stub. This feature **replaces it** entirely.

---

## 2. Goals & Non-Goals

**Goals**
- A persistent, multi-step "improvement path" per technique/combo/goal that the user works through over multiple sessions.
- Three triggers for new paths: note-driven (auto-detect from notes), goal-driven (conversational picker), coach-prescribed (from `/coach/athletes/:id`).
- Session-bound steps with auto-completion via `training_technique_logs`.
- Loop-back / refining mechanic so plateaus get caught and addressed before the user advances.
- Path completion spawns related and "defend it" follow-up paths.

**Non-goals**
- Unstubbing the `SkillTree` page — out of scope, stays as the existing "Coming soon" placeholder.
- Plateau detection from sparring ratings, RPE, or session frequency — only note-content sentiment + the new 1-tap feedback signal feed plateau logic.
- Free-tier access — Pro-only.
- Replacing or modifying the calendar-side `TrainingSummarySection`. That feature continues unchanged.

---

## 3. Architecture Choice

**Path-First (selected).** Persistent `training_paths` data model. Reactive Convex subscriptions feed the dashboard widget. A single LLM-backed planner action orchestrates all six AI stages.

Two alternatives considered and rejected:

- **Cards-Stream.** AI emits standalone "next step" cards into a feed with no path entity. Rejected — the 3-active soft cap, roadmap visualization, and pause-path semantics all require a persistent path concept.
- **Curriculum-Calendar.** Steps live directly on training calendar dates. Rejected — separate dashboard widget surface is desired; calendar embedding would weaken the "today's next step" framing.

---

## 4. Data Model

Four new Convex tables, one extension to `training_summaries`. (`training_path_proposals` is defined inline in Section 5.2 alongside its consumer.)

### 4.1 `training_paths`

```ts
training_paths: defineTable({
  userId: v.id("users"),
  sport: v.string(),                      // BJJ / Boxing / Muay Thai / ...
  goal: v.string(),                       // "Master kimura from side control"
  goalType: v.union(
    v.literal("note"),
    v.literal("goal"),
    v.literal("coach"),
  ),
  status: v.union(
    v.literal("active"),
    v.literal("queued"),
    v.literal("paused"),
    v.literal("completed"),
    v.literal("archived"),
  ),
  sourceTechniqueId: v.optional(v.id("techniques")),
  sourceCoachId: v.optional(v.id("users")),
  notesContext: v.optional(v.string()),   // Updated when same technique appears again
  createdAt: v.number(),
  lastAdvancedAt: v.number(),
}).index("by_user_status", ["userId", "status"])
  .index("by_user_sport", ["userId", "sport"]),
```

### 4.2 `training_path_steps`

```ts
training_path_steps: defineTable({
  pathId: v.id("training_paths"),
  position: v.number(),                   // Display order — supports inserts via fractional rebalance
  state: v.union(
    v.literal("upcoming"),
    v.literal("current"),
    v.literal("completed"),
    v.literal("remedial"),
  ),
  prescription: v.string(),               // One-liner — the hero card title
  wizardLine: v.string(),                 // Wizard-voiced opener
  details: v.object({
    why: v.string(),
    how: v.array(v.string()),             // 3-5 sub-bullets
    pitfalls: v.array(v.string()),
  }),
  targetTechniqueId: v.optional(v.id("techniques")),
  targetSport: v.string(),
  expectedSessions: v.number(),           // 1 for session-bound v1; future-proof
  completedAt: v.optional(v.number()),
  completedFeedback: v.optional(v.union(
    v.literal("nailed"),
    v.literal("off"),
  )),
}).index("by_path_position", ["pathId", "position"]),
```

### 4.3 `training_path_feedback`

```ts
training_path_feedback: defineTable({
  pathId: v.id("training_paths"),
  stepId: v.id("training_path_steps"),
  userId: v.id("users"),
  feedback: v.union(v.literal("nailed"), v.literal("off")),
  at: v.number(),
}).index("by_path_at", ["pathId", "at"]),
```

Kept separate from `training_path_steps` because plateau evaluation needs to see consecutive feedback events. If a remedial loop fires, the original step gets re-completed with a new feedback row — history matters.

### 4.4 `training_summaries` extension

Add `extractedTechniques: v.optional(v.array(v.string()))` to the existing schema. The weekly summary action already runs LLM extraction; piggybacking this field hands candidates to the path-extraction stage without a duplicate LLM call.

### 4.5 Derived query: `pathSlotUsage`

```ts
pathSlotUsage(userId): {
  active: number;     // Count where status = "active"
  max: 3;             // Hard constant
  queued: number;     // Count where status = "queued"
  paused: number;     // Count where status = "paused"
  isPro: boolean;
}
```

Widget reads this to gate the "Create new path" action and to render the upgrade CTA for free users.

---

## 5. AI Pipeline

Single orchestrator action `convex/actions/trainingCoachPlanner.ts` exposes `run({ trigger, payload })` where:

```ts
trigger ∈ "sessionSave" | "manualRefresh" | "goalCreated"
        | "coachPushed" | "stepFeedback"
```

It branches into six internal stages:

### 5.1 `extractCandidates` — Groq `llama-3.1-8b-instant`

- **Input:** notes from sessions modified since `lastRun` watermark
- **Output:** `[{ technique, sport, confidence }]`
- **Dedup smart-detect:** Cross-references the user's active paths. If a candidate matches an existing path's `sourceTechniqueId` (case-insensitive normalized), it silently merges into that path's `notesContext` field — no banner surfaces.
- Cheap model is appropriate; extraction is structured token-tagging, not reasoning.

### 5.2 `proposePath` — server logic, no LLM

- Writes a row to a small persisted table `training_path_proposals` for each non-dup candidate (so the banner survives page refreshes).
- Dashboard widget queries `getActivePathProposals(userId)` reactively and renders `PathProposalBanner` components.
- Banner: "Spin up a path for [Technique]? [Yes] [Not yet]"
- "Not yet" patches the proposal row with `snoozedUntil = now + 7d`; the query filters out snoozed proposals server-side. Snoozed rows are GC'd by a cron after 30 days.
- Decline 3 times in 30 days → adds to user-level "never suggest" list (30-day TTL) on the `users` row.

Add a fourth Convex table for this:

```ts
training_path_proposals: defineTable({
  userId: v.id("users"),
  technique: v.string(),
  techniqueNormalized: v.string(),
  sport: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("accepted"),
    v.literal("snoozed"),
    v.literal("declined"),
  ),
  snoozedUntil: v.optional(v.number()),
  declineCount: v.number(),
  createdAt: v.number(),
}).index("by_user_status", ["userId", "status"])
  .index("by_user_normalized", ["userId", "techniqueNormalized"]),
```

### 5.3 `generateSteps` — Groq `gpt-oss-120b`, JSON-mode

Fires when:
- User confirms a proposal
- A goal-driven path is created
- Coach prescribes a path

**Prompt context inputs:**
- `sport`, `goal`, recent notes for that technique
- `activeCamp` info if any (camp name, daysToFight, phase)
- User's current technique level from `user_technique_progress`
- Recent step history for related techniques

**Fight-camp-aware weighting:** When `daysToFight` ≤ 28, prompt instruction shifts step mix toward "live" and "finish" steps. Foundational drill steps get downweighted. When `daysToFight` ≤ 7 (fight week), planner refuses to generate new exploratory paths — only refines existing ones.

**Output JSON shape:**
```ts
{
  steps: Array<{
    position: number;          // 1-indexed
    prescription: string;
    wizardLine: string;        // 1 sentence, opens with addressee name
    details: { why: string; how: string[]; pitfalls: string[]; };
    targetSport: string;
    expectedSessions: 1;
    targetTechniqueId?: Id<"techniques">;  // populated via fuzzy match
  }>;
}
```

Persisted atomically; if any step fails validation (missing `wizardLine`, step count outside [5, 8]), the whole batch rolls back.

### 5.4 `advanceStep` — server logic, no LLM

Fires from a Convex subscription on `training_technique_logs` inserts:

1. Look up active steps where `state = "current"` and `targetTechniqueId` matches the new log's `techniqueId` (or fuzzy-match on technique name if `targetTechniqueId` is null).
2. Patch step: `state = "completed"`, `completedAt = now`.
3. Promote `position + 1` step to `state = "current"` (skipping over any remedial step already in `current`).
4. Surface the 1-tap "How'd it go?" prompt client-side via a transient flag.
5. If `position + 1` doesn't exist → fire `completePath`.

### 5.5 `evaluatePlateau` — Groq `gpt-oss-120b`

Two parallel signal sources feed this stage:

- **High-signal: 1-tap feedback.** Two consecutive `"off"` feedbacks on the same `pathId` → fires immediately.
- **Low-signal: note re-mentions.** When `extractCandidates` matches an existing path's technique, it pre-filters notes for stall regexes (`couldn't`, `got countered`, `swept me`, `still struggling`, `kept losing`). If matched, queues a low-priority `evaluatePlateau` call. The LLM confirms whether the language genuinely indicates a stall vs. neutral mention.

**Output:** A single `remedial` step inserted at `position = currentStep.position` (current step shifts down by 1 via fractional position rebalance). The remedial step's `wizardLine` opens with a non-shaming frame: "Let's refine before we push forward — try this..."

**Cap:** Max 2 remedial steps per path. Third stall → AI generates a one-time "branch to prerequisite" banner: "It might help to step back to [prerequisite path] first. [Switch focus] [Stick with it]". After this branch banner, plateau detection is paused on that path for 14 days.

### 5.6 `completePath` — Groq `gpt-oss-120b`

Fires when the final step completes:

1. Patches path: `status = "completed"`.
2. Promotes one queued path (if any) to `active`.
3. Levels up the user's `user_technique_progress` row for `sourceTechniqueId`.
4. Generates two proposals atomically:
   - **Related path** — if `technique_edges` has outbound edges from `sourceTechniqueId`, picks the highest-confidence edge. Else LLM-suggests a follow-up.
   - **Inverse defense path** — LLM generates "Defend the [technique]" with steps mirroring the offensive curriculum from the receiving end.
5. Both surface as `PathProposalBanner` (user opts in; not auto-created).
6. Client receives a completion event → confetti + haptic celebration.

### 5.7 Cadence & Reliability

| Trigger | When fires | Rate limit | LLM stages |
|---------|-----------|-----------|-----------|
| `sessionSave` | `fight_camp_calendar.upsertSession` writes with non-empty notes | Debounced 2s | extract → propose, advance (no LLM) |
| `manualRefresh` | Widget refresh button | 1/hour per user | extract → propose |
| `goalCreated` | `NewGoalDialog` submit | n/a (user-triggered) | generateSteps |
| `coachPushed` | Coach-side `prescribePath` mutation | n/a (coach-triggered) | generateSteps |
| `stepFeedback` | Client writes a `training_path_feedback` row | n/a (event-driven) | evaluatePlateau (if 2x "off") |

All Groq calls reuse the existing fetch + `AbortController(15s)` pattern from `convex/actions/recovery-coach/index.ts`. Outputs are cached via `AIPersistence` keyed by `(pathId, stage)` for 24h to soak retry storms.

---

## 6. User Flows

### 6.1 Dashboard widget — `TrainingCoachWidget`

Replaces the existing `TrainingInsightsWidget` on `src/pages/Dashboard.tsx`. Renders inside the same widget grid slot.

Layout:

```
┌─────────────────────────────────────┐
│ TRAINING COACH      [↻ refresh]     │
│ ╔═══════════════════════════════╗   │  ← Hero step card
│ ║ 🧙 "Alright Pratik — solo 50  ║   │    (wizardLine + prescription)
│ ║    kimura reps, hip out before ║   │
│ ║    you grab."                  ║   │
│ ║ Step 3 of 7 · Kimura from side ║   │
│ ║ ────────────────────────────── ║   │
│ ║ Up next: Partner drill under   ║   │  ← Next-2-steps preview
│ ║ failed-grip pressure           ║   │
│ ║ Then: Live spar — hunt it once ║   │
│ ╚═══════════════════════════════╝   │
│                                     │
│ ──── Active paths ────                │
│ [kimura ●●●○○○○] [jab-cross ●●○○○○○] │  ← Path progress carousel
│ [▶ Up next: Open guard sweeps]      │  ← Queued path peek
└─────────────────────────────────────┘
```

### 6.2 Step Detail sheet (tap hero card)

Bottom sheet with:
- `prescription` (large headline)
- `wizardLine` (italic, mascot avatar)
- `details.why` (1 paragraph)
- `details.how[]` (numbered list, 3-5 items)
- `details.pitfalls[]` (bulleted, warning-colored)
- Buttons: **Open in calendar** (deep-links to matched session), **Pause path**

### 6.3 Roadmap sheet (tap a path chip)

Full-screen sheet with vertical roadmap and checkpoints:
- Completed steps: filled green node, timestamp, feedback emoji (👍/👎)
- Current step: glowing blue, pulse animation
- Upcoming steps: greyed outline
- Remedial steps: amber refining badge, "Inserted to address [stall reason]"
- Sticky header: path name + ⋯ menu (Pause / Archive)
- "Paused" tab at bottom shows paused paths for this user with Resume buttons

### 6.4 Path proposal banner

Slides in above the widget after `sessionSave` when `extractCandidates` returns non-dup candidates:

```
┌────────────────────────────────────────┐
│ 🧙 Spin up a path for Kimura from      │
│    Side Control?                       │
│                  [Yes]  [Not yet]      │
└────────────────────────────────────────┘
```

- **Yes** → triggers `generateSteps` action → banner morphs to a loading state → banner replaced by the hero card on completion
- **Not yet** → 7-day snooze stored in `localStorage`

### 6.5 Goal-driven path creation

`+` button on widget → `NewGoalDialog` opens. Wizard-voiced three-step conversational flow:

1. **"Which discipline?"** → picker constrained to sports the user trains
2. **"What outcome are you chasing?"** → free-text input + 4 quick-pick suggestions sourced from common goals (e.g., "Land my jab-cross in sparring", "Pass closed guard reliably")
3. **Confirm screen** → previews path goal + sport → "Create path"

Loading state shows the wizard mascot's thinking animation (~3-5s while `generateSteps` runs).

### 6.6 1-tap feedback

After `advanceStep` fires, a thin inline strip slides into the hero card:

```
How'd it go?  [👍 nailed]  [👎 still off]
```

Single tap writes a `training_path_feedback` row and dismisses the strip. If the response is `"off"` AND it's the second consecutive `"off"` for this path, the `stepFeedback` trigger fires immediately → `evaluatePlateau` runs.

### 6.7 Coach-prescribed flow

On `/coach/athletes/:id` (the existing `AthleteDetail` page), a new section:

```
┌──────────────────────────────────────┐
│ Prescribe a path                     │
│ ──────────────────────────────────── │
│ Technique/goal: [_________________]  │
│ Sport:          [BJJ ▼]              │
│                       [Preview steps]│
└──────────────────────────────────────┘
```

After "Preview steps" → coach sees the 5-8 generated steps in a list, can inline-edit any step's `prescription` and `details`. "Send to athlete" persists the path with `goalType: "coach"` and `sourceCoachId`.

Athlete-side: new path appears with a "🥋 Coach Mike sent this" ribbon. Coach-prescribed paths **don't count against the 3-active soft cap** but are limited to **3 coach pushes per athlete per week** to prevent spam.

### 6.8 Pause flow

Tap "Pause" anywhere in the UI → path's `status` becomes `"paused"`. Active slot frees up — any queued path auto-promotes. Paused paths visible in the Roadmap sheet's "Paused" tab with a Resume button. Resuming returns the path to its previous `current` step verbatim.

### 6.9 Cold-start state

Empty widget body shows:

```
No paths yet.

[Log a session]   [Set a goal]
```

- **Log a session** → navigates to `/training-calendar` with the note input focused
- **Set a goal** → opens `NewGoalDialog` directly

---

## 7. Pro Gating

- Feature gate: `usePaywall().hasFeature("training-coach")` — extends the existing freemium model
- Free users: widget renders in a locked state with copy "Upgrade for personalized training paths" and a single CTA button to the paywall
- Pro users: 3 active slots, unlimited queued, all three triggers enabled
- Server-side: every `proposePath`, `generateSteps`, `evaluatePlateau`, `completePath` call invokes `requirePro(ctx)` BEFORE consuming LLM tokens
- `pathSlotUsage(userId)` query is the source of truth for widget gating UI

---

## 8. Edge Cases

| Case | Behavior |
|------|----------|
| User logs a session offline | Optimistic technique log writes to local cache; planner runs when Convex reconnects |
| Notes mention 5+ new techniques in one session | First 3 surface as proposal banners immediately; remainder queued and surface over next 7 days (1/day cadence) |
| User declines the same proposal 3x in 30 days | Technique added to per-user "never suggest" list with 30-day TTL |
| Coach pushes a path conflicting with an active note-driven one | Coach intent wins — replacement modal on athlete side: "Coach Mike sent a path for Kimura, replacing your current one. [Accept] [Keep mine]" |
| User clears all their session notes | Active paths and their step history stay intact; any pending `path_proposals` banners get retracted |
| Subscription lapses mid-path | Existing paths stay readable in roadmap sheet; no new steps generate, no plateau evaluation; widget shows "Resubscribe to continue your training paths" CTA |
| Path has 0 matching sport sessions for 14 days | Auto-paused with a banner: "You haven't trained [sport] lately — pause this path?" Single confirmation puts it in paused state |
| User reaches the 3-active cap and accepts a 4th proposal | New path queued automatically; banner clarifies "We'll start this when a slot opens" |
| Fight week (≤7 days to fight) | `generateSteps` refuses new paths; existing paths shift toward "execute what you own" steps; banners suppressed for new exploration |

---

## 9. Telemetry & Success Metrics

Track in existing analytics pipeline:

- `path.created` (by `goalType`)
- `path.proposed.accepted` / `path.proposed.declined`
- `step.completed` (with `feedback`)
- `path.completed`, `path.paused`, `path.archived`
- `plateau.detected` (with `signalSource: "feedback" | "notes"`)
- `coach.path.pushed` / `coach.path.accepted`

Top-line metrics watched in first 4 weeks post-launch:
- % Pro users with ≥1 active path within 7 days of feature flip
- Median path completion rate (steps completed / total steps)
- Plateau loop-back acceptance rate (do users find remedial steps useful?)
- Pro retention delta among users with vs. without an active path

---

## 10. Testing Strategy

- **Unit:** TDD London-school mocks for each planner sub-stage. Groq fetch mocked.
- **Integration:** Four end-to-end scenarios under `tests/training-coach/`:
  1. Happy path: notes → confirm → 3 steps complete → completion proposals appear
  2. Plateau: 2x "off" feedback → remedial step inserted → user completes remedial → next step promotes
  3. Completion: final step completes → related path + defense path banners appear
  4. Coach push: coach prescribes from `/coach/athletes/:id` → athlete accepts → path appears with ribbon
- **Snapshot:** widget layout in light + dark mode, including locked-state for free users
- **LLM output validators:** reject responses missing `wizardLine`, missing required `details` fields, or with step count outside [5, 8]

---

## 11. Migration

- New tables added via standard Convex schema deploy
- Existing `TrainingInsightsWidget` deleted in the same PR that introduces `TrainingCoachWidget`
- The unused `convex/actions/trainingInsights.ts` action is deleted (its three-step pathway output is subsumed by `generateSteps`)
- No data backfill required — paths only generate going forward
- Feature flag: `enableTrainingCoachPaths` (default off) → enables in stages: internal users → 10% Pro → 100% Pro

---

## 12. Out of Scope (Explicit)

- Sparring rating, RPE, and step-completion-latency as plateau signals (only notes + feedback for v1)
- `SkillTree.tsx` unstubbing
- Multi-session steps (`expectedSessions > 1`)
- Free-tier access to the feature
- Curated drill library (LLM generates each step fresh)
- Community-validated steps (network-effect content)
- Sparring partner cross-reference (privacy-sensitive; deferred)
- Mastery Streak counter (gamification overlap — deferred)

---

## 13. Open Questions

None at design freeze. All decisions captured above were made by stakeholder in 2026-05-21 brainstorm session.
