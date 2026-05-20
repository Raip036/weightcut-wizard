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
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, UserPlus, History, Dumbbell } from "lucide-react";
import wizardMascot from "@/assets/wizard-tutorial.png";
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
import { ActivitySheet } from "@/components/community/ActivitySheet";
import { CommentsSheet } from "@/components/gym-feed/CommentsSheet";
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

        {/* Content area — branches on member-count threshold + load state.
            Wrapped in AnimatePresence so the swap between the feed and
            the "all caught up" empty state cross-fades smoothly when the
            user swipes the last polaroid (or when posts refill). */}
        <main className="px-5 pb-32 pt-2">
          <AnimatePresence mode="wait" initial={false}>
            {(() => {
              const branch =
                !primaryGym && !gymsLoading
                  ? "empty"
                  : !gymId || gymsLoading
                    ? "loading"
                    : status === "LoadingFirstPage"
                      ? "loading"
                      : posts.length === 0
                        ? "empty"
                        : effectivePosts.length === 0
                          ? "empty"
                          : "feed";

              if (branch === "loading") {
                // Neutral loader instead of the polaroid-shaped skeleton —
                // when the feed resolves empty, the user previously saw a
                // polaroid flash before the EmptyFeed appeared. A soft,
                // non-card-shaped loader avoids implying a card will land
                // there and matches the smooth-load feel of the rest of
                // the app.
                return (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="mt-10 flex items-center justify-center min-h-[280px]"
                  >
                    <div className="h-7 w-7 rounded-full border-2 border-muted-foreground/20 border-t-primary animate-spin" aria-label="Loading feed" />
                  </motion.div>
                );
              }

              if (branch === "empty") {
                return (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                  >
                    <EmptyFeed
                      onInviteClick={() => navigate("/my-gym")}
                      onLogSessionClick={() => navigate("/training-calendar")}
                    />
                  </motion.div>
                );
              }

              return (
                <motion.div
                  key="feed"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
                >
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
                </motion.div>
              );
            })()}
          </AnimatePresence>
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
    <section className="mt-8 text-center max-w-sm mx-auto">
      <img
        src={wizardMascot}
        alt=""
        className="mx-auto h-24 w-24 object-contain"
      />
      <h2 className="mt-3 text-[22px] font-bold tracking-tight">You're all caught up</h2>
      <p className="text-[13px] text-muted-foreground mt-1.5 max-w-[28ch] mx-auto leading-snug">
        Nothing new on the mat. Pick one to keep momentum.
      </p>

      <div className="mt-6 space-y-2.5">
        <EmptyActionChip
          icon={<Dumbbell className="h-4 w-4" />}
          label="Log a session"
          sublabel="Add it to the feed"
          onClick={onLogSessionClick}
          primary
        />
        <EmptyActionChip
          icon={<UserPlus className="h-4 w-4" />}
          label="Invite a teammate"
          sublabel="Bring someone into the gym"
          onClick={onInviteClick}
        />
        <EmptyActionChip
          icon={<History className="h-4 w-4" />}
          label="Browse history"
          sublabel="Revisit past sessions"
          onClick={onLogSessionClick}
        />
      </div>
    </section>
  );
}

function EmptyActionChip({
  icon, label, sublabel, primary, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full min-h-[60px] flex items-center gap-3 px-4 py-3 rounded-2xl text-left active:scale-[0.98] transition-all ${
        primary
          ? "bg-primary text-primary-foreground"
          : "bg-card/60 border border-border/40 active:bg-muted/40"
      }`}
    >
      <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
        primary ? "bg-white/15 text-primary-foreground" : "bg-primary/15 text-primary"
      }`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-[15px] font-semibold leading-tight ${primary ? "" : "text-foreground"}`}>{label}</p>
        <p className={`text-[12px] mt-0.5 leading-snug truncate ${
          primary ? "text-primary-foreground/80" : "text-muted-foreground"
        }`}>
          {sublabel}
        </p>
      </div>
      <ArrowRight className={`h-4 w-4 shrink-0 ${primary ? "text-primary-foreground/80" : "text-muted-foreground/60"}`} />
    </button>
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
    <div className="mt-2">
      {/* Stack wrapper carries an explicit bottom buffer so the background
          cards' y-offset (up to ~20px below the 396px container) and any
          motion overshoot during a release can't visually creep into the
          SessionInfoCard below. Without this margin, the deck and info
          card sit ~24px apart (space-y-6), which the y-shifted backgrounds
          can paint into. 56px gives the deck enough reserved space below
          while staying compact on small viewports. */}
      <div className="mt-4 mb-14">
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
