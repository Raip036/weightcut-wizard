# Round Card — Photo-First Tracking (Minimum Viable Flow)

**Date:** 2026-05-19
**Status:** Design — awaiting implementation plan
**Owners:** Pratik (product), Claude (synthesis)
**Supersedes:** the earlier 2026-05-19 draft of this spec (CV/AI-heavy version, dropped per Pratik on 2026-05-19)

## 1. Goal

Replace the current 5–7-tap session-logging flow with a **photo-first, three-tap capture** that lands a polaroid on the gym feed. Nothing more. Computer-vision, AI captions, AI Round-Card breakdowns, weekly recap reels, partner co-ownership, geofencing, dashboard hero tiles, throwback prompts — **all explicitly deferred** to a later phase. The only thing we are building right now is: **tap plus → take a photo → log the session → polaroid develops → posts to the gym feed.**

## 2. Why this scope

The current flow's problem is friction, not feature gaps. Solve friction first. Every extra surface (AI, partner tags, recap reels) is a second project that depends on the basic capture flow existing and working. Ship the chassis; bolt on the body later.

## 3. The new flow — three taps

```
Tap 1 — FAB "+"           → native camera opens immediately
Tap 2 — Shutter           → photo captured; ReviewSheet slides up
Tap 3 — "Log & post"      → polaroid develops, drops onto gym feed
```

### 3.1 FAB rewire

`BottomNav` center "+" button:

- **Tap (≤ 350 ms):** fires `Capacitor.Camera.getPhoto({ source: Camera, quality: 80 })` synchronously inside the tap handler. The synchronous origin is critical — iOS revokes the user-gesture token if we route through a sheet or state-driven branch first. `PostComposer.tsx` already proves this pattern works.
- **Long-press (≥ 350 ms):** opens the existing `QuickLogDialog` 4-cell menu. This preserves the legacy structured "Start Workout → exercises → Finish" path for strength athletes who want timers + sets/reps.
- **Haptics:** `ImpactStyle.Medium` on tap; `ImpactStyle.Light` on long-press recognized.
- **Discoverability:** a one-time tooltip on the first BottomNav render after the rewire ships, dismissed forever after the user taps "Got it" or uses the FAB once.

### 3.2 The Camera

The native iOS camera UI takes over, owned by the OS. Front/rear toggle and shutter are Apple's. The only WeightCut affordance overlaid is a small ghost link bottom-left: **"Log without photo"** — taps this and we skip to the ReviewSheet with no media, for the "I just trained, didn't snap anything" case.

### 3.3 The ReviewSheet

After the shutter fires, the OS hands control back to the app. A full-screen ReviewSheet appears with:

```
┌──────────────────────────────────────────┐
│                                          │
│       [polaroid frame, still blank]      │
│                                          │
│   ┌─ chips ──────────────────────────┐   │
│   │  Muay Thai  ·  60 min  ·  Steady │   │  ← tappable to override
│   └──────────────────────────────────┘   │
│                                          │
│   Gym: Crucible Gym                      │  ← from profile primary
│   Caption (optional, single line)        │
│                                          │
│   [   Log & post to gym         →   ]    │  ← primary CTA
│       Log only                           │  ← smaller, beneath
│       Discard                            │  ← smallest, ghost
│                                          │
└──────────────────────────────────────────┘
```

Three chips are pre-filled from straightforward database reads (see §3.4). The user does **not** need to type anything. Caption is optional and explicitly single-line; pressing return saves.

### 3.4 Smart defaults — database-only, no CV

A single Convex query `fight_camp.getSmartDefaults` fills the chips in one round-trip:

| Field | Source |
|---|---|
| `gymId` | `gym_members.by_user_status` — user's primary active gym membership |
| `sessionType` | Today's `fight_camp_calendar` planned row if it exists; else last-used from `localStorage:RECENT_SESSION_KEY` |
| `durationMinutes` | Mean of the last 5 same-type sessions in `fight_camp_calendar`; fallback 60 |
| `intensity / intensityLevel / rpe` | "Steady" (matches the existing QuickLog preset) |

No CoreLocation. No CV. No partner suggestions. No weather. No sleep/weight cross-references. The ReviewSheet never blocks on a defaults-failed state — if any field can't resolve, it shows the chips it has, dims the others, and saves anyway.

### 3.5 The "Log & post" tap

When the user taps the primary CTA:

1. The polaroid frame on-screen **develops**: a 600 ms blur-to-sharp animation, with the metadata strip writing itself in handwritten-feel mono at the bottom ("Muay Thai · 60 min · Crucible Gym · Wed 7:42 PM"). `prefers-reduced-motion` → 200 ms cross-fade.
2. Concurrently, the app writes one row into `fight_camp_calendar` and uploads the photo via the existing `uploadSessionMediaV2`, which already creates the `session_media` row and stamps `gymId` for feed routing.
3. The polaroid then animates from the ReviewSheet's centre into the Corner stack — reusing `PolaroidStack.tsx`'s existing animation. Success haptic on landing (`notificationOccurred(success)`).
4. The user is back where they were before tapping the FAB. The ReviewSheet dismisses itself.

### 3.6 "Log only" and "Discard"

- **Log only:** saves the `fight_camp_calendar` row + uploads the photo as `visibility: "private"`. The polaroid lands in the user's private history (visible in `SessionHistoryList`) but does not appear on the gym feed.
- **Discard:** dismisses the ReviewSheet, drops the photo, writes nothing.

There is **no** sticky-default flip after repeated "Log only" picks. That's a Phase-2 polish. Default-on gym posting is the simple rule today.

## 4. Photo treatment

The polaroid `PolaroidCard.tsx` component gets a new `developing` boolean prop. When `developing` is true, the image inside the frame is rendered with:

- `filter: blur(20px)` → animated to `blur(0px)` over 600 ms (cubic-bezier ease-out)
- A very subtle `transform: rotate(-2deg)` shake (peak `±4deg`) over the first 200 ms
- The metadata strip text fades in 100 ms after the blur transition starts and finishes at the same time as the blur

That's the whole effect. No filters, no stickers, no weight-delta overlays — those were Phase-1 fluff and are explicitly cut. The polaroid frame **is** the entire visual treatment.

## 5. Schema deltas (additive, non-breaking)

`fight_camp_calendar`:

```ts
source: v.optional(v.union(
  v.literal("quicklog"),
  v.literal("round_card"),   // new — set by the photo-first flow
  v.literal("manual"),
)),
```

`session_media`: **no changes**.

`profiles`: **no changes**.

That is the entire schema delta. No new indexes, no new tables, no `partnerUserIds`, no `aiCaption`, no `dominantColor`, no `defaultSessionVisibility`. The existing `session_media.visibility: "gym" | "private"` is enough.

## 6. Component map — what changes

| File | Change |
|---|---|
| `src/components/BottomNav.tsx` | FAB tap handler: fire `Camera.getPhoto` synchronously. Long-press: open existing QuickLogDialog. Small "..." inset affordance on the FAB for users who can't long-press. |
| `src/components/nav/QuickLogDialog.tsx` | No behavior change — relegated to long-press surface. |
| `src/components/community/ReviewSheet.tsx` *(new)* | The full-screen sheet rendered after shutter. Renders the polaroid (with `developing` prop), the three chips, the caption field, and the CTAs. |
| `src/components/community/PolaroidCard.tsx` | Add `developing?: boolean` prop driving the 600 ms blur→sharp transition. |
| `src/components/community/PolaroidStack.tsx` | No behavior change — receives the new polaroid via existing stack-add animation. |
| `convex/schema.ts` | Add `source` to `fight_camp_calendar` (§5). |
| `convex/fight_camp.ts` | New `getSmartDefaults` query. |
| `src/lib/uploadSessionMediaV2.ts` | No change — already does what we need. |

## 7. Reuse — what we get for free

Because we reuse `fight_camp_calendar` + `session_media`, the polaroid automatically appears in:

- The **gym feed** (`gymFeed.listFeed` already filters on `gymId` from the denormalized `session_media.gymId`).
- The user's **profile polaroid grid** (`session_media.by_user_created`).
- The **GymTracker history** (`SessionHistoryList`, `SessionHistoryCalendar` — they query `fight_camp_calendar`).
- The **Training Calendar** day cells.

These are not new features; they are existing surfaces that consume the existing tables. Nothing to build to light them up.

## 8. Anti-patterns — explicitly **not** building

Cut from the earlier draft and explicitly out of scope for this slice:

- Computer-vision session-type inference
- AI Round-Card breakdown (Groq vision + analysis on the photo)
- AI caption suggestions
- AI training-insight ground-truthing on captions
- Weekly recap reel cron
- Throwback prompts cron
- Dashboard "Today" widget hero image tile
- Partner @-tag co-ownership (chips, schema, visibility branch — all deferred)
- CoreLocation geofencing for gym detection
- Weather / sleep / bodyweight cross-reads at save time
- `aiCaption`, `dominantColor` denormalization
- `defaultSessionVisibility` sticky preference flip
- 6-second Undo toast (not in v1 — use existing edit/delete from history)
- 15-min edit window with fly-away un-post (use the existing post-edit flow)
- Empty-state first-session animation, coach toast, gym pre-seed
- Stamp-only "Repeat yesterday" chip
- iOS Share Extension, Live Activity, Siri Shortcut, Apple Watch
- Made-weight pre/post diptych
- Fight-camp poster export
- Cross-gym leaderboards, public global feed, video posts, comment threading

Most of these are reasonable Phase-2/3 ideas. None of them are in this spec.

## 9. MVP — Phase 1 (≈ 1 week, cohesive)

1. Add `source` to `fight_camp_calendar` schema (§5)
2. Implement `fight_camp.getSmartDefaults` Convex query (§3.4)
3. Build `ReviewSheet` component (§3.3)
4. Add `developing` prop + animation to `PolaroidCard` (§4)
5. Rewire `BottomNav` FAB: tap = `Camera.getPhoto` synchronous; long-press = QuickLogDialog (§3.1)
6. Add "Log without photo" ghost link in the camera overlay; route to ReviewSheet with no media (§3.2)
7. Wire ReviewSheet "Log & post" → `fight_camp.create` + `uploadSessionMediaV2` (`visibility: "gym"`) → develop animation → stack landing (§3.5)
8. Wire "Log only" → same but `visibility: "private"` and skip stack landing (§3.6)
9. One-time tooltip on first BottomNav render post-update explaining tap vs long-press

Estimated scope: small, single-PR-able. No new tables, one new query, one new component, one prop added, one handler rewired.

## 10. Risks

- **Discoverability of long-press for power users:** mitigated by the one-time tooltip and the "..." affordance on the FAB.
- **Synchronous Capacitor invocation:** the FAB tap handler must call `Camera.getPhoto` directly. No intermediate sheet, no `setState` round-trip, no `await` before the call. Otherwise iOS revokes the gesture token and the prompt fails.
- **Defaults wrong often enough to feel dumb:** the three chips are tappable to override. If `getSmartDefaults` returns nothing useful (new user, no history), the chips fall back to "Strength · 60 min · Steady" — the same defaults the current QuickLog uses.

## 11. Open questions (decide during the implementation plan, not blocking this spec)

- Is the develop animation CSS / Framer Motion, or a small Lottie file? Default to CSS / Framer Motion for bundle size.
- Where does the caption field live — under the chips, or as a single-line bar above the CTA? Default: under the chips, single-line, autocomplete off.
- Does "Log without photo" still need a session-type chip override, or can it skip the ReviewSheet entirely and write straight to `fight_camp_calendar` with the smart defaults? Default: skip the sheet, write immediately, show a small toast "Session logged."

## 12. North star

> *Tap, snap, done. The polaroid develops. The gym already saw it.*
