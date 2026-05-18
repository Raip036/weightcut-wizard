# Round Card — Photo-First Tracking Redesign

**Date:** 2026-05-19
**Status:** Design — awaiting implementation plan
**Owners:** Pratik (product), Claude (synthesis)
**Related:** `docs/corner-social-tab-plan.md`, `docs/superpowers/specs/2026-05-16-gym-leaderboard-design.md`, `docs/superpowers/specs/2026-05-18-wizard-tutorial-redesign-design.md`

## 1. Goal

Convert the session-logging flow from a multi-modal 5–7-tap form into a **photo-first, two-tap capture** that lands a polaroid on the gym feed by default. This is the engagement loop for retention and the funnel mouth for subscription conversion. The brand already owns the polaroid metaphor; the flow does not yet honor it.

**Success criteria (qualitative — quantitative targets land in the implementation plan):**

- Time from app open to "session saved + posted" ≤ 6 seconds for the happy path
- Tap count from BottomNav FAB to "polaroid on gym feed" = **2 taps** (shutter + primary CTA)
- The user types **zero characters** to complete a logged session
- Existing power-user path (start active session, add exercises, finish) remains reachable via FAB long-press
- No schema break — purely additive deltas

## 2. Diagnosis of current flow

Current happy path (sourced from `BottomNav.tsx`, `QuickLogDialog.tsx`, `GymTracker.tsx`, `SessionMediaPicker.tsx`, `uploadSessionMediaV2`):

```
1. Tap FAB
2. Tap "Log Gym" tile
3. (Optional) Tap session-type chip
4. Tap "Start Workout"
5. Tap "Finish"  (after timer runs)
6. (Optional) Notes/duration/fatigue
7. Tap "Add Photo or Video"  (auto-opened PostWorkoutMediaSheet)
8. Tap "Take Photo" or "Choose from Library"
9. Shutter / pick
10. Tap "Share to Gym"  (or skip)
```

Friction: 5–7 deliberate taps, photo is opt-in *after* save, multiple modal boundaries. The good news: the primitives are already wired — `uploadSessionMediaV2` already auto-routes to the gym feed using denormalized `gymId`, `session_media.visibility` already supports `"gym" | "private"`, `PolaroidStack.tsx` already supports the fly-away gesture, and `PostWorkoutMediaSheet` already merges save + share into one moment. The fix is rewiring, not rebuilding.

## 3. Decision: Approach A — "Photo-First Round Card"

Three approaches were considered:

| | A — Photo-First Round Card *(chosen)* | B — Timer-First w/ Prominent Photo | C — Dual-Mode FAB |
|---|---|---|---|
| FAB tap | Native camera opens immediately | Start active session timer | Sheet with 2 big tiles |
| Tap count to feed | **2** | 4–5 | 3 |
| Best for | Spontaneous post-roll snap (~80% case) | Power users (strength athletes) | Indecisive flows |
| Risk | Power users miss the timer | Doesn't move retention | Re-introduces choice friction |
| Code reuse | High (PostComposer + PostWorkoutMediaSheet merge) | Highest | Medium |

**Chosen: A**, with B's active-session timer preserved as the **FAB long-press** option for users who want the structured workout. Discoverability handled by a one-time tooltip on first launch after the rewire ships.

## 4. The new flow

### 4.1 Entry — FAB rewire

`BottomNav` center "+" button:

- **Tap (≤ 350 ms):** fires `Capacitor.Camera.getPhoto({ source: Camera, quality: 80 })` synchronously in the tap handler. The same synchronous pattern works in `PostComposer.tsx` today — the user-gesture token must not be lost.
- **Long-press (≥ 350 ms):** opens the existing `QuickLogDialog` 4-cell menu upward from the FAB.
- **Haptics:** `ImpactStyle.Medium` on tap, `ImpactStyle.Light` on long-press recognized.
- **Reduce-motion / accessibility:** long-press affordance also exposed as a "..." button inset on the FAB's right edge for users who can't long-press reliably.

### 4.2 Capture flow — two taps

```
Tap 1 (FAB)        → native camera, full-screen, OS-owned
Shutter            → app takes over: Review Sheet
Tap 2 (primary)    → save + post; polaroid drops onto Corner stack
```

The Review Sheet:

```
┌──────────────────────────────────────────┐
│  [developing polaroid 600 ms]            │   ← reuses PolaroidCard
│   Muay Thai · 60 min · Steady            │   ← three pre-filled chips
│   Crucible Gym · Wed 7:42 PM             │   ← geofenced gym banner
│   + tag partner (suggested chips)        │   ← optional, top 5
│   [optional caption — auto-dismiss 2 s]  │
│                                          │
│   [   Log & post to gym       →   ]      │   ← primary
│       Log only · Discard                 │   ← secondary
└──────────────────────────────────────────┘
```

Camera UI carries a tiny ghost link bottom-left: **"Log without photo"** (stamp-only flow).

### 4.3 Photo treatment — "developing polaroid"

- Reuses `PolaroidCard.tsx`.
- Image lands on a white polaroid frame.
- **Develop animation:** 600 ms blur-to-sharp transition + 4 deg micro-shake; the metadata strip writes itself in handwritten-feel mono ("Muay Thai · 60 min · Crucible Gym · Wed 7:42 PM").
- **Optional stickers** on second tap: fight-camp day count · weight delta vs last week · @ partner.
- **No filters.** The polaroid frame *is* the filter.
- `prefers-reduced-motion` → 200 ms cross-fade; metadata writes statically.
- VoiceOver: announces "Session logged. Muay Thai, sixty minutes, posted to Crucible Gym."

### 4.4 Smart defaults — typing budget is zero

New Convex query `fight_camp.getSmartDefaults` (one round-trip; called by the FAB tap handler so defaults are warm by the time the shutter clicks):

| Field | Source |
|---|---|
| `gymId` | `gym_members.by_user_status` (primary active row); CoreLocation one-shot overrides if within 400 m of a different known gym |
| `sessionType` | Today's `fight_camp_calendar` planned row if present; else last-used from `localStorage:RECENT_SESSION_KEY` |
| `durationMinutes` | Mean of last 5 same-type sessions; fallback 60 |
| `intensity / intensityLevel / rpe` | "Steady" (matches existing QuickLog preset) |
| `bodyweight` | Latest `weight_logs` row from today/yesterday |
| `sleepHours/Quality` | Today's `daily_wellness_checkins` if present |
| `partnerSuggestions` | Top 5 gym members ranked by recent-30-day session overlap |
| `fightCampPhase` | Active `fight_camps` row → build / peak / fight-week |
| `weather` | OpenMeteo silent fetch on submit (no API key) |

Every field has a fallback. The Review Sheet never blocks on a defaults-failed state — it shows the chips it has, dims the rest, and saves anyway.

### 4.5 Posting & visibility

- **Default-on** posting to the gym feed. Peer culture works only if default-on.
- **"Log only"** is a smaller affordance one inch below the primary CTA. If a user picks "Log only" two posts in a row, the default flips for them. **No popup, no nag.** Stored as `profiles.defaultSessionVisibility`.
- `session_media.visibility` already supports `"gym" | "private"`. Extend to add `"partners"` (visible only to author + tagged partners + author's gym leaderboard aggregates).
- **Partner @-tag = co-ownership.** A `session_media` row with `partnerUserIds: [userB]` surfaces in `userB`'s gym feed and profile grid, counts for both users' streaks/leaderboards, and lets `userB` reciprocate-tag any included session without re-uploading.

### 4.6 Edit-after-post grace

- **6-second Undo toast** on post (mirrors iOS Mail delete-send).
- **15-minute edit window** for caption, session-type chip, visibility. Triggered by long-press on the polaroid in Corner.
- **Un-post within 15 min:** swipe the polaroid up off the top of the Corner stack — gesture already supported by `PolaroidStack.tsx`.
- **After 15 min:** photo locked, caption stays editable forever, engagement counts preserved.

### 4.7 First-session magic (empty state)

- Pre-log Corner shows three ghost polaroids, captioned *"Tomorrow's first session goes here."*
- On the user's first-ever logged session:
  - Develop animation runs **slower** (1.4 s vs 600 ms)
  - Full-bleed `celebrateSuccess` haptic
  - Coach-voiced toast: *"First one's logged — your gym just saw it"*
  - **Pre-seed** the gym's three most recent posts below the new polaroid so the feed never feels empty.

## 5. Reuse cases — one row, eleven surfaces

A single insert into `fight_camp_calendar` + (optional) `session_media` lights up:

1. **Gym feed** `TikTokFeedSwiper` — already auto-wired via denormalized `gymId`
2. **Profile polaroid grid** — `session_media.by_user_created`
3. **Dashboard "Today" widget hero image** — newest `session_media` thumb
4. **Training-volume charts** — `TrainingLibrary`, `FightCampSummaryCard`; photos become tap-through evidence on chart bars
5. **Fight-week timeline** — `FightWeekSummaryCard`; photo pinned to each day
6. **AI training-insight prompts** — `trainingInsights.ts`, `trainingSummary.ts` already read the calendar; pass `aiCaption` and `partnerUserIds` to ground claims like "you sparred 3× with X this week"
7. **Weekly recap reel** — Sunday cron renders 7-day stacked polaroids; Story export via existing `share/cards/` infra
8. **Throwback prompts** — daily cron scans `by_user_date` − 365d ("1 year ago you sparred 90 min")
9. **Gym leaderboard "Most Logged" board** — `gymLeaderboard.ts` already exists; volume + photo-attached rate becomes a new column
10. **Fight-camp poster export** — `MadeWeightShareSheet` style poster built from camp-window `session_media` thumbs + totals
11. **Partner-tag inbox** — tagged users see "Jake added you to a session" with a one-tap confirm/decline

Every surface is a thin query over an existing index (`by_user_date`, `by_user_created`, `by_gym_created`, or the new `by_partner_created`). **No fan-out writes.**

## 6. Subscription conversion hooks (Pro)

Habit stays free; intelligence is Pro. Conversion lands at peak emotional engagement, never blocks the core habit loop.

- **AI Round-Card breakdown** — Groq `llama-4-scout` vision on the photo + `gpt-oss-120b` for analysis. Surfaces as a "Coach says…" expandable on the saved Round Card. Pro.
- **Weekly recap reel** — motion video set to music for Pro; static grid for free. People will pay $4.99/mo to share *this* to IG/Stories.
- **Fight-camp analytics + made-weight projection** unlocked at week-3 of an 8-week camp (when cutter anxiety peaks). Pro.
- **AI caption suggestions** on the Review Sheet (post-upload, async). Pro.
- **Recovery-coach post-session insight** stays free but gated at 1/day (matches existing freemium rule).

## 7. Anti-patterns — explicitly out of scope

Do **not** build any of these in any phase:

- Public global feed beyond the gym
- Public weight numbers on the feed (eating-disorder vector + privacy)
- Strava-style kudos counts visible to others (status anxiety drives lurking not posting)
- Streak punishment ("you lost your 47-day streak")
- Generic motivational quotes / "rise & grind" overlays
- AI-generated hype captions
- AI face-tagging of partners (legal landmine)
- Cross-gym leaderboards (privacy minefield)
- Wearable / glove-tap / HR fusion
- Video posts in v1 (schema supports; UX doesn't)
- Stories-style timed expiry (polaroid fly-away already covers ephemerality)
- Comment threading (flat comments only — already the shape in `feed_comments`)

## 8. Schema deltas (additive, non-breaking)

`fight_camp_calendar`:

```ts
partnerUserIds: v.optional(v.array(v.id("users"))),
locationLabel:  v.optional(v.string()),
source:         v.optional(v.union(
                  v.literal("quicklog"),
                  v.literal("share_ext"),
                  v.literal("widget"),
                  v.literal("siri"),
                  v.literal("manual"),
                )),
```

`session_media`:

```ts
partnerUserIds: v.optional(v.array(v.id("users"))),  // denormalized from session row
aiCaption:      v.optional(v.string()),
dominantColor:  v.optional(v.string()),              // for share-card theming
// extend visibility union:
visibility: v.union(v.literal("gym"), v.literal("private"), v.literal("partners")),
```

`profiles`:

```ts
defaultSessionVisibility: v.optional(v.union(
                            v.literal("gym"),
                            v.literal("private"),
                          )),
```

New index on `session_media`:

```ts
.index("by_partner_created", ["partnerUserIds", "createdAt"])
```

(If the array-index approach proves expensive, fall back to a join table `session_media_partners` with `mediaId`, `partnerUserId`, `createdAt` — defer the call to implementation pass.)

New Convex modules:

- `convex/fight_camp.ts` → `getSmartDefaults` query, `repeatYesterday` mutation
- Mutation `feedSocial.unpostMedia` (15-min window) — soft-delete pattern

## 9. Component map — what changes

| File | Change |
|---|---|
| `src/components/BottomNav.tsx` | FAB tap → camera handler (synchronous Capacitor call); long-press → existing QuickLogDialog |
| `src/components/nav/QuickLogDialog.tsx` | No behavior change; relegated to long-press menu |
| `src/components/community/PostComposer.tsx` | Capture path extracted into shared hook `useSessionCapture` |
| `src/components/fightcamp/PostWorkoutMediaSheet.tsx` | Merge with PostComposer into a single **ReviewSheet** component (new) |
| `src/components/fightcamp/SessionMediaPicker.tsx` | Unchanged — still used for retroactive media on existing sessions |
| `src/components/community/PolaroidCard.tsx` | Add `developing` prop driving the 600 ms blur→sharp transition |
| `src/components/community/PolaroidStack.tsx` | Unchanged — already supports fly-away (un-post) |
| `convex/schema.ts` | Additive deltas (see §8) |
| `convex/fight_camp.ts` | New `getSmartDefaults`, `repeatYesterday` |
| `convex/gymFeed.ts` | `listFeed` adds visibility branch for `"partners"` |
| `convex/feedSocial.ts` | New `unpostMedia` (15-min soft-delete) |
| `src/pages/Dashboard.tsx` | "Today" widget hero image tile (new). `Index.tsx` is the auth-spinner/redirect page and is unchanged. |

## 10. MVP — Phase 1 (≈ 2 weeks, cohesive ship)

1. FAB rewire — tap = camera, long-press = legacy menu, tooltip on first launch
2. `getSmartDefaults` Convex query
3. Schema deltas in §8 (additive)
4. **ReviewSheet** component (merge `PostComposer` capture + `PostWorkoutMediaSheet`)
5. Developing-polaroid animation in `PolaroidCard`
6. **"Repeat yesterday"** chip on ReviewSheet → `fight_camp.repeatYesterday` single mutation
7. **"Log without photo"** stamp-only ghost link in camera UI
8. Partner @-tag chip + co-ownership (`partnerUserIds` array, visibility branch in `gymFeed.listFeed`)
9. Today-widget hero image on Dashboard
10. Undo toast (6 s) + 15-min edit window + un-post via fly-away
11. First-session empty-state magic (slow develop, coach toast, gym pre-seed)
12. One-time tooltip on first BottomNav render post-update

### Deferred to Phase 2+

- iOS Share Extension
- Live Activity / lock-screen widget
- Siri Shortcut / App Intents
- Weekly recap reel cron
- Throwback prompts cron
- AI caption suggestions (Pro)
- AI Round-Card breakdown (Pro)
- Fight-camp poster export
- Made-weight pre/post diptych composer
- Apple Watch complication

## 11. Risks

- **Discoverability:** users may not know "tap = camera, long-press = menu." Mitigated by one-time tooltip + the small "..." affordance on the FAB.
- **CoreLocation permission:** geofenced gym detection requires permission; flow degrades gracefully to primary-gym default.
- **`partnerUserIds` array index** may not scale beyond ~50 k posts/gym. Fallback: join table `session_media_partners`.
- **"Default-on" posting** could feel intrusive for the privacy-fighter cohort (cutters, late-night solo work). Mitigated by the silent sticky-preference flip after two "Log only" picks in a row.
- **Synchronous Capacitor camera invocation** must originate from the user-gesture handler. If we route through a sheet/dialog first, iOS revokes the gesture token. The FAB tap handler must fire `Camera.getPhoto` directly with no intermediate state-driven branch.

## 12. Open questions

These do not block writing the implementation plan but should be decided during planning:

- Does the developing-polaroid animation run on the device (Lottie / CSS) or as a pre-rendered video? CSS preferred for size.
- Is "Repeat yesterday" gated to "same gym today" or unconditional?
- Should `partnerUserIds` co-ownership be **bilateral** (both must confirm) or **unilateral with decline** (tag lands, partner can dismiss)? Recommended: unilateral with decline — bilateral adds friction.
- Does the AI Round-Card breakdown run on every post (cost) or on-demand when the user taps "Coach says…"? Recommended: on-demand.

## 13. North star

> *One tap, one shutter, one breath later — the polaroid is on the wall and the gym already saw it.*
