/**
 * PolaroidStack — the centerpiece of the Corner tab.
 *
 * Tinder-style swipe deck (spec 2026-05-19-polaroid-tinder-swipe-design):
 *   - Top card is drag-bound on the X axis. A horizontal commit (offset
 *     past 32% of viewport OR velocity > 600px/s) sends the card flying
 *     in the throw direction; under-threshold releases snap back to 0.
 *   - The second card (position 1) scales/rises live-bound to the top
 *     card's drag offset via a shared `dragX` MotionValue → derived
 *     `dragMagnitude` (0..1). Position 2 stays at static offsets.
 *   - Tap (single OR double) = like. The previous random-direction
 *     fly-away on single tap has been removed.
 *   - End-of-feed: when fewer than 3 real posts remain we slot an
 *     `EndOfFeedCard` sentinel into the deck so the scale-up reveal works
 *     even at the last real post. When the top is the sentinel itself,
 *     swipes always snap back regardless of threshold.
 *
 * Why we DON'T use AnimatePresence keyed on `topIndex`:
 *   AnimatePresence's "exit" treatment would also try to animate the
 *   second/third cards moving up a layer — but those are still
 *   visible in the new render. The result is a flash of double-rendered
 *   cards. We hand-roll the exit via `exitingPostId` state so only the
 *   flicked card animates off and the rest snap into their new
 *   positions naturally via the layout offsets.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animate, motion, useMotionValue, useTransform, useDragControls, useReducedMotion, type PanInfo } from "motion/react";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { PolaroidCard } from "./PolaroidCard";
import { EndOfFeedCard } from "./EndOfFeedCard";
import { EmptyStackState } from "./EmptyStackState";
import type { FeedPost, FeedStatus } from "@/hooks/community/useGymFeed";
import type { Id } from "../../../convex/_generated/dataModel";

const EXIT_DURATION_MS = 280;
const REDUCED_EXIT_DURATION_MS = 110;
const PREFETCH_TRIGGER = 5; // load more when within N cards of end

// Tinder-style commit thresholds — mirror src/components/training/TinderMediaSwiper.tsx.
const COMMIT_RATIO = 0.32; // |offset.x| / viewportWidth threshold
const COMMIT_VELOCITY = 600; // px/s
const EXIT_DISTANCE_MULT = 1.5; // multiplier of vw for the off-screen target
const EXIT_TILT_DEG = 14; // degrees, signed by direction
const DRAG_ELASTIC = 0.18;

// iOS-pop-tier spring for the fling exit. Tuned for snappy start with
// a smooth follow-through rather than a hard mechanical snap.
const EXIT_SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;
// Snap-back spring when a drag is released below the flick threshold.
const SNAPBACK_SPRING = { type: "spring", stiffness: 520, damping: 30, mass: 0.7 } as const;
// Softer spring for the card behind rising to top position.
const SETTLE_SPRING = { type: "spring", stiffness: 220, damping: 28, mass: 1 } as const;

// Sentinel for the end-of-feed slot. Using a unique symbol so the
// type system can discriminate `Post | typeof END_OF_FEED` without
// any chance of a string-id collision.
const END_OF_FEED: unique symbol = Symbol("end-of-feed");
type StackItem = FeedPost | typeof END_OF_FEED;

interface PolaroidStackProps {
  posts: FeedPost[];
  status: FeedStatus;
  loadMore: () => void;
  /** Fires whenever the top card changes — drives the SessionInfoCard. */
  onIndexChange: (index: number) => void;
  /** Long-press on the author chip OR explicit profile request. */
  onOpenProfile: (userId: Id<"users">) => void;
  /** Double-tap → record like. Called by the parent so the session
   *  info card's `useFeedEngagement` instance owns the optimistic state. */
  onDoubleTapLike: (post: FeedPost) => void;
  /** "Share a session" CTA when stack is exhausted. */
  onPostClick: () => void;
  /** Current top index (controlled by parent so SessionInfoCard sees it). */
  topIndex: number;
  /** Advance the deck — owned by the parent hook so sessionStorage stays
   *  in sync. */
  advance: () => void;
  /** Called with the post id the moment a swipe commits (before advance).
   *  Use this to fire markPostViewed or any other side-effect. */
  onSwipeCommit?: (postId: Id<"session_media">) => void;
}

interface GloveBurst {
  id: number;
  x: number;
  y: number;
}

export function PolaroidStack({
  posts,
  status,
  loadMore,
  onIndexChange,
  onOpenProfile,
  onDoubleTapLike,
  onPostClick,
  topIndex,
  advance,
  onSwipeCommit,
}: PolaroidStackProps) {
  const prefersReducedMotion = useReducedMotion();
  // Motion primitives for the top card. `dragX` is the source of truth
  // for the gesture — motion mutates it during drag, and we drive both
  // the exit animation and the second card's scale-up from the same
  // value. `dragMagnitude` is a 0..1 derivation passed to position 1.
  const dragControls = useDragControls();
  const dragX = useMotionValue(0);
  const rotate = useTransform(dragX, [-200, 0, 200], [-18, 0, 18]);
  const dragMagnitude = useTransform(dragX, (v) => {
    const vw = window.innerWidth || 375;
    return Math.min(Math.abs(v) / (vw * COMMIT_RATIO), 1);
  });

  // Track which card is mid-flick so we render its exit animation
  // without unmounting the still-visible underneath cards.
  //
  // We capture the FULL post object (not just the id) because the
  // parent's dismissedIds filter may remove this post from `posts`
  // synchronously when the swipe commits. Rendering the exit from a
  // captured snapshot makes the fly-away independent of the parent's
  // visibility filter.
  const [exitingPost, setExitingPost] = useState<FeedPost | null>(null);
  const exitDirRef = useRef<1 | -1>(1);
  // Capture release velocity so the exit target carries momentum past the edge.
  const exitVelocityRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });

  // Glove-tap delight burst layer. Multiple bursts can stack if the
  // user double-taps rapidly — each is keyed and self-removes.
  const [bursts, setBursts] = useState<GloveBurst[]>([]);
  const burstIdRef = useRef(0);

  // ── Stack slice ────────────────────────────────────────────────────
  // Always EXACTLY the next 3 slots. When fewer than 3 real posts
  // remain at/after `topIndex`, we substitute the END_OF_FEED sentinel
  // so the deck visually slots an `EndOfFeedCard` into the missing
  // positions. The sentinel keeps the scale-up reveal working at the
  // last real post — there's always *something* behind to peek through.
  const visibleSlots: StackItem[] = useMemo(() => {
    const top: StackItem = posts[topIndex] ?? END_OF_FEED;
    const second: StackItem = posts[topIndex + 1] ?? END_OF_FEED;
    const third: StackItem = posts[topIndex + 2] ?? END_OF_FEED;
    // While a card is mid-fly-away, exclude it from the static stack — it's
    // rendered separately as `exitingNode` and shouldn't appear as a duplicate
    // background card. This matters when the parent has NOT yet dropped the
    // post from `posts` (e.g. dismissal deferred until after the animation
    // so the stack survives the last-card case without unmounting).
    if (!exitingPost) return [top, second, third];
    return [top, second, third].filter(
      (slot) => typeof slot === "symbol" || slot.id !== exitingPost.id,
    );
  }, [posts, topIndex, exitingPost]);

  // True when the current top slot is the end-of-feed sentinel.
  // Used to disable swipe commits when there are no real posts left.
  const isAtEnd = posts[topIndex] === undefined;

  // Notify parent when the top index changes so the info-card binds
  // to the new top post.
  useEffect(() => {
    onIndexChange(topIndex);
  }, [topIndex, onIndexChange]);

  // ── Eager preload of the top 3 ─────────────────────────────────────
  // Hand-rolled rather than using `<link rel="preload">` because the
  // image URLs come from a reactive Convex query — we don't know them
  // until first paint, and we want the browser cache populated before
  // the user starts swiping.
  useEffect(() => {
    visibleSlots.forEach((slot) => {
      if (slot === END_OF_FEED) return;
      if (!slot.url) return;
      const img = new Image();
      img.src = slot.url;
    });
  }, [visibleSlots]);

  // ── Pagination trigger ─────────────────────────────────────────────
  // When we're within `PREFETCH_TRIGGER` cards of the end and Convex
  // says more pages exist, fetch eagerly so the user never sees a
  // "loading more…" interstitial.
  useEffect(() => {
    if (status !== "CanLoadMore") return;
    if (posts.length - topIndex >= PREFETCH_TRIGGER) return;
    loadMore();
  }, [topIndex, posts.length, status, loadMore]);

  // ── Flick mechanics ────────────────────────────────────────────────
  const topPost: FeedPost | undefined = posts[topIndex];

  const commitFlick = useCallback(
    (direction: 1 | -1, vx = 0, vy = 0) => {
      if (!topPost || exitingPost) return;
      exitDirRef.current = direction;
      exitVelocityRef.current = { vx, vy };
      // Capture the post in local state BEFORE notifying the parent so
      // the exit animation has the post data even after the parent's
      // dismissedIds filter removes it from `posts`.
      setExitingPost(topPost);
      onSwipeCommit?.(topPost.id);
      triggerHaptic(ImpactStyle.Medium);

      // Animate the same `dragX` MotionValue that powered the drag past
      // the edge — keeps the gesture and the exit feeling continuous
      // (the card doesn't "jump" between motion sources mid-fly). We
      // schedule the cleanup via setTimeout (not onAnimationComplete) so
      // timing is deterministic even if motion re-evaluates the prop
      // mid-flight.
      const vw = window.innerWidth || 375;
      animate(dragX, direction * vw * EXIT_DISTANCE_MULT, EXIT_SPRING);
      const exitMs = prefersReducedMotion ? REDUCED_EXIT_DURATION_MS : EXIT_DURATION_MS;
      window.setTimeout(() => {
        setExitingPost(null);
        // Reset dragX to 0 so the new top card starts at rest and the
        // derived `dragMagnitude` returns to 0 — which springs the
        // now-position-1 card back to its background offsets.
        dragX.set(0);
        advance();
      }, exitMs);
    },
    [topPost, exitingPost, advance, dragX, onSwipeCommit, prefersReducedMotion],
  );

  const handleDragEnd = useCallback(
    (_e: unknown, info: PanInfo) => {
      // End-of-feed short-circuit: when the top card is the sentinel,
      // every drag snap-backs regardless of distance/velocity — there's
      // nothing left to commit to.
      if (isAtEnd) {
        animate(dragX, 0, SNAPBACK_SPRING);
        return;
      }
      const dx = info.offset.x;
      const vx = info.velocity.x;
      const vy = info.velocity.y;
      const vw = window.innerWidth || 375;
      const shouldFlick =
        Math.abs(dx) > vw * COMMIT_RATIO || Math.abs(vx) > COMMIT_VELOCITY;
      if (shouldFlick) {
        commitFlick(dx > 0 ? 1 : -1, vx, vy);
      }
      // Below the flick threshold — spring the card smoothly back to
      // centre. Animating gives the gesture proper weight without
      // slowing the user down.
      else {
        animate(dragX, 0, SNAPBACK_SPRING);
      }
    },
    [commitFlick, dragX, isAtEnd],
  );

  // ── Glove-tap delight ──────────────────────────────────────────────
  const spawnBurst = useCallback((clientX: number, clientY: number, rect: DOMRect) => {
    // Convert to local coords relative to the card.
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const id = ++burstIdRef.current;
    setBursts((prev) => [...prev, { id, x: localX, y: localY }]);
    window.setTimeout(() => {
      setBursts((prev) => prev.filter((b) => b.id !== id));
    }, 520);
  }, []);

  // Tap → like. Per spec, single AND double tap both fire the like
  // handler — no more disambiguation, no more random-direction flick.
  // The glove burst still spawns on tap as visual feedback.
  const handleCardClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!topPost || exitingPost || isAtEnd) return;
      const rect = e.currentTarget.getBoundingClientRect();
      spawnBurst(e.clientX, e.clientY, rect);
      onDoubleTapLike(topPost);
    },
    [topPost, exitingPost, isAtEnd, spawnBurst, onDoubleTapLike],
  );

  // ── Empty state ────────────────────────────────────────────────────
  // True "no posts at all" → render the CTA empty state. The end-of-feed
  // sentinel handles the "scrolled through everything" case below.
  if (posts.length === 0 && !exitingPost) {
    return <EmptyStackState onPostClick={onPostClick} />;
  }

  // Render the exiting card OUTSIDE of the visible-map so it survives
  // the parent's dismissedIds filter (which removes the post from
  // `posts` synchronously when the swipe commits).
  const exitingNode = (() => {
    if (!exitingPost) return null;
    const dir = exitDirRef.current;
    const { vx, vy } = exitVelocityRef.current;
    const velocityBoost = Math.min(Math.abs(vx) / 1200, 0.4);
    const exitX = dir * window.innerWidth * (EXIT_DISTANCE_MULT - 0.1 + velocityBoost);
    const exitY = vy * 0.3;
    const exitRotate = prefersReducedMotion
      ? computeRotation(exitingPost.id)
      : dir * EXIT_TILT_DEG;
    const rotationDeg = computeRotation(exitingPost.id);

    if (prefersReducedMotion) {
      return (
        <motion.div
          key={exitingPost.id}
          className="absolute inset-0"
          // `willChange` proactively promotes this layer to the GPU on
          // iOS WebKit, eliminating first-frame stutter when the exit
          // animation begins. Scoped to this wrapper only — it IS the
          // element being animated.
          // `pointer-events-none` blocks the exiting card from intercepting
        // taps on the newly-visible top card while it's still in mid-flight.
        // Without this, a rapid double-swipe could land on the exiting card
        // and trigger an extra like.
        style={{ zIndex: 40, willChange: "transform, opacity", pointerEvents: "none" }}
          initial={{ x: dragX.get(), y: 0, rotate: rotationDeg, opacity: 1 }}
          animate={{ x: exitX, y: exitY, rotate: exitRotate, opacity: 0 }}
          transition={{ duration: REDUCED_EXIT_DURATION_MS / 1000, ease: "linear" }}
        >
          <PolaroidCard post={exitingPost} stackPosition={0} isTop rotationDeg={rotationDeg} />
        </motion.div>
      );
    }

    return (
      <motion.div
        key={exitingPost.id}
        className="absolute inset-0"
        // `willChange` proactively promotes this layer to the GPU on
        // iOS WebKit, eliminating first-frame stutter when the exit
        // animation begins. Scoped to this wrapper only — it IS the
        // element being animated.
        // `pointer-events-none` blocks the exiting card from intercepting
        // taps on the newly-visible top card while it's still in mid-flight.
        // Without this, a rapid double-swipe could land on the exiting card
        // and trigger an extra like.
        style={{ zIndex: 40, willChange: "transform, opacity", pointerEvents: "none" }}
        initial={{ x: dragX.get(), y: 0, rotate: rotate.get(), opacity: 1 }}
        animate={{ x: exitX, y: exitY, rotate: exitRotate, opacity: 0 }}
        transition={{
          x: EXIT_SPRING,
          y: EXIT_SPRING,
          rotate: EXIT_SPRING,
          // Opacity fades only in the last 40% of travel.
          opacity: { delay: 0.16, duration: 0.18, ease: "easeIn" },
        }}
      >
        <PolaroidCard post={exitingPost} stackPosition={0} isTop rotationDeg={rotationDeg} />
      </motion.div>
    );
  })();

  return (
    <div className="relative mx-auto" style={{ width: 312, height: 396 }}>
      {exitingNode}

      {visibleSlots.map((slot, idx) => {
        const stackPos = idx as 0 | 1 | 2;
        // If a card is mid-flight, the new slot[0] is the NEXT post.
        // Render it as a background card (not top) for the duration of
        // the exit animation so it doesn't catch taps for a card that's
        // about to land on it. Once the exit completes, exitingPost
        // clears and idx=0 becomes the real top again.
        const isTop = idx === 0 && !exitingPost;

        // ── End-of-feed sentinel branch ───────────────────────────────
        // Slot the static "you're all caught up" card into the deck.
        // It mirrors the polaroid frame so positioning matches the real
        // cards exactly. When the sentinel IS the top card (no real
        // posts left at this index), we still wrap it in a motion.div
        // bound to `dragX` so the user gets the snap-back feedback when
        // they try to swipe — see `handleDragEnd`'s `isAtEnd` branch.
        if (slot === END_OF_FEED) {
          if (isTop) {
            return (
              <motion.div
                key={`end-of-feed-top-${idx}`}
                className="absolute inset-0"
                // `touchAction: "pan-y pinch-zoom"` lets the page keep
                // scrolling vertically while motion still owns horizontal
                // drag. iOS WKWebView ignores motion's `dragDirectionLock`
                // release for vertical-intent gestures, so we have to tell
                // the browser at the CSS layer which axis to surrender.
                style={{
                  x: dragX,
                  rotate,
                  zIndex: 30,
                  willChange: "transform",
                  touchAction: "pan-y pinch-zoom",
                }}
                drag="x"
                dragDirectionLock
                dragControls={dragControls}
                dragElastic={DRAG_ELASTIC}
                dragMomentum={false}
                onDragEnd={handleDragEnd}
              >
                <EndOfFeedCard />
              </motion.div>
            );
          }
          // Background end-of-feed slot — no gesture, just visual.
          // Wrap in a positioned div so the static scale/offset matches
          // the equivalent PolaroidCard background position.
          return (
            <motion.div
              key={`end-of-feed-${idx}`}
              className="absolute inset-0 pointer-events-none"
              style={{ zIndex: idx === 1 ? 20 : 10 }}
              animate={
                idx === 1
                  ? { scale: 0.96, y: 10, opacity: 0.7 }
                  : { scale: 0.92, y: 20, opacity: 0.4 }
              }
              transition={SETTLE_SPRING}
            >
              <EndOfFeedCard />
            </motion.div>
          );
        }

        // ── Real post branch ──────────────────────────────────────────
        const post = slot;
        const rotationDeg = computeRotation(post.id);

        if (isTop) {
          // The top card is the only one that listens to drag + tap.
          // Wrap it in a motion.div that owns the drag transform; the
          // inner PolaroidCard renders the visual frame.
          return (
            <motion.div
              key={post.id}
              className="absolute inset-0"
              // `willChange` keeps the top card on its own GPU layer so
              // the very first frame of a drag is rasterised without
              // the WebKit compositor having to promote it on demand.
              //
              // `touchAction: "pan-y pinch-zoom"` lets vertical scroll
              // bubble up to the page's main scroll container while motion
              // still owns horizontal drag. The previous `touch-none`
              // Tailwind class set `touch-action: none`, which on iOS
              // WKWebView caused the polaroid to swallow ALL touchmove
              // events — vertical-intent gestures included — making the
              // entire `/community` page unscrollable.
              style={{
                x: dragX,
                rotate,
                zIndex: 30,
                willChange: "transform, opacity",
                touchAction: "pan-y pinch-zoom",
              }}
              drag="x"
              dragDirectionLock
              dragControls={dragControls}
              dragElastic={DRAG_ELASTIC}
              dragMomentum={false}
              onDragEnd={handleDragEnd}
              onClick={handleCardClick}
            >
              <PolaroidCard
                post={post}
                stackPosition={0}
                isTop
                rotationDeg={rotationDeg}
                onAuthorLongPress={() => onOpenProfile(post.author.userId)}
              />

              {/* Glove-tap burst layer — local to the top card so the
                  SVG explodes from the tap point in the polaroid's
                  own coordinate space. */}
              {bursts.map((b) => (
                <GloveBurst key={b.id} x={b.x} y={b.y} />
              ))}
            </motion.div>
          );
        }

        // Background cards — static layout per stack position. No
        // gesture wiring, no pointer events (the card sets
        // `pointer-events-none` when not top). The position-1 card
        // (immediately behind the top) receives the live `dragMagnitude`
        // MotionValue so it scales up in lockstep with the drag. The
        // deepest card (position 2) keeps its static offsets — only one
        // card animates per drag.
        return (
          <PolaroidCard
            key={post.id}
            post={post}
            stackPosition={stackPos}
            isTop={false}
            rotationDeg={rotationDeg}
            progress={stackPos === 1 ? dragMagnitude : undefined}
          />
        );
      })}
    </div>
  );
}

/* ─── Glove-tap burst ─── */

// 64px filled-red boxing-glove SVG. Inlined (rather than emoji) so the
// glyph renders identically on every iOS / Android / WebKit version —
// emoji rendering varies wildly across platforms, and the brand wants
// a known shape. Kept simple: silhouette of a glove with wrist cuff.
const BoxingGloveSvg = memo(function BoxingGloveSvg({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Main glove body */}
      <path
        d="M14 22c0-7.18 5.82-13 13-13h6c7.73 0 14 6.27 14 14v9c0 9.94-8.06 18-18 18h-2c-7.18 0-13-5.82-13-13V22z"
        fill="#DC2626"
      />
      {/* Thumb pocket */}
      <path
        d="M12 26c0-3.31 2.69-6 6-6h2v12h-2c-3.31 0-6-2.69-6-6z"
        fill="#B91C1C"
      />
      {/* Wrist cuff */}
      <rect x="16" y="48" width="28" height="8" rx="2" fill="#7F1D1D" />
      {/* Highlight stitch */}
      <path
        d="M22 24c2.5-2 6-3 10-3"
        stroke="#FCA5A5"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
});

const GloveBurst = memo(function GloveBurst({ x, y }: { x: number; y: number }) {
  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute select-none"
      style={{ left: x, top: y, translateX: "-50%", translateY: "-50%" }}
      initial={{ scale: 0.6, rotate: 0, opacity: 1 }}
      animate={{ scale: 1.4, rotate: 12, opacity: 0 }}
      transition={{ duration: 0.48, ease: [0.32, 0.72, 0, 1] }}
    >
      {/* Red boxing glove SVG. Combat-sports vernacular co-signs the
          work — heavier than a heart, lighter than a "post". */}
      <BoxingGloveSvg size={64} />
    </motion.div>
  );
});

/* ─── Deterministic per-card rotation ─── */

/** Tiny stable string hash (djb2). Stable across reloads so a card's
 *  rotation doesn't shift mid-session, which would look jittery. */
function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h) ^ id.charCodeAt(i);
  }
  // Force positive int.
  return Math.abs(h);
}

/** Map a post id → a stable rotation in [-2.4°, 2.4°] stepped by 1.2°.
 *  Spec: ((hash % 5) - 2) * 1.2 — gives a 5-step "scatter" that reads
 *  as a real polaroid stack rather than a perfect alignment. */
function computeRotation(id: string): number {
  return ((hashId(id) % 5) - 2) * 1.2;
}
