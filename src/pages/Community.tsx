/**
 * Corner — the gym-scoped social tab.
 *
 * Three rendering states the page resolves between, in priority order:
 *
 *   1. No gym yet → route to `/join`. The Community tab is meaningless
 *      without a primary gym; we don't render an in-page CTA because
 *      the route already has the full invite-code UX.
 *
 *   2. Gym joined but no posts yet → empty-state card prompting the user
 *      to share their first session. We do not gate on member count;
 *      a solo-member gym can still post and see their own feed.
 *
 *   3. Gym + at least one post → full stack. `PolaroidStack` owns the
 *      gesture deck; `SessionInfoCard` binds to whatever post is on
 *      top via `topIndex` lifted into this page.
 *
 * On mount we fire `markEngagementSeen` so the red dot on the bottom
 * nav clears immediately — this is the user's "I've seen the new
 * activity" signal regardless of whether they end up tapping any
 * specific post.
 *
 * The page is full-screen, dark, with `pt-[env(safe-area-inset-top)]`
 * so the gym header doesn't collide with the iOS notch / status bar.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Camera } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { useMyGyms } from "@/hooks/coach/useMyGyms";
import { useGymFeed, type FeedPost } from "@/hooks/community/useGymFeed";
import { usePolaroidStack } from "@/hooks/community/usePolaroidStack";
import { GymHeader } from "@/components/community/GymHeader";
import { PolaroidStack } from "@/components/community/PolaroidStack";
import { SessionInfoCard } from "@/components/community/SessionInfoCard";
import { StackSkeleton } from "@/components/community/StackSkeleton";
import { ActivitySheet } from "@/components/community/ActivitySheet";
import { CommentsSheet } from "@/components/gym-feed/CommentsSheet";
import { Button } from "@/components/ui/button";
import { useFeedEngagement } from "@/hooks/useFeedEngagement";
import { logger } from "@/lib/logger";
import { useTutorial } from "@/tutorial/useTutorial";

export default function Community() {
  const navigate = useNavigate();
  const { userId } = useUser();
  const { gyms, loading: gymsLoading } = useMyGyms(userId);

  // Single-gym world in v1; pick the first active membership.
  const primaryGym = gyms[0] ?? null;
  const gymId = (primaryGym?.gym_id ?? null) as Id<"gyms"> | null;

  // Feed query — gated on `gymId` so we don't burn a round-trip on the
  // pre-resolution render.
  const { results: posts, status, loadMore } = useGymFeed(gymId);

  // Locally-tracked dismissed post ids. The polaroid stack filters
  // against this set so a flicked post leaves the stack immediately and
  // does not reappear if the reactive listFeed lags or returns it again
  // before the server-side feed_views filter catches up. Without this,
  // advancing a numeric topIndex against a reactively shrinking posts
  // array caused the stack to skip cards or pop them back in.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const effectivePosts = useMemo(
    () => posts.filter((p) => !dismissedIds.has(p.id as string)),
    [posts, dismissedIds],
  );

  // Stack state — only motion primitives are used; topIndex/advance
  // from the hook are intentionally ignored since dismissedIds drives
  // visibility now.
  const { reset } = usePolaroidStack({ postCount: effectivePosts.length });
  // Reset the deck whenever the gym switches — otherwise a persisted
  // index from a prior gym would point into an unrelated feed.
  useEffect(() => {
    if (gymId) {
      setDismissedIds(new Set());
      reset();
    }
    // We deliberately don't depend on `reset` (stable from hook) — only
    // on gymId. Including reset would trigger an extra reset on first
    // mount because of the closure identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  // mark-post-viewed mutation — fires AFTER the exit animation completes,
  // not when the swipe commits. See pendingDismissalRef below.
  const markPostViewed = useMutation(api.feedSocial.markPostViewed);

  // Track the post that's currently in the middle of its fly-away animation.
  // `onSwipeCommit` records the id here; `handleAdvance` flushes it once the
  // animation finishes. Deferring both `setDismissedIds` and `markPostViewed`
  // until that point keeps `CommunityFeedSection` mounted through the full
  // exit, which fixes the last-card case where dismissing the post
  // synchronously would unmount the entire `PolaroidStack` before its exit
  // animation could paint.
  const pendingDismissalRef = useRef<Id<"session_media"> | null>(null);

  const handlePostSwiped = useCallback(
    (postId: Id<"session_media">) => {
      // Just record — actual dismiss + server mutation fire in handleAdvance.
      pendingDismissalRef.current = postId;
    },
    [],
  );

  const handleAdvance = useCallback(() => {
    const pending = pendingDismissalRef.current;
    if (!pending) return;
    pendingDismissalRef.current = null;

    setDismissedIds((prev) => {
      if (prev.has(pending as string)) return prev;
      const next = new Set(prev);
      next.add(pending as string);
      return next;
    });

    markPostViewed({ postId: pending }).catch((err) => {
      logger.warn("markPostViewed failed", { err: String(err) });
    });
  }, [markPostViewed]);

  // Engagement-seen mutation — clear the bottom-nav red dot once the
  // user has *opened* the tab. Idempotent server-side, so we don't
  // need to gate on whether there were unreads.
  const markEngagementSeen = useMutation(api.feedSocial.markEngagementSeen);
  useEffect(() => {
    if (!gymId) return;
    markEngagementSeen({}).catch((err) => {
      logger.warn("Community: markEngagementSeen failed", { err: String(err) });
    });
    // Run once per session per gym — the mutation is cheap enough that
    // re-running on mount of a remount is fine.
    // markEngagementSeen identity is unstable from Convex; we only want to fire on gymId change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  // Activity sheet state — mounted at page root, opened by the bell
  // in GymHeader. Sheet auto-fires markActivitySeen on open to clear
  // the unread badge.
  const [activityOpen, setActivityOpen] = useState(false);

  // Comments sheet state — mounted once at page root so it survives
  // deck advances (matches the existing TikTokFeedSwiper pattern).
  const [commentsPostId, setCommentsPostId] = useState<Id<"session_media"> | null>(null);
  const [commentsInitialCount, setCommentsInitialCount] = useState(0);
  const openComments = useCallback(
    (postId: Id<"session_media">, count: number) => {
      setCommentsPostId(postId);
      setCommentsInitialCount(count);
    },
    [],
  );
  const closeComments = useCallback(() => setCommentsPostId(null), []);

  // Stable callbacks for CommunityFeedSection — keeps the memoized
  // child from re-rendering whenever the parent rebuilds inline arrows.
  const handleOpenProfile = useCallback(
    (uid: Id<"users">) => navigate(`/profile/${uid}`),
    [navigate],
  );
  const handlePostClick = useCallback(
    () => navigate("/training-calendar"),
    [navigate],
  );

  // ── State 1: no gym ─────────────────────────────────────────────────
  // The user-id-based skeleton from `useMyGyms` falls into this branch
  // too — but we keep them visually distinct via the `gymsLoading` flag
  // so we don't bounce the user to `/join` before the query resolves.
  //
  // The navigate must run from an effect, not during render, otherwise
  // React fires "Cannot update a component while rendering a different
  // component" — and on iOS that warning is a noisy red-screen in dev.
  //
  // EXCEPTION: when the tutorial is mid-flight we hold position. The
  // onboarding tour steps the user through Community as one of its
  // beats; bouncing them to /join here would interrupt the tour, drop
  // them on a different route, and stop the tutorial state machine.
  // We render an inline empty state instead.
  const { isActive: isTutorialActive } = useTutorial();
  const shouldRedirectToJoin = !gymsLoading && !primaryGym && !isTutorialActive;
  useEffect(() => {
    if (shouldRedirectToJoin) {
      navigate("/join", { replace: true });
    }
  }, [shouldRedirectToJoin, navigate]);
  if (shouldRedirectToJoin) {
    return null;
  }

  return (
    <div
      className="min-h-screen w-full bg-background text-foreground"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        className="pt-2"
      >
        {primaryGym && (
          <GymHeader
            gymId={primaryGym.gym_id as Id<"gyms">}
            gymName={primaryGym.gym_name}
            memberCount={null}
            onInviteClick={() => navigate("/my-gym")}
            onActivityClick={() => setActivityOpen(true)}
          />
        )}

        {/* Content area — branches on member-count threshold + load state. */}
        <main className="px-5 pb-32 pt-2">
          {!primaryGym && !gymsLoading ? (
            // Tutorial-only: user has no gym but we held them on this
            // route so the tour can keep narrating. Show the same
            // EmptyFeed used elsewhere — "Bring a teammate" deep-links
            // to /my-gym so the user has an obvious next step once
            // the tour finishes.
            <EmptyFeed
              onInviteClick={() => navigate("/my-gym")}
              onLogSessionClick={() => navigate("/training-calendar")}
            />
          ) : !gymId || gymsLoading ? (
            <div className="mt-8">
              <StackSkeleton />
            </div>
          ) : status === "LoadingFirstPage" ? (
            <div className="mt-8">
              <StackSkeleton />
            </div>
          ) : posts.length === 0 ? (
            // Empty feed: encourage the user to post their first session.
            // Solo-member gyms see this same card; they can post and the
            // feed will populate with their own posts on the next tick.
            <EmptyFeed
              onInviteClick={() => navigate("/my-gym")}
              onLogSessionClick={() => navigate("/training-calendar")}
            />
          ) : effectivePosts.length === 0 ? (
            // All known posts consumed this session. Same friendly state
            // as the global empty feed — encourage the user to log a
            // session so the feed refills.
            <EmptyFeed
              onInviteClick={() => navigate("/my-gym")}
              onLogSessionClick={() => navigate("/training-calendar")}
            />
          ) : (
            <CommunityFeedSection
              posts={effectivePosts}
              status={status}
              loadMore={loadMore}
              topIndex={0}
              onTopIndexChange={() => {
                /* unused — dismissedIds drives the head */
              }}
              advance={handleAdvance}
              onOpenProfile={handleOpenProfile}
              onOpenComments={openComments}
              onPostSwiped={handlePostSwiped}
              onPostClick={handlePostClick}
            />
          )}
        </main>
      </motion.div>

      {/* Activity sheet — opens from the bell in the header. */}
      <ActivitySheet
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        gymId={gymId}
        onOpenComments={(postId) => openComments(postId, 0)}
      />

      {/* Comments sheet — mounted at page root, gated on postId. */}
      <CommentsSheet
        postId={commentsPostId}
        initialCount={commentsInitialCount}
        onClose={closeComments}
        onCommentAdded={() => {
          // The reactive listFeed will repaint with the server-authoritative
          // count on the next websocket tick. No client mutation needed.
        }}
        onCommentRemoved={() => {}}
      />
    </div>
  );
}

/* ─── Empty feed state ─── */

interface EmptyFeedProps {
  onInviteClick: () => void;
  onLogSessionClick: () => void;
}

function EmptyFeed({ onInviteClick, onLogSessionClick }: EmptyFeedProps) {
  return (
    <section className="glass-card rounded-2xl border border-border/50 p-6 mt-6 text-center">
      <div className="mx-auto h-16 w-16 rounded-2xl bg-foreground/[0.06] dark:bg-white/[0.08] flex items-center justify-center mb-4">
        <Camera className="h-8 w-8 text-foreground" strokeWidth={1.5} />
      </div>
      <h2 className="text-lg font-semibold">Feed cleared</h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-[30ch] mx-auto">
        You've seen every post for now. Log a session and bring it back to life.
      </p>

      <Button
        type="button"
        onClick={onLogSessionClick}
        className="mt-6 rounded-full px-6"
      >
        Log a training session
      </Button>

      <button
        type="button"
        onClick={onInviteClick}
        className="mt-3 block w-full text-sm text-muted-foreground underline-offset-2 hover:underline"
      >
        Bring a teammate
      </button>
    </section>
  );
}

/* ─── Polaroid + info card composition ─── */

interface CommunityFeedSectionProps {
  posts: FeedPost[];
  status: ReturnType<typeof useGymFeed>["status"];
  loadMore: () => void;
  topIndex: number;
  onTopIndexChange: (i: number) => void;
  advance: () => void;
  onOpenProfile: (userId: Id<"users">) => void;
  onOpenComments: (postId: Id<"session_media">, count: number) => void;
  onPostSwiped: (postId: Id<"session_media">) => void;
  onPostClick: () => void;
}

const CommunityFeedSection = React.memo(function CommunityFeedSection({
  posts,
  status,
  loadMore,
  topIndex,
  onTopIndexChange,
  advance,
  onOpenProfile,
  onOpenComments,
  onPostSwiped,
  onPostClick,
}: CommunityFeedSectionProps) {
  const topPost = posts[topIndex];

  // Stabilize the server snapshot passed into useFeedEngagement so the
  // hook's sync effects don't fire on every parent render — they should
  // only fire when one of the three values actually changes.
  const server = useMemo(
    () =>
      topPost
        ? {
            viewerLiked: topPost.viewerLiked,
            likeCount: topPost.likeCount,
            commentCount: topPost.commentCount,
          }
        : { viewerLiked: false, likeCount: 0, commentCount: 0 },
    [topPost?.viewerLiked, topPost?.likeCount, topPost?.commentCount],
  );

  // One engagement hook lives at this level so the double-tap on the
  // polaroid stack and the heart on the info-card mutate the SAME
  // optimistic state. Without this lift, the two surfaces would each
  // have their own optimistic mirror and could drift apart mid-tap.
  const topEngagement = useFeedEngagement(
    topPost ? topPost.id : ("placeholder" as unknown as Id<"session_media">),
    server,
  );

  // Stable wrapper for PolaroidStack's onDoubleTapLike. `doubleTapLike`
  // is wrapped in useCallback inside the hook; its identity only shifts
  // when `liked` flips, so this stays stable across the bulk of renders.
  const handleDoubleTapLike = useCallback(
    () => topEngagement.doubleTapLike(),
    [topEngagement.doubleTapLike],
  );

  return (
    <div className="space-y-6 mt-2">
      <div className="mt-4">
        <PolaroidStack
          posts={posts}
          status={status}
          loadMore={loadMore}
          topIndex={topIndex}
          advance={advance}
          onIndexChange={onTopIndexChange}
          onOpenProfile={onOpenProfile}
          onDoubleTapLike={handleDoubleTapLike}
          onSwipeCommit={onPostSwiped}
          onPostClick={onPostClick}
        />
      </div>

      {topPost && (
        <SessionInfoCard
          post={topPost}
          engagement={topEngagement}
          onCommentTap={onOpenComments}
          onProfileTap={onOpenProfile}
        />
      )}
    </div>
  );
});
