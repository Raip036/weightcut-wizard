/**
 * PolaroidStack — the centerpiece of the Corner tab.
 *
 * Tinder-style swipe deck:
 *   - Top card is drag-bound on the X axis. A horizontal commit (offset
 *     past 32% of viewport OR velocity > 600px/s) sends the card flying
 *     in the throw direction; under-threshold releases snap back to 0.
 *   - The second card (position 1) scales/rises live-bound to the top
 *     card's drag offset via a shared `dragX` MotionValue → derived
 *     `dragMagnitude` (0..1). Position 2 stays at static offsets.
 *   - Tap (single OR double) = like.
 *
 * When the last real post is swiped, the stack returns `null` and the
 * parent (`Community.tsx`) renders the EmptyFeed call sheet — no more
 * sentinel sparkle card in the deck. The fade between the stack and
 * the empty state is handled at the page level by AnimatePresence.
 *
 * Smooth transitions:
 *   - Top card rotation = per-post base rotation + drag-relative
 *     rotation, so when a background card is promoted to top its
 *     resting angle stays the same (no rotation jump).
 *   - `dragX.set(0)` only fires AFTER the parent has cleared the
 *     dismissed post, so the position-1 card doesn't snap back to its
 *     background offset before being promoted.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animate, motion, useMotionValue, useTransform, useReducedMotion, type PanInfo, type MotionValue } from "motion/react";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { RoundedFeedCard } from "./RoundedFeedCard";
import { EmptyStackState } from "./EmptyStackState";
import { EmojiReactionBar } from "./EmojiReactionBar";
import { CommentInputBar } from "./CommentInputBar";
import { InlineCommentsPreview } from "./InlineCommentsPreview";
import type { FeedPost, FeedStatus } from "@/hooks/community/useGymFeed";
import type { Id } from "../../../convex/_generated/dataModel";

const EXIT_DURATION_MS = 280;
const REDUCED_EXIT_DURATION_MS = 110;
const PREFETCH_TRIGGER = 5;

const COMMIT_RATIO = 0.32;
const COMMIT_VELOCITY = 600;
const EXIT_DISTANCE_MULT = 1.5;
const EXIT_TILT_DEG = 14;
const DRAG_ELASTIC = 0.18;

const EXIT_SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;
const SNAPBACK_SPRING = { type: "spring", stiffness: 520, damping: 30, mass: 0.7 } as const;

interface PolaroidStackProps {
  posts: FeedPost[];
  status: FeedStatus;
  loadMore: () => void;
  onIndexChange: (index: number) => void;
  onOpenProfile: (userId: Id<"users">) => void;
  onDoubleTapLike: (post: FeedPost) => void;
  onPostClick: () => void;
  topIndex: number;
  advance: () => void;
  onSwipeCommit?: (postId: Id<"session_media">) => void;
  /**
   * Optional engagement wiring for the in-deck reaction bar + comment
   * input. When omitted, the bar/input collapse — handy for surfaces
   * (story templates, share previews) that re-use the stack visually
   * without the social affordances. The parent passes a `topPostId`-
   * agnostic callback set; the stack itself decides which post is the
   * current `topPost`.
   */
  engagement?: {
    onReact: (postId: Id<"session_media">, key: string) => void;
    onSubmitComment: (
      postId: Id<"session_media">,
      text: string,
    ) => Promise<void> | void;
    onSeeAllComments: (
      postId: Id<"session_media">,
      count: number,
    ) => void;
  };
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
  engagement,
}: PolaroidStackProps) {
  const prefersReducedMotion = useReducedMotion();
  const dragX = useMotionValue(0);
  const dragMagnitude = useTransform(dragX, (v) => {
    const vw = window.innerWidth || 375;
    return Math.min(Math.abs(v) / (vw * COMMIT_RATIO), 1);
  });

  const [exitingPost, setExitingPost] = useState<FeedPost | null>(null);
  const exitDirRef = useRef<1 | -1>(1);
  const exitVelocityRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });

  const [bursts, setBursts] = useState<GloveBurst[]>([]);
  const burstIdRef = useRef(0);

  // ── Visible slice — at most 3 real posts, no sentinel filler ───────
  // When fewer than 3 remain, we just render fewer cards. The deck no
  // longer slots an end-of-feed card behind the last post; the parent
  // (Community.tsx) takes over with the EmptyFeed call sheet once the
  // last card has flown off.
  const visibleSlots: FeedPost[] = useMemo(() => {
    const slice = posts.slice(topIndex, topIndex + 3);
    if (!exitingPost) return slice;
    return slice.filter((p) => p.id !== exitingPost.id);
  }, [posts, topIndex, exitingPost]);

  const topPost: FeedPost | undefined = posts[topIndex];
  const isAtEnd = topPost === undefined;

  useEffect(() => {
    onIndexChange(topIndex);
  }, [topIndex, onIndexChange]);

  // Eager preload of the next 3 image URLs so they're warm in cache.
  useEffect(() => {
    visibleSlots.forEach((slot) => {
      if (!slot.url) return;
      const img = new Image();
      img.src = slot.url;
    });
  }, [visibleSlots]);

  // Pagination trigger — fetch more before we run out.
  useEffect(() => {
    if (status !== "CanLoadMore") return;
    if (posts.length - topIndex >= PREFETCH_TRIGGER) return;
    loadMore();
  }, [topIndex, posts.length, status, loadMore]);

  // ── Flick mechanics ────────────────────────────────────────────────
  const commitFlick = useCallback(
    (direction: 1 | -1, vx = 0, vy = 0) => {
      if (!topPost || exitingPost) return;
      exitDirRef.current = direction;
      exitVelocityRef.current = { vx, vy };
      setExitingPost(topPost);
      onSwipeCommit?.(topPost.id);
      triggerHaptic(ImpactStyle.Medium);

      const vw = window.innerWidth || 375;
      // Capture the controls so we can STOP this spring before reset. A
      // spring has no fixed duration — it keeps driving `dragX` toward the
      // off-screen target well past `exitMs`. `dragX.set(0)` does NOT cancel
      // a running animation, so without an explicit `.stop()` the spring
      // pulls `dragX` back off-screen on the very next frame. The newly-
      // promoted TopCard binds `style={{ x: dragX }}`, so it then renders
      // off-screen (blank deck) and the live animation overrides drag input
      // — the real "next card is blank + unswipeable" bug.
      const exitControls = animate(dragX, direction * vw * EXIT_DISTANCE_MULT, EXIT_SPRING);
      const exitMs = prefersReducedMotion ? REDUCED_EXIT_DURATION_MS : EXIT_DURATION_MS;
      window.setTimeout(() => {
        // Stop the in-flight spring FIRST, then reset to rest, then unmount
        // the exit card + advance. Order matters: stop() → set(0) guarantees
        // the promoted TopCard binds a settled dragX at 0.
        exitControls.stop();
        dragX.set(0);
        setExitingPost(null);
        advance();
      }, exitMs);
    },
    [topPost, exitingPost, advance, dragX, onSwipeCommit, prefersReducedMotion],
  );

  const handleDragEnd = useCallback(
    (_e: unknown, info: PanInfo) => {
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
      } else {
        animate(dragX, 0, SNAPBACK_SPRING);
      }
    },
    [commitFlick, dragX, isAtEnd],
  );

  // ── Glove-tap delight ──────────────────────────────────────────────
  const spawnBurst = useCallback((clientX: number, clientY: number, rect: DOMRect) => {
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const id = ++burstIdRef.current;
    setBursts((prev) => [...prev, { id, x: localX, y: localY }]);
    window.setTimeout(() => {
      setBursts((prev) => prev.filter((b) => b.id !== id));
    }, 520);
  }, []);

  const handleCardClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!topPost || exitingPost || isAtEnd) return;
      const rect = e.currentTarget.getBoundingClientRect();
      spawnBurst(e.clientX, e.clientY, rect);
      onDoubleTapLike(topPost);
    },
    [topPost, exitingPost, isAtEnd, spawnBurst, onDoubleTapLike],
  );

  // ── Empty + post-last-card states ──────────────────────────────────
  // True "no posts at all" → keep the CTA empty state.
  if (posts.length === 0 && !exitingPost) {
    return <EmptyStackState onPostClick={onPostClick} />;
  }

  // After the user has swiped past the last real post and the exit
  // animation has finished, return null. The parent Community page
  // detects the empty effectivePosts and cross-fades to EmptyFeed.
  if (isAtEnd && !exitingPost && visibleSlots.length === 0) {
    return null;
  }

  // ── Exit card (renders separately so the parent's dismissedIds
  //     filter can drop the post from `posts` without unmounting it) ──
  const exitingNode = (() => {
    if (!exitingPost) return null;
    const dir = exitDirRef.current;
    const { vx, vy } = exitVelocityRef.current;
    const velocityBoost = Math.min(Math.abs(vx) / 1200, 0.4);
    const exitX = dir * window.innerWidth * (EXIT_DISTANCE_MULT - 0.1 + velocityBoost);
    const exitY = vy * 0.3;
    const baseRotation = computeRotation(exitingPost.id);
    const exitRotate = baseRotation + dir * EXIT_TILT_DEG;

    return (
      <motion.div
        key={exitingPost.id}
        className="absolute inset-0"
        // `pointer-events-none` blocks the exiting card from intercepting
        // taps on the newly-visible top card while it's still in mid-flight.
        style={{ zIndex: 40, willChange: "transform, opacity", pointerEvents: "none" }}
        initial={{ x: dragX.get(), y: 0, rotate: baseRotation, opacity: 1 }}
        animate={{ x: exitX, y: exitY, rotate: exitRotate, opacity: 0 }}
        transition={
          prefersReducedMotion
            ? { duration: REDUCED_EXIT_DURATION_MS / 1000, ease: "linear" }
            : {
                x: EXIT_SPRING,
                y: EXIT_SPRING,
                rotate: EXIT_SPRING,
                opacity: { delay: 0.16, duration: 0.18, ease: "easeIn" },
              }
        }
      >
        <RoundedFeedCard post={exitingPost} stackPosition={0} isTop rotationDeg={baseRotation} />
      </motion.div>
    );
  })();

  return (
    <div className="flex flex-col">
      <div key="deck" className="relative mx-auto" style={{ width: 312, height: 396 }}>
        {exitingNode}

        {visibleSlots.map((post, idx) => {
          const stackPos = idx as 0 | 1 | 2;
          // If a card is mid-flight, the new slot[0] is the NEXT post.
          // We render it as a non-interactive background card until the
          // exit animation completes so it doesn't catch taps for a card
          // that's about to land on it.
          const isTop = idx === 0 && !exitingPost;
          const rotationDeg = computeRotation(post.id);

          if (isTop) {
            return (
              <TopCard
                key={post.id}
                post={post}
                rotationDeg={rotationDeg}
                dragX={dragX}
                onDragEnd={handleDragEnd}
                onClick={handleCardClick}
                onAuthorLongPress={() => onOpenProfile(post.author.userId)}
                bursts={bursts}
              />
            );
          }

          return (
            <RoundedFeedCard
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

      {/* Engagement section — sits OUTSIDE the draggable card container
          so its taps never compete with the swipe gesture. Only renders
          when:
            - the parent wired the `engagement` callback set, AND
            - there's a real top post (not mid-exit, not empty deck).
          We key on `topPost.id` so the comment input + bar reset cleanly
          when a card is swiped and the next post is promoted to top. */}
      {engagement && topPost && !exitingPost && (
        <div key={topPost.id} className="mt-3 space-y-2 px-2 flex-shrink-0">
          <EmojiReactionBar
            reactionCounts={topPost.reactionCounts ?? {}}
            viewerReactions={topPost.viewerReactions ?? []}
            onReact={(key) => engagement.onReact(topPost.id, key)}
          />
          <InlineCommentsPreview
            comments={[]}
            totalCount={topPost.commentCount}
            onSeeAll={() =>
              engagement.onSeeAllComments(topPost.id, topPost.commentCount)
            }
          />
          <CommentInputBar
            onSubmit={(text) => engagement.onSubmitComment(topPost.id, text)}
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TopCard — extracted so we can run a per-post `useTransform` that
// folds the deterministic base rotation into the drag-driven rotation.
// Without this composition the rotation snaps from `rotationDeg`
// (background state) to `0` (drag-derived) at the moment a card is
// promoted to top, which read as a jitter on every advance.
// ─────────────────────────────────────────────────────────────────────

function TopCard({
  post,
  rotationDeg,
  dragX,
  onDragEnd,
  onClick,
  onAuthorLongPress,
  bursts,
}: {
  post: FeedPost;
  rotationDeg: number;
  dragX: MotionValue<number>;
  onDragEnd: (e: unknown, info: PanInfo) => void;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onAuthorLongPress: () => void;
  bursts: GloveBurst[];
}) {
  // Drag rotation tilts ±18° around the per-post base rotation. At rest
  // (dragX=0) the value equals `rotationDeg`, matching the background
  // card's resting angle — so promoting a card from position 1 → 0 is
  // visually continuous.
  const rotate = useTransform(
    dragX,
    [-200, 0, 200],
    [rotationDeg - 18, rotationDeg, rotationDeg + 18],
  );

  return (
    <motion.div
      className="absolute inset-0"
      style={{
        x: dragX,
        rotate,
        zIndex: 30,
        willChange: "transform, opacity",
        touchAction: "pan-y pinch-zoom",
      }}
      drag="x"
      dragDirectionLock
      dragElastic={DRAG_ELASTIC}
      dragMomentum={false}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <RoundedFeedCard
        post={post}
        stackPosition={0}
        isTop
        rotationDeg={rotationDeg}
        onAuthorLongPress={onAuthorLongPress}
      />

      {bursts.map((b) => (
        <GloveBurst key={b.id} x={b.x} y={b.y} />
      ))}
    </motion.div>
  );
}

/* ─── Glove-tap burst ─── */

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
      <path
        d="M14 22c0-7.18 5.82-13 13-13h6c7.73 0 14 6.27 14 14v9c0 9.94-8.06 18-18 18h-2c-7.18 0-13-5.82-13-13V22z"
        fill="#DC2626"
      />
      <path
        d="M12 26c0-3.31 2.69-6 6-6h2v12h-2c-3.31 0-6-2.69-6-6z"
        fill="#B91C1C"
      />
      <rect x="16" y="48" width="28" height="8" rx="2" fill="#7F1D1D" />
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
      <BoxingGloveSvg size={64} />
    </motion.div>
  );
});

/* ─── Deterministic per-card rotation ─── */

function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h) ^ id.charCodeAt(i);
  }
  return Math.abs(h);
}

function computeRotation(id: string): number {
  return ((hashId(id) % 5) - 2) * 1.2;
}
