/**
 * PolaroidStack: the centerpiece of the Corner tab.
 *
 * Tap-to-advance deck (Instagram-"stacks" style):
 *   - The top card is TAP-driven, not swipe-driven. Pressing it dips the
 *     card (scale 0.96 + a light selection haptic); releasing commits:
 *     the card flies UP-AND-AWAY with a peel tilt while the next card,
 *     already sitting full-size behind it, is revealed, like flicking a
 *     card off a real deck. A light impact haptic fires on commit.
 *   - The fly-off direction alternates each tap (`flyDirRef`) so the deck
 *     never feels mechanical.
 *   - Liking is NO LONGER the photo tap. A floating heart button on the
 *     photo (bottom-right) owns the like and stops propagation so it can
 *     never advance the deck. A "n / total" counter pill sits top-right.
 *
 * When the last real post is tapped away, the stack returns `null` and
 * the parent (`Community.tsx`) cross-fades to the EmptyFeed call sheet.
 *
 * The exit card renders SEPARATELY (`exitingNode`) so the parent's
 * `dismissedIds` filter can drop the post from `posts` without unmounting
 * the card mid-flight. The deferred `setExitingPost(null)` + `advance()`
 * (after EXIT_DURATION_MS) keep `markPostViewed` firing only once the
 * animation finishes. See Community.tsx `pendingDismissalRef`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Heart } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { RoundedFeedCard } from "./RoundedFeedCard";
import { preloadAndDecodeImages } from "@/hooks/useImageReady";
import { EmptyStackState } from "./EmptyStackState";
import type { FeedPost, FeedStatus } from "@/hooks/community/useGymFeed";
import type { Id } from "../../../convex/_generated/dataModel";

const EXIT_DURATION_MS = 280;
const REDUCED_EXIT_DURATION_MS = 110;
const PREFETCH_TRIGGER = 5;
// How many upcoming full-res images to fetch + DECODE ahead of the top
// card. The deck only shows 3 at once, but decoding 6 deep keeps rapid
// tapping warm so a promoted card never has to decode on screen.
const DECODE_AHEAD = 6;

// Square deck: the slot matches the photo so the overlays (counter,
// heart) land on the image corners and the info row sits tight beneath.
const DECK_W = 312;
const DECK_H = 312;

const FLY_UP_MULT = 1.35; // * DECK_H, up and out the top
const FLY_SIDE_MULT = 0.18; // * DECK_W, small lateral drift
const FLY_TILT_DEG = 9; // peel tilt
const FLY_EASE = [0.32, 0.72, 0, 1] as const;

// Press-down dip: the single biggest "premium" tell for a tap deck.
const PRESS_SPRING = { type: "spring", stiffness: 700, damping: 30, mass: 1 } as const;

interface PolaroidStackProps {
  posts: FeedPost[];
  status: FeedStatus;
  loadMore: () => void;
  onIndexChange?: (index: number) => void;
  onOpenProfile: (userId: Id<"users">) => void;
  onPostClick: () => void;
  topIndex: number;
  advance: () => void;
  onSwipeCommit?: (postId: Id<"session_media">) => void;
  /** Shared like state (owned by the page) for the floating heart. */
  liked: boolean;
  onToggleLike: () => void;
  likeBurstKey?: number;
  /** Deck progress for the "n / total" counter pill. `seenCount` is how
   *  many posts have been dismissed so far; `totalCount` is the full
   *  (unfiltered) feed length. */
  seenCount: number;
  totalCount: number;
}

export function PolaroidStack({
  posts,
  status,
  loadMore,
  onIndexChange,
  onOpenProfile,
  onPostClick,
  topIndex,
  advance,
  onSwipeCommit,
  liked,
  onToggleLike,
  likeBurstKey,
  seenCount,
  totalCount,
}: PolaroidStackProps) {
  const prefersReducedMotion = useReducedMotion();

  const [exitingPost, setExitingPost] = useState<FeedPost | null>(null);
  const exitDirRef = useRef<1 | -1>(1);
  // Alternates each commit so consecutive cards peel off opposite sides.
  const flyDirRef = useRef<1 | -1>(1);
  // Backstop timer: only fires when the tab is backgrounded and Motion
  // never delivers onAnimationComplete (see commitAdvance / handleExitComplete).
  const exitTimerRef = useRef<number | null>(null);

  // ── Visible slice: at most 3 real posts, no sentinel filler ───────
  const visibleSlots: FeedPost[] = useMemo(() => {
    const slice = posts.slice(topIndex, topIndex + 3);
    if (!exitingPost) return slice;
    return slice.filter((p) => p.id !== exitingPost.id);
  }, [posts, topIndex, exitingPost]);

  const topPost: FeedPost | undefined = posts[topIndex];
  const isAtEnd = topPost === undefined;

  useEffect(() => {
    onIndexChange?.(topIndex);
  }, [topIndex, onIndexChange]);

  // Fetch + DECODE the next DECODE_AHEAD full images so a promoted card is
  // already paint-ready (no decode hitch / opacity fade on advance). Keyed
  // off the live deck order + the exiting post, so the window re-decodes
  // forward on every advance. Goes deeper than `visibleSlots` (3) so rapid
  // tapping stays ahead of the deck.
  useEffect(() => {
    const upcoming = posts
      .slice(topIndex, topIndex + DECODE_AHEAD + 1)
      .filter((p) => p.id !== exitingPost?.id)
      .map((p) => p.url);
    preloadAndDecodeImages(upcoming);
  }, [posts, topIndex, exitingPost]);

  // Pagination trigger: fetch more before we run out.
  useEffect(() => {
    if (status !== "CanLoadMore") return;
    if (posts.length - topIndex >= PREFETCH_TRIGGER) return;
    loadMore();
  }, [topIndex, posts.length, status, loadMore]);

  // ── Tap-to-advance ─────────────────────────────────────────────────
  // Reuses the exit-card mechanism the swipe path used; the only change
  // is the trigger (tap vs. drag) and the trajectory (up-and-away vs.
  // horizontal). The commit → onSwipeCommit → advance ordering is
  // preserved exactly so Community.tsx's deferred markPostViewed is unchanged.
  const commitAdvance = useCallback(() => {
    if (!topPost || exitingPost) return;
    const dir = flyDirRef.current;
    flyDirRef.current = dir === 1 ? -1 : 1;
    exitDirRef.current = dir;
    setExitingPost(topPost);
    onSwipeCommit?.(topPost.id);
    triggerHaptic(ImpactStyle.Light);

    // Cleanup is animation-driven (onAnimationComplete on the exit card,
    // see handleExitComplete). This timer is ONLY a backstop for when the
    // tab is backgrounded and Motion never fires onAnimationComplete; the
    // extra ~140ms keeps it from racing the animation's natural finish.
    const exitMs = prefersReducedMotion ? REDUCED_EXIT_DURATION_MS : EXIT_DURATION_MS;
    if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      setExitingPost(null);
      advance();
    }, exitMs + 140);
  }, [topPost, exitingPost, advance, onSwipeCommit, prefersReducedMotion]);

  // PRIMARY cleanup path: fires the instant the exit card's fly-off
  // animation completes, so the promotion happens in lockstep with the
  // actual Motion frame (no wall-clock drift / unmount pop). Clears the
  // backstop timer so it can't double-run.
  const handleExitComplete = useCallback(() => {
    if (exitTimerRef.current) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    setExitingPost(null);
    advance();
  }, [advance]);

  // Clear the backstop timer on unmount.
  useEffect(
    () => () => {
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
    },
    [],
  );

  // ── Empty + post-last-card states ──────────────────────────────────
  if (posts.length === 0 && !exitingPost) {
    return <EmptyStackState onPostClick={onPostClick} />;
  }
  if (isAtEnd && !exitingPost && visibleSlots.length === 0) {
    // Hold the deck's footprint instead of collapsing to null. The parent
    // cross-fades this feed branch out while the "all caught up" state fades
    // in (Community.tsx AnimatePresence); a sudden height collapse here would
    // make that cross-fade jump. An invisible same-size box keeps it smooth.
    return <div aria-hidden className="mx-auto" style={{ width: DECK_W, height: DECK_H }} />;
  }

  // ── Exit card (separate node so dismissedIds can drop the post from
  //     `posts` without unmounting it mid-flight) ──────────────────────
  const exitingNode = (() => {
    if (!exitingPost) return null;
    const dir = exitDirRef.current;
    const baseRotation = computeRotation(exitingPost.id);
    const dur = (prefersReducedMotion ? REDUCED_EXIT_DURATION_MS : EXIT_DURATION_MS) / 1000;

    return (
      <motion.div
        key={exitingPost.id}
        className="absolute inset-0"
        style={{ zIndex: 40, willChange: "transform, opacity", pointerEvents: "none" }}
        onAnimationComplete={handleExitComplete}
        initial={{ x: 0, y: 0, rotate: baseRotation, scale: 0.97, opacity: 1 }}
        animate={{
          x: dir * DECK_W * FLY_SIDE_MULT,
          y: -(DECK_H * FLY_UP_MULT),
          rotate: baseRotation + dir * FLY_TILT_DEG,
          scale: 1.04,
          opacity: 0,
        }}
        transition={
          prefersReducedMotion
            ? { duration: dur, ease: "linear" }
            : {
                x: { duration: dur, ease: FLY_EASE },
                y: { duration: dur, ease: FLY_EASE },
                rotate: { duration: dur, ease: FLY_EASE },
                scale: { duration: dur, ease: FLY_EASE },
                opacity: { delay: 0.14, duration: 0.16, ease: "easeIn" },
              }
        }
      >
        <RoundedFeedCard post={exitingPost} stackPosition={0} isTop rotationDeg={baseRotation} hideCaption />
      </motion.div>
    );
  })();

  const counterLabel =
    totalCount > 0 ? `${Math.min(seenCount + 1, totalCount)} / ${totalCount}` : null;

  return (
    <div className="flex flex-col">
      {/* Deck drop-in: plays once (the container persists across taps). */}
      <motion.div
        key="deck"
        className="relative mx-auto"
        style={{ width: DECK_W, height: DECK_H }}
        initial={prefersReducedMotion ? false : { opacity: 0, scale: 1.08, y: -28, rotate: -3 }}
        animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
        transition={
          prefersReducedMotion
            ? { duration: 0 }
            : { type: "spring", stiffness: 360, damping: 24, mass: 0.9 }
        }
      >
        {exitingNode}

        {visibleSlots.map((post, idx) => {
          const stackPos = idx as 0 | 1 | 2;
          const isTop = idx === 0 && !exitingPost;
          const rotationDeg = computeRotation(post.id);

          if (isTop) {
            return (
              <TopCard
                key={post.id}
                post={post}
                rotationDeg={rotationDeg}
                onAdvance={commitAdvance}
                onAuthorLongPress={() => onOpenProfile(post.author.userId)}
                prefersReducedMotion={!!prefersReducedMotion}
                liked={liked}
                onToggleLike={onToggleLike}
                likeBurstKey={likeBurstKey}
                counterLabel={counterLabel}
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
              // The card at idx 0 while a card is exiting is the one being
              // PROMOTED to top: match the exit card's easing/duration so
              // the reveal lands in lockstep, no double-motion stutter.
              promoting={idx === 0 && !!exitingPost}
            />
          );
        })}
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TopCard: tap-driven. Press dips it (scale 0.96); a tap commits the
// advance. The counter + floating heart are overlaid here (rather than
// inside the memoized RoundedFeedCard) so the heart's liked state can
// re-render freely without touching the shared photo component.
// ─────────────────────────────────────────────────────────────────────

function TopCard({
  post,
  rotationDeg,
  onAdvance,
  onAuthorLongPress,
  prefersReducedMotion,
  liked,
  onToggleLike,
  likeBurstKey,
  counterLabel,
}: {
  post: FeedPost;
  rotationDeg: number;
  onAdvance: () => void;
  onAuthorLongPress: () => void;
  prefersReducedMotion: boolean;
  liked: boolean;
  onToggleLike: () => void;
  likeBurstKey?: number;
  counterLabel: string | null;
}) {
  const [pressed, setPressed] = useState(false);

  // Visual dip only, no haptic here. A press that commits an advance
  // already fires a Light impact in commitAdvance, so every actual tap
  // gives feedback; firing on pointerdown too would buzz on every scroll
  // that happens to start on the photo.
  const handlePointerDown = () => setPressed(true);
  const release = () => setPressed(false);

  return (
    <motion.div
      className="absolute inset-0"
      style={{
        rotate: rotationDeg,
        zIndex: 30,
        willChange: "transform",
        touchAction: "manipulation",
      }}
      animate={{ scale: pressed && !prefersReducedMotion ? 0.96 : 1 }}
      transition={PRESS_SPRING}
      onPointerDown={handlePointerDown}
      onPointerUp={release}
      onPointerLeave={release}
      onClick={onAdvance}
    >
      <RoundedFeedCard
        post={post}
        stackPosition={0}
        isTop
        rotationDeg={rotationDeg}
        onAuthorLongPress={onAuthorLongPress}
        hideCaption
      />

      {/* Caption: rendered here (not on the gradient) so it never sits
          under the heart button. Bottom-left, clears the heart's width. */}
      {post.caption && (
        <p className="pointer-events-none absolute bottom-3 left-3 right-16 z-[3] text-[13px] font-medium leading-snug text-white line-clamp-2 drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
          {post.caption}
        </p>
      )}

      {/* Counter pill, top-right. */}
      {counterLabel && (
        <div className="pointer-events-none absolute top-3 right-3 z-[3] rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[11px] font-bold tracking-wide text-white backdrop-blur-md">
          {counterLabel}
        </div>
      )}

      {/* Floating heart, bottom-right. stopPropagation so it never advances. */}
      <button
        type="button"
        aria-label={liked ? "Unlike post" : "Like post"}
        aria-pressed={liked}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleLike();
        }}
        className="absolute bottom-3 right-3 z-[5] flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/35 backdrop-blur-md transition-transform active:scale-90"
      >
        <Heart
          className={`h-6 w-6 transition-colors ${liked ? "fill-func-danger-red text-func-danger-red" : "text-white"}`}
          strokeWidth={2.2}
        />
        {likeBurstKey !== undefined && likeBurstKey > 0 && (
          <motion.span
            key={likeBurstKey}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            initial={{ scale: 0.6, opacity: 0.9 }}
            animate={{ scale: 1.9, opacity: 0 }}
            transition={{ duration: 0.5, ease: FLY_EASE }}
          >
            <Heart className="h-6 w-6 fill-func-danger-red/40 text-func-danger-red/40" strokeWidth={0} />
          </motion.span>
        )}
      </button>
    </motion.div>
  );
}

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
