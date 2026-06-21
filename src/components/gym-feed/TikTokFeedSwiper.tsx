/**
 * TikTok-style vertical-swipe feed for gym-wide training-session media.
 *
 * Design choices (locked in the brainstorm):
 *  - CSS `scroll-snap-type: y mandatory` for native iOS momentum + snap.
 *    A purely native scroll container outperforms JS-driven transforms
 *    inside WKWebView and gives us pull-to-refresh for free (the browser
 *    only fires overscroll when the user is already at index 0).
 *  - Each post is a full-viewport panel (`100dvh` so it adapts to the
 *    iOS bottom safe-area / dynamic toolbar correctly).
 *  - The current post + the next one are mounted with a real `<video>`
 *    element; everything else is reduced to a poster image so we don't
 *    eat memory or bandwidth.
 *  - IntersectionObserver toggles play/pause, plus we hard-pause anything
 *    that scrolls off-screen as a belt-and-braces guard.
 *  - Swipe-down at index 0 reveals a pull-to-refresh control via native
 *    overscroll, resolving the "swipe down = previous post" vs "swipe down
 *    = refresh" conflict cleanly.
 */
import { forwardRef, useEffect, useRef, useState, useCallback } from "react";
import { ChevronLeft, Volume2, VolumeX, Play, Loader2, RefreshCw } from "lucide-react";
import { format, parseISO } from "date-fns";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import type { Id } from "@/../convex/_generated/dataModel";
import { FeedRightRail } from "./FeedRightRail";
import { CommentsSheet } from "./CommentsSheet";
import { useFeedEngagement } from "@/hooks/useFeedEngagement";
import { useDoubleTap } from "@/hooks/useDoubleTap";

export interface FeedPostItem {
  id: string;
  /** Epoch ms (Convex `_creationTime`). */
  createdAt: number;
  kind: "photo" | "video";
  url: string | null;
  caption: string | null;
  author: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
  };
  session: {
    id: string;
    date: string;
    /** PRIMARY discipline (martial art / "S&C" / "Rest"). */
    sessionType: string;
    /** OPTIONAL activity descriptor (Sparring, Strength, …); null when absent. */
    sessionTag?: string | null;
    rpe: number;
    durationMinutes: number;
  } | null;
  /** Server-authoritative engagement counters (cached on the post row). */
  likeCount: number;
  commentCount: number;
  viewerLiked: boolean;
}

interface Props {
  posts: FeedPostItem[];
  isLoadingMore: boolean;
  hasMore: boolean;
  /** Called when the user reaches near the end so the parent fetches the next page. */
  onLoadMore: () => void;
  /** Called when the user pulls to refresh from index 0. */
  onRefresh: () => Promise<void> | void;
  /** Called when the user taps the back button. */
  onClose: () => void;
}

/** How many panels ahead of the active one keep their `<video>` element mounted.
 *  Bigger = snappier swap, more memory. 1 is the TikTok default. */
const VIDEO_MOUNT_WINDOW = 1;

/** Photo dwell time before auto-advance, in ms. */
const PHOTO_DWELL_MS = 5_000;

/** How many posts before the end of the loaded list to start fetching the next page. */
const LOAD_MORE_TRIGGER = 3;

// Pull-to-refresh dial, mirrors the global <PullToRefresh /> so the feed
// scroller (which lives outside <main>) gets the same look-and-feel.
const THRESHOLD = 110;
const DAMPEN = 0.4;
const ARMED_HAPTIC_AT = THRESHOLD * 0.95;
const UPWARD_CANCEL_PX = 8;
const INTENT_PX = 30;
const HOLD_DURATION_MS = 500;

function safeRelative(iso: number): string {
  try {
    const diffMs = Date.now() - iso;
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return format(new Date(iso), "MMM d");
  } catch {
    return "";
  }
}

function safeSessionDate(iso?: string): string {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "EEE, MMM d");
  } catch {
    return iso;
  }
}

export function TikTokFeedSwiper({
  posts,
  isLoadingMore,
  hasMore,
  onLoadMore,
  onRefresh,
  onClose,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const pullStartY = useRef(0);
  const pulling = useRef(false);
  const armed = useRef(false);
  const holdStart = useRef<number | null>(null);
  const holdRaf = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  // Mounted ONCE at the swiper root (not per-panel) so the bottom sheet
  // persists across panel swaps and a comment thread stays open even if
  // the user inadvertently swipes to a neighbouring post.
  const [commentsForPostId, setCommentsForPostId] = useState<Id<"session_media"> | null>(null);
  const [commentsInitialCount, setCommentsInitialCount] = useState(0);

  // Track which post index is currently centred in the viewport via an
  // IntersectionObserver. Cheaper than reading scrollTop on every event.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry with the highest intersection ratio that's > 0.6
        // (well past halfway): that's the post the user has settled on.
        let bestIdx = activeIndex;
        let bestRatio = 0;
        for (const entry of entries) {
          const idx = Number((entry.target as HTMLElement).dataset.idx);
          if (entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestIdx = idx;
          }
        }
        if (bestRatio > 0.6 && bestIdx !== activeIndex) {
          setActiveIndex(bestIdx);
          triggerHaptic(ImpactStyle.Light);
        }
      },
      { root, threshold: [0, 0.4, 0.6, 0.8, 1] },
    );
    panelRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [activeIndex, posts.length]);

  // Pre-fetch the next page when the user is N-3 posts from the end.
  useEffect(() => {
    if (!hasMore || isLoadingMore) return;
    if (activeIndex >= posts.length - LOAD_MORE_TRIGGER) {
      onLoadMore();
    }
  }, [activeIndex, posts.length, hasMore, isLoadingMore, onLoadMore]);

  // Pull-to-refresh: scoped to the feed's internal scroller (the global
  // <PullToRefresh /> listens on <main>, which this overlay sits outside of).
  // Only arms at the very top of the very first post. Otherwise this is a
  // swipe between posts, not a pull.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const clearHold = () => {
      holdStart.current = null;
      if (holdRaf.current !== null) {
        cancelAnimationFrame(holdRaf.current);
        holdRaf.current = null;
      }
      if (holdTimer.current !== null) {
        window.clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      setHoldProgress(0);
    };

    const tickHold = () => {
      if (holdStart.current === null) return;
      const elapsed = Date.now() - holdStart.current;
      setHoldProgress(Math.min(elapsed / HOLD_DURATION_MS, 1));
      if (elapsed < HOLD_DURATION_MS) {
        holdRaf.current = requestAnimationFrame(tickHold);
      }
    };

    const triggerRefresh = () => {
      pulling.current = false;
      armed.current = false;
      clearHold();
      setRefreshing(true);
      setPullDistance(THRESHOLD * 0.7);
      triggerHaptic(ImpactStyle.Medium);
      Promise.resolve()
        .then(() => onRefresh())
        .catch(() => { /* swallow, leave UI to settle */ })
        .finally(() => {
          setTimeout(() => {
            setRefreshing(false);
            setPullDistance(0);
          }, 250);
        });
    };

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      if (activeIndex !== 0) return;
      if (scroller.scrollTop > 0) return;
      pullStartY.current = e.touches[0].clientY;
      pulling.current = true;
      armed.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pulling.current || refreshing) return;
      if (scroller.scrollTop > 0) {
        pulling.current = false;
        armed.current = false;
        clearHold();
        setPullDistance(0);
        return;
      }
      const dy = e.touches[0].clientY - pullStartY.current;
      if (dy < -UPWARD_CANCEL_PX) {
        pulling.current = false;
        armed.current = false;
        clearHold();
        setPullDistance(0);
        return;
      }
      if (dy > 0) {
        if (dy < INTENT_PX) return;
        if (e.cancelable) e.preventDefault();
        const dampened = Math.min((dy - INTENT_PX) * DAMPEN, THRESHOLD * 1.6);
        setPullDistance(dampened);
        if (dampened >= THRESHOLD) {
          if (!armed.current) {
            armed.current = true;
            triggerHaptic(ImpactStyle.Light);
          }
          if (holdStart.current === null) {
            holdStart.current = Date.now();
            holdRaf.current = requestAnimationFrame(tickHold);
            holdTimer.current = window.setTimeout(triggerRefresh, HOLD_DURATION_MS);
          }
        } else {
          if (armed.current) armed.current = false;
          if (holdStart.current !== null) clearHold();
        }
      }
    };

    const onTouchEnd = () => {
      if (!pulling.current) return;
      pulling.current = false;
      armed.current = false;
      clearHold();
      if (!refreshing) setPullDistance(0);
    };

    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("touchend", onTouchEnd, { passive: true });
    scroller.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
      clearHold();
    };
  }, [activeIndex, refreshing, onRefresh]);

  // Photo dwell: after PHOTO_DWELL_MS on a photo post, scroll to the next one.
  useEffect(() => {
    const post = posts[activeIndex];
    if (!post || post.kind !== "photo") return;
    if (activeIndex >= posts.length - 1) return;
    const t = setTimeout(() => {
      const next = panelRefs.current[activeIndex + 1];
      next?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, PHOTO_DWELL_MS);
    return () => clearTimeout(t);
  }, [activeIndex, posts]);

  const shouldMountVideo = useCallback(
    (idx: number) => Math.abs(idx - activeIndex) <= VIDEO_MOUNT_WINDOW,
    [activeIndex],
  );

  return (
    <div className="fixed inset-0 z-[10001] bg-black text-white">
      {/* Top affordances: back button + mute toggle. Always above the feed. */}
      <div
        className="absolute inset-x-0 z-20 flex items-center justify-between px-4"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close feed"
          className="h-9 w-9 rounded-full bg-white/15 backdrop-blur-md flex items-center justify-center active:bg-white/25 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} />
        </button>
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "Unmute" : "Mute"}
          className="h-9 w-9 rounded-full bg-white/15 backdrop-blur-md flex items-center justify-center active:bg-white/25 transition-colors"
        >
          {muted ? <VolumeX className="h-4 w-4" strokeWidth={2.4} /> : <Volume2 className="h-4 w-4" strokeWidth={2.4} />}
        </button>
      </div>

      {/* Pull-to-refresh dial, anchored beneath the back-button row so it
          doesn't collide with the top affordances when the user pulls. */}
      {(pullDistance > 0 || refreshing) && (() => {
        const progress = Math.min(pullDistance / THRESHOLD, 1);
        const atThreshold = progress >= 1;
        return (
          <div
            className="absolute inset-x-0 z-20 flex flex-col items-center justify-start pointer-events-none"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 52px)" }}
          >
            <div
              className="flex flex-col items-center justify-center"
              style={{
                height: `${pullDistance}px`,
                transition: pulling.current ? "none" : "height 0.3s ease-out",
                overflow: "hidden",
              }}
            >
              <div
                className="relative h-8 w-8 rounded-full bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center"
                style={{
                  opacity: Math.max(0.3, progress),
                  transform: `scale(${0.6 + progress * 0.4})`,
                  transition: pulling.current ? "none" : "all 0.3s ease-out",
                }}
              >
                {atThreshold && !refreshing && (
                  <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 32 32">
                    <circle
                      cx="16"
                      cy="16"
                      r="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-white"
                      strokeDasharray={`${holdProgress * 88} 88`}
                      strokeLinecap="round"
                    />
                  </svg>
                )}
                <RefreshCw
                  className={`h-4 w-4 text-white ${refreshing ? "animate-spin" : ""}`}
                  style={{ transform: refreshing ? undefined : `rotate(${progress * 270}deg)` }}
                />
              </div>
              {atThreshold && !refreshing && (
                <span className="text-[10px] text-white/70 mt-1 tabular-nums">
                  {holdProgress >= 1 ? "Refreshing…" : "Hold to refresh"}
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* The actual snap scroller. `100dvh` per panel adapts to iOS Safari's
          dynamic viewport better than `100vh`. */}
      <div
        ref={scrollerRef}
        className="h-full w-full overflow-y-auto scrollbar-hide"
        style={{
          scrollSnapType: "y mandatory",
          WebkitOverflowScrolling: "touch",
          overscrollBehaviorY: "contain",
        }}
      >
        {posts.map((post, idx) => (
          <FeedPanel
            key={post.id}
            ref={(el) => { panelRefs.current[idx] = el; }}
            post={post}
            isActive={idx === activeIndex}
            isMounted={shouldMountVideo(idx)}
            muted={muted}
            onTapToggleMute={() => setMuted((m) => !m)}
            onOpenComments={() => {
              setCommentsForPostId(post.id as unknown as Id<"session_media">);
              setCommentsInitialCount(post.commentCount);
            }}
            idx={idx}
          />
        ))}

        {/* End-of-feed sentinel */}
        {!hasMore && posts.length > 0 && (
          <div
            data-idx={posts.length}
            className="h-[100dvh] w-full flex items-center justify-center snap-start"
            style={{ scrollSnapAlign: "start" }}
          >
            <div className="text-center px-8">
              <p className="text-base font-semibold">You're all caught up</p>
              <p className="text-sm text-white/60 mt-1">Pull down to refresh.</p>
            </div>
          </div>
        )}

        {/* Loader for the next page */}
        {isLoadingMore && (
          <div className="h-12 flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-white/60" />
          </div>
        )}
      </div>

      {/* Comments sheet, mounted ONCE at swiper root so it survives panel
          swaps. `usePaginatedQuery` inside gates on `postId` being non-null
          so closed sheets fetch nothing. */}
      <CommentsSheet
        postId={commentsForPostId}
        initialCount={commentsInitialCount}
        onClose={() => setCommentsForPostId(null)}
        // The active panel owns its own engagement counter via the hook;
        // these noop callbacks satisfy the prop contract. The reactive
        // listFeed query will repaint the rail with the server count on
        // the next websocket tick anyway.
        onCommentAdded={() => {}}
        onCommentRemoved={() => {}}
      />
    </div>
  );
}

/* ─── one full-screen panel ─── */

interface FeedPanelProps {
  post: FeedPostItem;
  isActive: boolean;
  isMounted: boolean;
  muted: boolean;
  onTapToggleMute: () => void;
  onOpenComments: () => void;
  idx: number;
}

const FeedPanel = forwardRef<HTMLDivElement, FeedPanelProps>(function FeedPanel(
  { post, isActive, isMounted, muted, onTapToggleMute, onOpenComments, idx },
  ref,
) {
  // One engagement hook per panel so optimistic state is post-local.
  // Server-authoritative values from the feed query feed back in via
  // `useEffect` mirrors inside the hook, so a reactive update from
  // someone else's like still rolls into the UI.
  const engagement = useFeedEngagement(post.id as unknown as Id<"session_media">, {
    viewerLiked: post.viewerLiked,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
  });

  // Combined gesture: single tap toggles mute (video only), double tap
  // fires a like-only burst. `useDoubleTap` resolves which is which.
  const handleTap = useDoubleTap({
    onSingleTap: () => {
      if (post.kind === "video") onTapToggleMute();
    },
    onDoubleTap: () => engagement.doubleTapLike(),
  });
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
      const el = videoRef.current;
      if (!el) return;
      if (isActive) {
        el.muted = muted;
        const playPromise = el.play();
        if (playPromise && typeof playPromise.catch === "function") {
          // Autoplay can be blocked when un-muted; fall back to muted.
          playPromise.catch(() => {
            el.muted = true;
            el.play().catch(() => { /* give up, user can tap */ });
          });
        }
      } else {
        try { el.pause(); el.currentTime = 0; } catch { /* ignore */ }
      }
    }, [isActive, muted]);

    const sessionLabel = post.session
      ? `${post.session.sessionType} · ${post.session.durationMinutes} min · RPE ${post.session.rpe}`
      : null;

    return (
      <div
        ref={ref}
        data-idx={idx}
        className="relative h-[100dvh] w-full snap-start flex items-center justify-center bg-black"
        style={{ scrollSnapAlign: "start" }}
        onClick={handleTap}
      >
        {!post.url ? (
          <div className="text-white/60 text-sm">Media unavailable</div>
        ) : post.kind === "video" ? (
          isMounted ? (
            <video
              ref={videoRef}
              src={post.url}
              className="max-h-full max-w-full"
              playsInline
              loop
              muted={muted}
              preload={isActive ? "auto" : "metadata"}
            />
          ) : (
            <div className="flex items-center justify-center text-white/40">
              <Play className="h-12 w-12" strokeWidth={1.5} />
            </div>
          )
        ) : (
          <img src={post.url} alt={post.caption ?? "Training media"} className="max-h-full max-w-full object-contain" />
        )}

        {/* Photo dwell progress bar, Stories-style. Only while active. */}
        {isActive && post.kind === "photo" && (
          <div className="absolute inset-x-0 top-0 z-10 px-3" style={{ top: "calc(env(safe-area-inset-top, 0px) + 60px)" }}>
            <div className="h-0.5 w-full bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white"
                style={{
                  width: "100%",
                  animation: `dwellBar ${PHOTO_DWELL_MS}ms linear forwards`,
                }}
              />
            </div>
          </div>
        )}

        {/* Metadata overlay: bottom gradient. */}
        <div
          className="absolute inset-x-0 bottom-0 z-10 px-5"
          style={{
            paddingTop: "60px",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
            background: "linear-gradient(to top, rgba(0,0,0,0.78), transparent)",
          }}
        >
          <div className="flex items-center gap-2.5">
            {post.author.avatarUrl ? (
              <img
                src={post.author.avatarUrl}
                alt={post.author.displayName}
                className="h-8 w-8 rounded-full object-cover ring-2 ring-white/30"
              />
            ) : (
              <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
                {post.author.displayName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <span className="text-[15px] font-semibold">{post.author.displayName}</span>
            <span className="text-[13px] text-white/60">· {safeRelative(post.createdAt)}</span>
          </div>
          {sessionLabel && (
            <p className="text-[13px] text-white/85 mt-1.5">
              {sessionLabel}
              {post.session?.sessionTag && (
                <span className="ml-1.5 align-middle text-[10px] uppercase tracking-wider font-medium bg-white/15 backdrop-blur-md px-1.5 py-0.5 rounded-full">
                  {post.session.sessionTag}
                </span>
              )}
              {post.session?.date && (
                <span className="text-white/55"> · {safeSessionDate(post.session.date)}</span>
              )}
            </p>
          )}
          {post.caption && (
            <p className="text-[13px] text-white mt-1.5 leading-snug line-clamp-2">{post.caption}</p>
          )}
        </div>

        {/* Right-rail engagement stack: heart + comment count. Sits on
            top of the media but below the top-bar (z-10 vs z-20). */}
        <FeedRightRail
          liked={engagement.liked}
          likeCount={engagement.likeCount}
          commentCount={engagement.commentCount}
          burstKey={engagement.burstKey}
          onLikeToggle={engagement.toggleLike}
          onOpenComments={onOpenComments}
        />

        {/* CSS keyframe for the photo dwell bar. Inlined so this component
            doesn't depend on a global stylesheet edit. */}
        <style>{`
          @keyframes dwellBar { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        `}</style>
      </div>
    );
});
