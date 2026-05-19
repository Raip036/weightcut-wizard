# Polaroid Tinder-Style Swipe — Design

**Date:** 2026-05-19
**Status:** Approved
**Owner:** Pratik

## Summary

Refactor the community feed's `PolaroidStack` so it behaves like a Tinder deck: horizontal swipe (left or right) is the single way to advance to the next post, the discarded card flies off in the throw direction, and the next card scales up live-bound to the drag offset. A persistent "You're all caught up" card sits as the bottom of the deck and is what the user reveals after the last real post. Model the gesture tuning after `src/components/training/TinderMediaSwiper.tsx`, the existing gallery component.

The previously-loved up-flick fly-away is replaced. Tap = like is preserved.

## Goals

- Sub-frame-budget gesture: zero React re-renders during drag; everything compositor-driven.
- Symmetric: left and right both advance, exit in the throw direction.
- Cleaner mental model: tap = like, swipe = next. No more random-direction fly-aways from a stray tap.
- Reuse the perf wins from the just-shipped optimization pass (`React.memo`, `useMemo`, `willChange`).

## Non-goals

- No like-or-skip semantics on direction (per brainstorm: both directions just advance).
- No looping / endless feed. End is end.
- No vertical swipe behavior — `drag="x"` is locked.
- No new gesture library — stays on `motion/react`.

## Decisions (from brainstorm)

| Question | Choice |
|---|---|
| Swipe semantics | Both directions advance |
| Visual mechanic | Card flies horizontally; next scales up from behind in lockstep with drag |
| Tap / like interaction | Tap = like, swipe = next, up-flick removed |
| End of feed | Bounce-back + persistent "You're all caught up" card |

## Architecture

Three files. One new, two modified.

```
src/components/community/
  ├── PolaroidStack.tsx       (modify — gesture rewrite, MotionValue plumbing, end-of-feed mount)
  ├── PolaroidCard.tsx        (modify — accept progress MotionValue, useTransform-driven scale/y for non-top cards)
  └── EndOfFeedCard.tsx       (new — small static card with "You're all caught up" copy + last-fetched timestamp)
```

### Gesture (in `PolaroidStack.tsx`)

- Keep `useDragControls` + `drag="x"` on the top card's `motion.div`. Add `dragDirectionLock` and a small `dragElastic={0.18}`.
- Replace the existing `useDoubleTap` flick-on-single-tap behavior: single tap now fires `onDoubleTapLike` (the like handler). Remove the random-direction `flick()` path.
- Threshold & exit (mirroring `TinderMediaSwiper`):
  - Commit threshold: `Math.abs(info.offset.x) > viewportWidth * 0.32` OR `Math.abs(info.velocity.x) > 600`.
  - On commit: `animate(x, Math.sign(offset.x) * viewportWidth * 1.5, EXIT_SPRING)`, simultaneously rotate by `Math.sign(offset.x) * 14`. Constants exist; reuse them.
  - On snap-back (under threshold): `animate(x, 0, SNAPBACK_SPRING)`.
- Capture the exiting post snapshot for the same reason as today (so the parent's filter-update doesn't unmount the exit animation mid-flight).

### Drag-coupled scale-up (the Tinder feel)

A single `MotionValue<number>` named `dragMagnitude` is created at the `PolaroidStack` level via `useMotionValue(0)` and a `useMotionValueEvent` (or `useTransform` chain) reading from the top card's `x` motion value:
```ts
const dragX = useMotionValue(0);
const dragMagnitude = useTransform(dragX, (v) => Math.min(Math.abs(v) / commitDistance, 1));
```
where `commitDistance = window.innerWidth * 0.32`.

`dragMagnitude` is passed as a prop to the **second card** (the one directly behind the top). `PolaroidCard.tsx` accepts an optional `progress?: MotionValue<number>` prop. When defined and `!isTop`, the card's outer `motion.div`'s `style` uses `useTransform(progress, [0, 1], [baseScale, 1])` and `useTransform(progress, [0, 1], [baseY, 0])` for scale and y respectively, plus a small opacity ramp (`[baseOpacity, 1]`).

The third (deepest) card stays at its static offsets — only one card animates per drag.

This is zero-re-render: the MotionValue updates only the transforms, no React state churn.

### End-of-feed card (`EndOfFeedCard.tsx`)

- Small, presentational. Renders a card the same dimensions as a polaroid (matching aspect ratio and frame).
- Copy: "You're all caught up." plus secondary line "New posts will show here as your gym shares."
- No image, no animation — just a static glass-style card with a subtle wizard logo or checkmark for visual anchor.
- Used in two situations inside `PolaroidStack`:
  1. As the deepest card slot when the feed has only 1–2 posts remaining (so the scale-up reveal under the last post shows the caught-up card).
  2. Standalone when `posts.length === 0` (replaces today's empty state in this component).

`PolaroidStack` rendering logic becomes:
```ts
const visibleSlots = [posts[i], posts[i+1] ?? END_OF_FEED, posts[i+2] ?? END_OF_FEED];
```
The `END_OF_FEED` sentinel renders an `<EndOfFeedCard />` instead of a `<PolaroidCard />`.

### Snap-back behavior at the last real post

When the current top card IS the last real post (`i === posts.length - 1`):
- A swipe attempt still commits if it crosses the threshold.
- On commit, the card flies off and the `EndOfFeedCard` becomes the new top with no card behind it.
- The user can swipe again — that swipe always snap-backs (no further commit). We detect this by checking if the new top is `END_OF_FEED` and disabling the commit-decision; only snap-back is reachable.

## Animation values

All values mirror or reuse what's already in `PolaroidStack.tsx`:

```ts
const EXIT_SPRING    = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 };  // existing
const SNAPBACK_SPRING= { type: "spring", stiffness: 520, damping: 30, mass: 0.7 };  // existing
const SCALEUP_TRANS  = { type: "spring", stiffness: 220, damping: 28, mass: 1 };    // existing (settle)

const COMMIT_RATIO   = 0.32;     // |offset.x| / vw threshold
const COMMIT_VEL     = 600;      // px/s
const EXIT_DISTANCE  = 1.5;      // multiplier of vw for the off-screen target
const EXIT_TILT_DEG  = 14;       // degrees, signed by direction
const DRAG_ELASTIC   = 0.18;
```

## What gets removed

- The `flick()` / random-direction single-tap behavior in `PolaroidStack`.
- `useDoubleTap`'s single-tap branch no longer invokes flick — only the double-tap (or repurposed single-tap) like is wired up.
- Any "swipe up" or vertical exit codepath in `PolaroidStack` if one exists (current code is horizontal-already per the gallery exploration, but verify).

## What stays untouched

- `PolaroidCard.tsx`'s develop-blur animation, image preload, LQIP backdrop, image dimensions, `React.memo` wrapping — all left intact.
- The 3-card mount cap and image-preload effect.
- `Community.tsx` rendering, hooks, and memoization from the prior perf task.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| iOS WebKit choking on `useTransform` chains | Keep each `useTransform` to a single derivation. Don't chain. |
| `progress` MotionValue passed across `React.memo` boundary | MotionValue identity is stable for the lifetime of the parent. Memo's `areEqual` already returns true on stable refs. |
| Background card transform conflict with existing static transform | When `progress` prop is defined and `!isTop`, the new transform takes over entirely — static offsets only used when progress is absent. |
| End-of-feed card animating onto stack mid-swipe creates layout jolt | `EndOfFeedCard` is pre-mounted in the deepest slot when remaining posts < 3, so it's already in the DOM at the moment the last real post exits. |
| User dragging then releasing under threshold from end-of-feed top should snap back, not commit | Explicit `if (isAtEnd && Math.abs(offset.x) > commitDistance) animate(x, 0, SNAPBACK_SPRING)` short-circuit. |

## Test plan

- iPhone SE (320×568) and iPhone 14 Pro (393×852).
- Left swipe past threshold → card flies left, next scales up from `0.96 → 1.0`, snaps at top.
- Right swipe past threshold → same in the other direction.
- Slow drag under threshold either side → card snap-backs to `x=0`, background card returns to `0.96`.
- Single tap → like fires. No card flies away.
- Double tap → like still fires (current behavior preserved).
- Last post in feed: swipe past threshold → flies off, `EndOfFeedCard` becomes top. Further swipes snap back regardless of velocity.
- With `posts.length === 0`: only the `EndOfFeedCard` visible, no gesture active.
- Reduced motion: existing reduced-motion branch is preserved (110ms tween-only exit).
- 60 FPS check: open Safari Web Inspector → Timelines → record while swiping. No major scripting frames, all compositing.

## Out of scope

- Like/skip semantics (per brainstorm decision).
- Looping feed.
- Pre-fetch beyond the current 3-card preload (already optimal for this UI).
- Tutorial pointing at the new gesture (assume the user discovers it; can add a one-shot hint in a later iteration).
