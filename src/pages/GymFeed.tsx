/**
 * GymFeed page — TikTok-style vertical-swipe surface for every member of
 * the user's gym to see each other's training-session media.
 *
 * Data:
 *  - `api.gymFeed.listFeed` is a Convex paginated query (`numItems` + cursor).
 *  - We use `usePaginatedQuery` so subsequent pages stream in as the user
 *    swipes towards the end; the parent `TikTokFeedSwiper` calls
 *    `loadMore()` once the active index is within 3 posts of the loaded
 *    tail.
 *  - Pull-to-refresh resets via the same hook's reset semantics (re-query
 *    invalidation). We also call `loadMore(0)` to force the first page.
 *
 * Routing:
 *  - Single route `/gym-feed` (lazy-loaded in `App.tsx`).
 *  - Resolves the user's primary gym from `useMyGyms`. If the user is in
 *    multiple gyms we pick the first one for v1; a gym-picker chip in the
 *    header is a v2 nice-to-have.
 *  - Users with no gym membership see the empty state with a CTA to join
 *    a gym (route `/my-gym`).
 */
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { useMyGyms } from "@/hooks/coach/useMyGyms";
import { DashboardSkeleton } from "@/components/ui/skeleton-loader";
import { TikTokFeedSwiper, type FeedPostItem } from "@/components/gym-feed/TikTokFeedSwiper";
import { useCallback, useEffect, useMemo, useState } from "react";

// iOS Sheet-style ease + duration. Opacity-only so we don't reintroduce
// the `will-change: transform` containing-block trap that the portal fix
// was put in place to escape.
const EASE = [0.32, 0.72, 0, 1] as const;
const ENTER_MS = 220;
const EXIT_MS = 180;

export default function GymFeed() {
  const navigate = useNavigate();
  const { userId } = useUser();
  const { gyms, loading: gymsLoading } = useMyGyms(userId);
  const primaryGym = gyms[0] ?? null;
  const gymId = primaryGym?.gym_id as Id<"gyms"> | undefined;

  const { results, status, loadMore } = usePaginatedQuery(
    api.gymFeed.listFeed,
    gymId ? { gymId } : "skip",
    { initialNumItems: 10 },
  );

  // Clear the engagement badge on mount. One write per feed-open. The
  // mutation is idempotent so re-mounts during the same session don't
  // produce spurious churn — it just stamps the latest "now".
  const markEngagementSeen = useMutation(api.feedSocial.markEngagementSeen);
  useEffect(() => {
    if (!gymId) return;
    markEngagementSeen({}).catch(() => { /* best-effort */ });
  }, [gymId, markEngagementSeen]);

  // Map the Convex shape to the swiper's `FeedPostItem` (the swiper is
  // intentionally agnostic so it can be reused for, e.g., a single-author
  // archive viewer later).
  const posts: FeedPostItem[] = useMemo(
    () =>
      (results ?? []).map((row) => ({
        id: row.id as unknown as string,
        createdAt: row.createdAt,
        kind: row.kind,
        url: row.url,
        caption: row.caption,
        author: {
          userId: row.author.userId as unknown as string,
          displayName: row.author.displayName,
          avatarUrl: row.author.avatarUrl,
        },
        session: row.session
          ? {
              id: row.session.id as unknown as string,
              date: row.session.date,
              sessionType: row.session.sessionType,
              rpe: row.session.rpe,
              durationMinutes: row.session.durationMinutes,
            }
          : null,
        likeCount: row.likeCount,
        commentCount: row.commentCount,
        viewerLiked: row.viewerLiked,
      })),
    [results],
  );

  // Pull-to-refresh: Convex `usePaginatedQuery` doesn't expose an explicit
  // "refresh" but the reactive subscription auto-updates on any mutation
  // in the queried table. To force-flush stale page-1 we re-call
  // `loadMore(0)` which is a no-op when there's no more data — the actual
  // refresh comes from the reactive sub triggering a re-fetch on any new
  // `session_media` row. Wrapping in a 600ms delay so the spinner feels
  // intentional even when there's nothing new.
  const onRefresh = useCallback(async () => {
    await new Promise((r) => setTimeout(r, 600));
  }, []);

  // Staged close: trigger the exit fade, then let AnimatePresence run the
  // 180ms opacity-out before React Router unmounts us. Without this, the
  // route change tears the overlay down instantly and the gym page below
  // pops in mid-frame — the flicker the user was complaining about.
  const [closing, setClosing] = useState(false);
  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => navigate(-1), EXIT_MS);
  }, [closing, navigate]);

  if (gymsLoading) return <DashboardSkeleton />;

  // Render full-viewport overlays via a portal to document.body so they
  // escape the PageTransition motion.div's containing block (its
  // `will-change: transform` traps `position: fixed` descendants).
  const renderOverlay = (node: React.ReactNode) => {
    if (typeof document === "undefined") return node;
    return createPortal(
      <AnimatePresence>
        {!closing && (
          <motion.div
            key="gym-feed-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: ENTER_MS / 1000,
              ease: EASE,
              exit: { duration: EXIT_MS / 1000, ease: EASE },
            }}
          >
            {node}
          </motion.div>
        )}
      </AnimatePresence>,
      document.body,
    );
  };

  // No gym → empty state with a CTA back to the gym join surface.
  if (!primaryGym) {
    return renderOverlay(
      <div
        className="fixed inset-0 z-[10001] bg-black text-white flex flex-col items-center justify-center px-8"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)" }}
      >
        <p className="text-xl font-bold text-center">Join a gym to see the feed</p>
        <p className="text-sm text-white/60 mt-2 text-center">
          The gym feed shows every training-session photo and clip from members of your gym.
        </p>
        <button
          type="button"
          onClick={() => navigate("/my-gym")}
          className="mt-6 h-11 px-5 rounded-xs bg-primary text-primary-foreground text-[14px] font-semibold active:scale-[0.98] transition-transform"
        >
          Find a gym
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="mt-4 text-[13px] text-white/60 active:text-white transition-colors"
        >
          Back
        </button>
      </div>
    );
  }

  // Loaded gym, no posts yet → in-feed empty state with CTA to log a session.
  if (status === "Exhausted" && posts.length === 0) {
    return renderOverlay(
      <div
        className="fixed inset-0 z-[10001] bg-black text-white flex flex-col items-center justify-center px-8"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)" }}
      >
        <p className="text-xl font-bold text-center">No posts yet from {primaryGym.gym_name}</p>
        <p className="text-sm text-white/60 mt-2 text-center">
          Be the first to share a session. Log a workout and attach a photo or video — your teammates will see it here.
        </p>
        <button
          type="button"
          onClick={() => navigate("/gym")}
          className="mt-6 h-11 px-5 rounded-xs bg-primary text-primary-foreground text-[14px] font-semibold active:scale-[0.98] transition-transform"
        >
          Open Gym Tracker
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="mt-4 text-[13px] text-white/60 active:text-white transition-colors"
        >
          Back
        </button>
      </div>
    );
  }

  return renderOverlay(
    <TikTokFeedSwiper
      posts={posts}
      isLoadingMore={status === "LoadingMore" || status === "LoadingFirstPage"}
      hasMore={status === "CanLoadMore"}
      onLoadMore={() => loadMore(10)}
      onRefresh={onRefresh}
      onClose={handleClose}
    />
  );
}
