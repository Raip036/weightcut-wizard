# Community ("Corner") Tap-Deck Redesign — Design Spec

**Date:** 2026-06-04
**Branch:** feature/onboarding-ui-improvements
**Status:** Approved via interactive localhost mockup (http://localhost:8723)

## Goal

Make the gym-scoped Community tab feel like a premium, dynamic social surface.
Three concrete outcomes:

1. **Tap-to-advance photo deck** — replace the Tinder-style horizontal *swipe*
   with an Instagram-stacks-style *tap*: press-dip → card flies off → next card
   springs up from underneath. Feels like a real, instantly-rendered deck of
   cards with haptic feedback on every tap.
2. **Comments on first glance** — session type, latest comment, quick-reacts and
   the comment input all sit **directly beneath the photo** (no dead space, no
   stranding them by the nav bar). Session type sits **inline on the same row**
   as the latest comment.
3. **Premium full-page polish** — gym identity header, podium, and surrounding
   chrome tightened to match.

## Decisions (locked with user)

| Decision | Choice |
|---|---|
| Like gesture | Tap = advance only. Like via a **floating heart on the photo** + heart on the info block. No tap-to-like / double-tap-to-like. |
| Layout | **Instagram overlay**: author + time top-left on photo, card counter top-right, floating heart bottom-right, caption bottom-left on photo. Session type + comments **below** the photo. |
| Session type position | **Inline** on the same row as the latest-comment preview, directly under the photo. |
| End of deck | Keep current "You're all caught up" wizard empty state. |
| Scope | Full page: deck + below-photo block (P0); gym header + podium polish (P1). |
| Fly-off direction | **Up & away** with a peel tilt (default; toggle confirmed in mockup). |

## Animation spec (from research agent, tuned in mockup)

- **Press-down:** `scale: 0.96`, spring `{ stiffness: 700, damping: 30 }` (~100ms). The single biggest "premium" tell for a tap interaction.
- **Fly-off (committed card):** up-and-away. `y: -(0.85 * cardHeight)`, `x: ±(0.15 * cardWidth)` (alternate sign per tap for organic variety), `rotate: ±9°`, `scale → 1.04`, opacity fades over the last ~40% of travel. Tween `ease: [0.32, 0.72, 0, 1]`, `duration: 280ms` (deterministic — repeatable under rapid tapping, unlike a re-triggered spring). Reduced-motion: 110ms linear fade.
- **Underneath-card promotion (deck settle):** keep RoundedFeedCard's existing promote spring (`stiffness: 220, damping: 28`); it already reads as a clean settle. Cards behind use the existing `STACK_OFFSETS` (scale 0.96/0.92, y 10/20, opacity 0.7/0.4).
- **Haptics (native-guarded, via `src/lib/haptics.ts`):** press-down → `triggerHapticSelection()`; commit/advance → `triggerHaptic(ImpactStyle.Light)` (down from Medium — Light = casually flipping photos). Debounce so a fast tap doesn't double-buzz.

## Architecture changes

### Read order, top → bottom (new)
Page header → Announcements → **Gym identity header (polished)** → Trained-today banner → **Photo deck (tap)** → **Session-type · latest-comment row** → **Quick-react bar** → **Comment input** → **Podium (polished)**.

### Components touched

1. **`PolaroidStack.tsx`** (deck) — the core change.
   - Remove `drag`, `dragElastic`, `onDragEnd`, the `dragX`/`dragMagnitude` motion plumbing, and the snap-back path. The deck no longer swipes.
   - `TopCard` becomes tap-driven: `onPointerDown` → press-dip (`scale 0.96`); `onClick` → `commitAdvance()`.
   - `commitAdvance()` reuses the existing `exitingPost` + `exitingNode` fly-off mechanism, but the trajectory is **up-and-away** (not horizontal drag direction), direction alternates via a `flyDirRef`, and it fires `onSwipeCommit(topPost.id)` + `advance()` exactly as the swipe path did — so the page's `pendingDismissalRef` → `handleAdvance` → `markPostViewed` flow is untouched.
   - Tap no longer calls `onDoubleTapLike`; remove the glove-burst-on-tap. (Glove SVG/burst code deleted — like now lives on the heart button.)
   - **Remove the in-deck engagement section** (emoji bar + inline comments + comment input, current lines ~333–366). The deck becomes pure photo. Those move into the below-photo block.
   - Add a **card counter** ("2 / 7") top-right and a **floating heart button** bottom-right, rendered as overlays on the top card (either here or in RoundedFeedCard — see below).
   - Keep: deck drop-in, deterministic rotation, preload, pagination, empty/last-card states, reduced-motion.

2. **`RoundedFeedCard.tsx`** (photo card) — add two overlays on the top card:
   - **Card counter** top-right (`index+1 / total`), glass pill.
   - **Floating heart button** bottom-right — bound to the shared engagement (`liked`, `toggleLike`, like burst). `stopPropagation` so it never advances the deck. Author overlay (top-left) and caption overlay (bottom-left) stay.
   - Counter + heart need `currentIndex` / `total` and the engagement handle → pass from PolaroidStack via new optional props (kept optional so other RoundedFeedCard consumers — story templates — are unaffected).

3. **`SessionInfoCard.tsx`** → becomes the **below-photo block**, restructured:
   - **Row 1 (inline):** session-type chip (icon + label, e.g. `🥊 Muay Thai · 60 min · RPE 8`) on the left, **inline** with the latest-comment preview + count on the right (tap → comments sheet). When no comments, the row shows the session meta only.
   - Caption moves to the photo's bottom overlay (already rendered by RoundedFeedCard), so it is NOT duplicated here.
   - **Quick-react bar:** the `EmojiReactionBar`, moved here from PolaroidStack.
   - **Comment input:** the `CommentInputBar`, moved here from PolaroidStack.
   - Keep the like/comment counts available (heart count is on the photo; a compact comment count lives in Row 1). Inline 2-comment preview from `listLatestComments` is collapsed into Row 1's "latest comment" + a "View all N" affordance.
   - Wiring: `CommunityFeedSection` already builds `stackEngagement` (onReact / onSubmitComment / onSeeAllComments) and `topEngagement`; pass both into `SessionInfoCard` instead of into `PolaroidStack`.

4. **`Community.tsx` (`CommunityFeedSection`)** — re-wire: stop passing `engagement` into `PolaroidStack`; pass reaction/comment handlers into `SessionInfoCard`. Pass `onDoubleTapLike` removal. Everything else (dismissedIds, handleAdvance, markPostViewed deferral) stays identical.

5. **`GymHeader.tsx`** (P1 polish) — premium identity card: gradient-tinted logo tile, subtle radial primary glow, live green "training this week" dot, tightened type. Keep the bell + profile-open + invite affordances.

6. **`LeaderboardSection.tsx` / `PodiumHero.tsx` / `PodiumPlace.tsx`** (P1 polish) — medal-colored avatar rings (gold/silver/bronze), #1 plinth tinted with the primary, session-count subline. Filter tabs kept functional, visually aligned. No data/query changes.

## Risk / non-goals

- **No backend/Convex changes.** Pure client UI. `markPostViewed`, `listFeed`, `listLatestComments`, engagement mutations all unchanged.
- **Gesture-removal regressions:** the swipe→advance flow has subtle ordering (spring `.stop()` before `dragX.set(0)`, deferred `markPostViewed`). The tap path must preserve the exact `commitFlick`-equivalent ordering — reuse, don't rewrite, that sequence.
- **Performance:** keep the 3-card DOM ceiling, `will-change` on the active card only, eager-load active image only. iOS WebView: avoid stacked `backdrop-blur` on animating cards (per `index.css` note) — use opacity/brightness dimming for depth, blur only on static glass pills.
- **Reduced motion:** press-dip + fly-off gate behind `useReducedMotion()` → fast cross-fade fallback.
- P1 polish is best-effort; P0 (deck + below-photo block) is the contract.

## Verification

- `npm run build` + `npm run lint` clean.
- Manual: tap advances with dip + fly-off + promote; heart likes without advancing; counter increments; session+comment row updates per card; last card → "all caught up"; reduced-motion falls back; rapid tapping doesn't blank the deck.
