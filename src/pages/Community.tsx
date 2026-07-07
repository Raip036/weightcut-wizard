/**
 * Corner, the gym-scoped social tab.
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
 * nav clears immediately, this is the user's "I've seen the new
 * activity" signal regardless of whether they end up tapping any
 * specific post.
 *
 * The page is full-screen, dark, with `pt-[env(safe-area-inset-top)]`
 * so the gym header doesn't collide with the iOS notch / status bar.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ArrowRight, ChevronDown, Check } from "lucide-react";
import wizardMascot from "@/assets/wizard_3D.png";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { useMyGyms, type MyGymRow } from "@/hooks/coach/useMyGyms";
import { useGymFeed, type FeedPost } from "@/hooks/community/useGymFeed";
import { usePolaroidStack } from "@/hooks/community/usePolaroidStack";
import { GymHeader } from "@/components/community/GymHeader";
import { JoinGymGate } from "@/components/community/JoinGymGate";
import { GymProfileSheet } from "@/components/community/GymProfileSheet";
import { PolaroidStack } from "@/components/community/PolaroidStack";
import { SessionInfoCard } from "@/components/community/SessionInfoCard";
import { ActivitySheet } from "@/components/community/ActivitySheet";
import { CommentsSheet } from "@/components/gym-feed/CommentsSheet";
import { useFeedEngagement } from "@/hooks/useFeedEngagement";
import { logger } from "@/lib/logger";
import { track, EVENTS } from "@/lib/analytics";
import { useTutorial } from "@/tutorial/useTutorial";
import { AnnouncementsSection } from "@/components/coach/AnnouncementsSection";
import { LeaderboardSection } from "@/components/leaderboard/LeaderboardSection";
import { GymLogoAvatar } from "@/components/coach/GymLogoAvatar";
import { StaggerContainer, StaggerItem } from "@/components/community/communityStagger";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";

export default function Community() {
  const navigate = useNavigate();
  const { userId } = useUser();
  const { gyms, loading: gymsLoading } = useMyGyms(userId);

  // Active-gym selection. Multi-gym athletes can pick which gym scopes
  // the feed / announcements / leaderboard via the header switcher; the
  // selection persists per-user in localStorage so a refresh keeps them
  // on the same gym they last opened.
  const activeGymStorageKey = userId ? `community-active-gym:${userId}` : null;
  const [activeGymId, setActiveGymId] = useState<string | null>(() => {
    if (typeof window === "undefined" || !activeGymStorageKey) return null;
    return window.localStorage.getItem(activeGymStorageKey);
  });
  const [switcherOpen, setSwitcherOpen] = useState(false);

  // Resolve the active gym row from the membership list. Falls back to
  // the first gym when the stored id is stale (e.g. user left that gym
  // on another device) or has never been set.
  const activeGym: MyGymRow | null = useMemo(() => {
    if (gyms.length === 0) return null;
    if (activeGymId) {
      const match = gyms.find((g) => g.gym_id === activeGymId);
      if (match) return match;
    }
    return gyms[0];
  }, [gyms, activeGymId]);

  // If the resolved gym doesn't match the stored id (stale or unset),
  // reconcile localStorage so a future read returns a valid id without
  // re-running the membership filter.
  useEffect(() => {
    if (!activeGymStorageKey || !activeGym) return;
    if (activeGym.gym_id !== activeGymId) {
      window.localStorage.setItem(activeGymStorageKey, activeGym.gym_id);
      setActiveGymId(activeGym.gym_id);
    }
  }, [activeGym, activeGymId, activeGymStorageKey]);

  const handleSelectGym = useCallback(
    (gym: MyGymRow) => {
      triggerHaptic(ImpactStyle.Light);
      if (activeGymStorageKey) {
        window.localStorage.setItem(activeGymStorageKey, gym.gym_id);
      }
      setActiveGymId(gym.gym_id);
      setSwitcherOpen(false);
    },
    [activeGymStorageKey],
  );

  // Aliased back to the previous variable names so the rest of the page
  // (feed gating, sheets, branch logic) keeps reading the same identifiers.
  const primaryGym = activeGym;
  const gymId = (primaryGym?.gym_id ?? null) as Id<"gyms"> | null;
  const isMultiGym = gyms.length > 1;

  // Feed query, gated on `gymId` so we don't burn a round-trip on the
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

  // ── Orchestrated entrance gate ──────────────────────────────────────
  // "Core ready" = gyms resolved AND (no gym, or the feed's first page has
  // resolved, empty or not). Hold one soft loader until then, then cascade
  // every section in together so nothing pops in piecemeal.
  const coreReady = !gymsLoading && (!gymId || status !== "LoadingFirstPage");
  // Sticky: once revealed we never drop back to the full-page loader. A later
  // gym-switch reload is handled locally by the feed's inner AnimatePresence,
  // so switching gyms does NOT re-trigger the whole-page cascade.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (coreReady) setRevealed(true);
  }, [coreReady]);

  // Stack state, only motion primitives are used; topIndex/advance
  // from the hook are intentionally ignored since dismissedIds drives
  // visibility now.
  const { reset } = usePolaroidStack({ postCount: effectivePosts.length });
  // Reset the deck whenever the gym switches, otherwise a persisted
  // index from a prior gym would point into an unrelated feed.
  useEffect(() => {
    if (gymId) {
      setDismissedIds(new Set());
      reset();
    }
    // We deliberately don't depend on `reset` (stable from hook), only
    // on gymId. Including reset would trigger an extra reset on first
    // mount because of the closure identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  // mark-post-viewed mutation, fires AFTER the exit animation completes,
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
      // Just record, actual dismiss + server mutation fire in handleAdvance.
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
    // Lurker-depth signal: one event per card the viewer swiped through.
    track(EVENTS.DECK_POST_VIEWED, { post_id: pending });
  }, [markPostViewed]);

  // Engagement-seen mutation, clear the bottom-nav red dot once the
  // user has *opened* the tab. Idempotent server-side, so we don't
  // need to gate on whether there were unreads.
  const markEngagementSeen = useMutation(api.feedSocial.markEngagementSeen);
  useEffect(() => {
    if (!gymId) return;
    markEngagementSeen({}).catch((err) => {
      logger.warn("Community: markEngagementSeen failed", { err: String(err) });
    });
    // Run once per session per gym, the mutation is cheap enough that
    // re-running on mount of a remount is fine.
    // markEngagementSeen identity is unstable from Convex; we only want to fire on gymId change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  // Activity sheet state, mounted at page root, opened by the bell
  // in GymHeader. Sheet auto-fires markActivitySeen on open to clear
  // the unread badge.
  const [activityOpen, setActivityOpen] = useState(false);

  // Feed | Leaderboard segmented tab. The leaderboard used to sit below the
  // feed (an always-mounted `gymLeaderboard.weekly` subscription on every
  // Corner open); moving it behind a tab declutters the feed AND lazy-mounts
  // the leaderboard query only when the tab is actually selected.
  const [communityTab, setCommunityTab] = useState<"feed" | "leaderboard">("feed");

  // Gym profile sheet, opens when the user taps the GymHeader cluster
  // (logo + title + counts). Mounted at page root so the sheet keeps its
  // own animation/dismiss lifecycle independent of the feed below.
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);

  // Comments sheet state, mounted once at page root so it survives
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

  // Stable callbacks for CommunityFeedSection, keeps the memoized
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
  // too, but we keep them visually distinct via the `gymsLoading` flag
  // so we don't bounce the user to `/join` before the query resolves.
  //
  // The navigate must run from an effect, not during render, otherwise
  // React fires "Cannot update a component while rendering a different
  // component", and on iOS that warning is a noisy red-screen in dev.
  //
  // EXCEPTION: when the tutorial is mid-flight we hold position. The
  // onboarding tour steps the user through Community as one of its
  // beats; bouncing them to /join here would interrupt the tour, drop
  // them on a different route, and stop the tutorial state machine.
  // We render an inline empty state instead.
  const { isActive: isTutorialActive } = useTutorial();
  // No gym yet → show the animated in-page "Join a gym" gate (The Locker Room)
  // instead of bouncing to /join. It owns the gym-code entry + live preview +
  // join flow inline. During the onboarding tutorial we hold the existing
  // inline beat below so the tour isn't interrupted.
  const showJoinGate = !gymsLoading && !primaryGym && !isTutorialActive;
  if (showJoinGate) {
    return <JoinGymGate />;
  }

  return (
    /* The previous outer wrapper added its OWN
       `paddingTop: env(safe-area-inset-top)` on top of the
       ProtectedAppLayout that already applies the safe-area inset,
       that stacking pushed the "Your / Community" title ~50px lower
       than the matching titles on Camp + Nutrition. Removed the
       safe-area wrapper and the `pt-2` on the motion.div; the page
       now starts at the same vertical position as its sibling tabs.
       Fragment wraps motion.div + the sheets so we keep them as
       siblings without re-adding an outer div. */
    <>
    <div className="min-h-screen w-full bg-background text-foreground">
      <AnimatePresence mode="wait" initial={false}>
        {!revealed ? (
          <motion.div
            key="community-loader"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18 }}
            className="min-h-[60vh] flex items-center justify-center"
          >
            <div
              className="h-7 w-7 rounded-full border-2 border-muted-foreground/20 border-t-primary animate-spin"
              aria-label="Loading community"
            />
          </motion.div>
        ) : (
          <StaggerContainer key="community-content">
            {/* Page header */}
            <StaggerItem>
              <header className="px-5 py-3 sm:p-5 md:p-6 pb-2">
                <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">Your</p>
                <h1 className="text-title font-semibold leading-tight">Community</h1>
              </header>
            </StaggerItem>

            {/* Announcements, coach broadcasts + fight offers across every
                gym the user belongs to. Scoped here (not to the active gym)
                because announcements are user-level: a fight offer from any
                coach should always surface. Renders nothing when empty. */}
            {gyms.length > 0 && (
              <StaggerItem className="px-5 pb-2">
                <AnnouncementsSection gymIds={gyms.map((g) => g.gym_id)} />
              </StaggerItem>
            )}

            {/* Gym header + multi-gym switch pill */}
            {primaryGym && (
              <StaggerItem>
                <GymHeader
                  gymId={primaryGym.gym_id as Id<"gyms">}
                  gymName={primaryGym.gym_name}
                  logoUrl={primaryGym.gym_logo_url}
                  memberCount={null}
                  onInviteClick={() => navigate("/my-gym")}
                  onActivityClick={() => setActivityOpen(true)}
                  onProfileOpen={() => setProfileSheetOpen(true)}
                />
                {/* Switcher affordance, shown only when the user belongs to
                    multiple gyms. Sits as a discreet pill under the header so
                    the header tap still opens the gym profile sheet (with
                    share-data + leave-gym surfaces), and the pill provides a
                    separate path to swap between gyms. */}
                {isMultiGym && (
                  <button
                    type="button"
                    onClick={() => setSwitcherOpen(true)}
                    className="mx-5 mb-2 inline-flex items-center gap-1 rounded-full bg-muted/40 border border-border/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground active:scale-[0.98] transition-transform"
                    aria-label="Switch gym"
                  >
                    Switch gym
                    <ChevronDown className="h-3 w-3" />
                  </button>
                )}
              </StaggerItem>
            )}

            {/* Feed | Leaderboard segmented tabs. Only shown once the gym
                resolves (the leaderboard needs a gymId). Sits between the gym
                header and the content so the page reads as two clean sections. */}
            {gymId && (
              <StaggerItem className="px-5 pb-1">
                <div className="grid grid-cols-2 gap-1 rounded-full bg-card/50 p-1 ring-1 ring-border/40">
                  {(["feed", "leaderboard"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setCommunityTab(t)}
                      className={`relative rounded-full py-2 text-[13px] font-semibold capitalize transition ${
                        communityTab === t ? "text-primary-foreground" : "text-muted-foreground active:text-foreground"
                      }`}
                    >
                      {communityTab === t && (
                        <motion.span
                          layoutId="communityTabPill"
                          className="absolute inset-0 rounded-full bg-primary"
                          transition={{ type: "spring", stiffness: 400, damping: 32 }}
                        />
                      )}
                      <span className="relative z-10 inline-flex items-center justify-center">
                        {t === "feed" ? "Feed" : "Leaderboard"}
                      </span>
                    </button>
                  ))}
                </div>
              </StaggerItem>
            )}

            {/* Content area, branches on member-count threshold + load state.
                Wrapped in AnimatePresence so the swap between the feed and
                the "all caught up" empty state cross-fades smoothly when the
                user swipes the last polaroid (or when posts refill).

                Hidden while the Leaderboard tab is active (gymId present), so
                the deck + its feed subscription stays mounted but off-screen.

                mode="popLayout" (not "wait") so the outgoing feed and incoming
                empty state animate CONCURRENTLY, a true cross-fade. "wait" held
                the new state out until the old one finished its exit, leaving a
                ~240ms dead gap that read as a flash right before "all caught up". */}
            {(!gymId || communityTab === "feed") && (
            <StaggerItem>
              <main className={`px-5 pt-2 min-h-[460px] ${gymId ? "" : "pb-20 md:pb-8"}`}>
                <AnimatePresence mode="popLayout" initial={false}>
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
                              : // "Caught up" (every post seen, posts exist but
                                // effectivePosts is empty) is NOT a page-level
                                // branch swap anymore. It stays in "feed" and the
                                // feed section reveals the caught-up panel in
                                // place, so the last card flies off and the panel
                                // rises in as ONE continuous motion (matching the
                                // smooth multi-card promotion) instead of an
                                // abrupt sibling swap. Only a truly empty gym
                                // (posts.length === 0, handled above) uses the
                                // page-level EmptyFeed branch.
                                "feed";

                    if (branch === "loading") {
                      // Neutral loader instead of the polaroid-shaped skeleton,
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
                          // Near-instant exit so `mode="wait"` hands off to the feed
                          // the moment posts arrive, otherwise the spinner's fade-out
                          // inserts a ~180ms dead gap before the polaroid drop-in can
                          // even mount. The enter fade stays soft via `transition`.
                          exit={{ opacity: 0, transition: { duration: 0.05 } }}
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
                          // Pure in-place cross-fade (no y-slide) so the "all
                          // caught up" state appears exactly where the deck was,
                          // concurrently with the feed fading out, no jump. A
                          // subtle scale-in gives the reveal intent.
                          initial={{ opacity: 0, scale: 0.96 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                        >
                          <EmptyFeed
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
                        // Opacity-only exit (was scale: 0.98). The zoom-out read as
                        // a flash/refresh as the last card cleared; a flat fade
                        // cross-fades cleanly into the empty state.
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
                      >
                        <CommunityFeedSection
                          posts={effectivePosts}
                          status={status}
                          loadMore={loadMore}
                          topIndex={0}
                          advance={handleAdvance}
                          onOpenProfile={handleOpenProfile}
                          onOpenComments={openComments}
                          onPostSwiped={handlePostSwiped}
                          onPostClick={handlePostClick}
                          onLogSession={() => navigate("/training-calendar")}
                          seenCount={dismissedIds.size}
                          totalCount={posts.length}
                        />
                      </motion.div>
                    );
                  })()}
                </AnimatePresence>
              </main>
            </StaggerItem>
            )}

            {/* Weekly leaderboard, now behind the Leaderboard tab. Mounted
                ONLY when the tab is selected (and gymId resolved), so the
                `gymLeaderboard.weekly` subscription never fires while the user
                is on the feed. Carries the bottom-nav clearance (pb-20). */}
            {gymId && communityTab === "leaderboard" && (
              <StaggerItem className="px-5 pb-20 md:pb-8">
                <section className="mt-3" data-tutorial="community-leaderboard">
                  <LeaderboardSection gymId={gymId} viewer="athlete" />
                </section>
              </StaggerItem>
            )}
          </StaggerContainer>
        )}
      </AnimatePresence>
    </div>

      {/* Activity sheet, opens from the bell in the header. */}
      <ActivitySheet
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        gymId={gymId}
        onOpenComments={(postId) => openComments(postId, 0)}
      />

      {/* Gym profile sheet, opens from the GymHeader title cluster. */}
      <GymProfileSheet
        gymId={gymId}
        open={profileSheetOpen}
        onOpenChange={setProfileSheetOpen}
      />

      {/* Comments sheet, mounted at page root, gated on postId. */}
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

      {/* Gym switcher sheet, multi-gym athletes pick which gym scopes
          the feed / leaderboard / profile sheet. Selection persists via
          localStorage so a reload keeps them on the last-active gym. */}
      <GymSwitcherSheet
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        gyms={gyms}
        activeGymId={primaryGym?.gym_id ?? null}
        onSelect={handleSelectGym}
      />
    </>
  );
}

/* ─── Gym switcher sheet ───
 *
 * Bottom sheet listing every gym the viewer belongs to. Each row is a
 * full-width button (logo + name + member count subtitle). The active
 * gym is marked with a check and a faint background so the viewer can
 * see which selection is current at a glance. Mounted at the page root
 * so its animation lifecycle is independent of the feed below.
 */
function GymSwitcherSheet({
  open,
  onOpenChange,
  gyms,
  activeGymId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gyms: MyGymRow[];
  activeGymId: string | null;
  onSelect: (gym: MyGymRow) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl border-border/40 bg-background"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-[17px]">Switch gym</SheetTitle>
        </SheetHeader>
        <div className="mt-3 space-y-1.5">
          {gyms.map((gym) => {
            const isActive = gym.gym_id === activeGymId;
            return (
              <button
                key={gym.member_id}
                type="button"
                onClick={() => onSelect(gym)}
                className={`w-full min-h-[60px] flex items-center gap-3 px-3 py-2.5 rounded-xs text-left active:scale-[0.99] transition-all ${
                  isActive
                    ? "bg-primary/10 border border-primary/30"
                    : "bg-card/60 border border-border/40 active:bg-muted/40"
                }`}
              >
                <GymLogoAvatar
                  logoUrl={gym.gym_logo_url}
                  name={gym.gym_name}
                  size={40}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold leading-tight truncate">
                    {gym.gym_name}
                  </p>
                  {gym.gym_location && (
                    <p className="text-[12px] text-muted-foreground mt-0.5 truncate">
                      {gym.gym_location}
                    </p>
                  )}
                </div>
                {isActive && (
                  <Check className="h-4 w-4 text-primary shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ─── Empty feed state ─── */

interface EmptyFeedProps {
  onLogSessionClick: () => void;
}

function EmptyFeed({ onLogSessionClick }: EmptyFeedProps) {
  const prefersReduced = useReducedMotion();
  return (
    <section className="mt-8 text-center max-w-sm mx-auto">
      {/* The wizard pops in (spring) as the deck hands off, then gently bobs so
          the caught-up screen feels alive instead of a static dead-end. */}
      <motion.img
        src={wizardMascot}
        alt=""
        draggable={false}
        className="mx-auto h-24 w-24 object-contain pointer-events-none select-none"
        style={{ willChange: "transform" }}
        initial={prefersReduced ? false : { opacity: 0, scale: 0.6 }}
        animate={
          prefersReduced
            ? { opacity: 1 }
            : { opacity: 1, scale: 1, y: [0, -6, 0] }
        }
        transition={
          prefersReduced
            ? { duration: 0 }
            : {
                opacity: { duration: 0.35, delay: 0.1 },
                scale: { duration: 0.5, delay: 0.1, ease: [0.34, 1.56, 0.64, 1] },
                y: { duration: 3, repeat: Infinity, ease: "easeInOut", delay: 0.6 },
              }
        }
      />
      <h2 className="mt-3 text-[22px] font-bold tracking-tight">You're all caught up</h2>
      <p className="text-[13px] text-muted-foreground mt-1.5 max-w-[28ch] mx-auto leading-snug">
        Nothing new on the mat right now.
      </p>

      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={onLogSessionClick}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground h-10 px-5 text-[14px] font-semibold active:scale-[0.97] transition-transform"
        >
          Log a session
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}

/* ─── "X of N trained today" banner ───
 *
 * Subtle motivational chip above the polaroid stack. Surfaces when at
 * least half of the active members have posted today and the gym isn't
 * already complete. Phrasing flips when the viewer themselves has
 * already trained today (positive reinforcement) vs. hasn't (close-the-
 * circle nudge).
 *
 * Reads the same `getMemberCount` query the GymHeader uses, no extra
 * round-trip per render. Hidden when the query hasn't loaded or when
 * the gym is too small/quiet to make the count motivational.
 */
function TrainedTodayBanner({ gymId }: { gymId: Id<"gyms"> | null }) {
  type CountsShape = {
    memberCount: number;
    activePosters7d: number;
    activePostersToday?: number;
    viewerPostedToday?: boolean;
  } | null;
  const counts = useQuery(
    api.gyms.getMemberCount,
    gymId ? { gymId } : "skip",
  ) as CountsShape | undefined;

  if (!counts) return null;
  const today = counts.activePostersToday ?? 0;
  const total = counts.memberCount ?? 0;
  // Solo-member gyms or zero-poster days don't get the banner,
  // motivational only when there's a real group dynamic.
  if (total < 2 || today === 0) return null;
  if (today >= total) return null; // everyone posted, no nudge needed
  const ratio = today / total;
  if (ratio < 0.5) return null;

  const youDid = counts.viewerPostedToday ?? false;
  return (
    <motion.div
      key="trained-today"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
      className="mb-2 flex items-center gap-2 rounded-2xl border border-primary/25 bg-primary/[0.07] px-3.5 py-2.5"
      role="status"
    >
      <span aria-hidden className="text-base leading-none">🔥</span>
      <p className="text-[12.5px] leading-snug text-foreground/85">
        <span className="font-semibold text-foreground">
          {today} of {total}
        </span>{" "}
        teammates trained today
        {youDid ? ". Keep it going." : ". Close the circle."}
      </p>
    </motion.div>
  );
}

/* ─── Polaroid + info card composition ─── */

interface CommunityFeedSectionProps {
  posts: FeedPost[];
  status: ReturnType<typeof useGymFeed>["status"];
  loadMore: () => void;
  topIndex: number;
  advance: () => void;
  onOpenProfile: (userId: Id<"users">) => void;
  onOpenComments: (postId: Id<"session_media">, count: number) => void;
  onPostSwiped: (postId: Id<"session_media">) => void;
  onPostClick: () => void;
  /** Fires the "Log a session" CTA on the in-place caught-up panel. */
  onLogSession: () => void;
  /** Counter pill source: dismissed-so-far + full feed length. */
  seenCount: number;
  totalCount: number;
}

const CommunityFeedSection = React.memo(function CommunityFeedSection({
  posts,
  status,
  loadMore,
  topIndex,
  advance,
  onOpenProfile,
  onOpenComments,
  onPostSwiped,
  onPostClick,
  onLogSession,
  seenCount,
  totalCount,
}: CommunityFeedSectionProps) {
  const topPost = posts[topIndex];

  // Stabilize the server snapshot passed into useFeedEngagement so the
  // hook's sync effects don't fire on every parent render, they should
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

  // Reaction + comment handlers for the below-photo info block. The
  // reaction bar + comment input now live in SessionInfoCard (keyed to
  // topPost.id), so they always act on the current top post, no postId
  // routing needed. `toggleReaction` runs the same haptic + error path as
  // a like-toggle. `key` is an ASCII slug (heart/fire/muscle/praise/clap).
  const addCommentMut = useMutation(api.feedSocial.addComment);
  const handleReact = useCallback(
    (key: string) => topEngagement.toggleReaction(key),
    [topEngagement],
  );
  const handleSubmitComment = useCallback(
    async (text: string) => {
      if (!topPost) return;
      try {
        await addCommentMut({ postId: topPost.id, body: text });
        topEngagement.incrementCommentCount();
        // No comment text in props — privacy rule.
        track(EVENTS.POST_ENGAGED, { action: "comment", post_id: topPost.id });
      } catch (err) {
        logger.warn("addComment failed", { err: String(err) });
      }
    },
    [topPost, addCommentMut, topEngagement],
  );

  // Once every post has been seen `posts` (the parent's effectivePosts) is
  // empty. We reveal the caught-up panel HERE, inside the persistent feed
  // section, rather than letting the page-level branch swap the whole feed
  // out. Because this swap lives in the same container the deck does, the
  // last card's fly-off and the panel's entrance read as one continuous
  // motion, the same trick that makes multi-card promotion feel smooth.
  const caughtUp = posts.length === 0;

  return (
    <div className="mt-2">
      <AnimatePresence mode="popLayout" initial={false}>
        {caughtUp ? (
          <motion.div
            key="caught-up"
            // Rise + fade + a whisper of scale, with a short delay so the
            // last card has clearly flown off the top before the panel
            // settles into its place. Soft ease-out for the "gentle" landing.
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.16 } }}
            transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
          >
            <EmptyFeed onLogSessionClick={onLogSession} />
          </motion.div>
        ) : (
          <motion.div
            key="deck"
            // Clean fade as the deck hands off to the caught-up panel. The
            // last card itself already animated off inside PolaroidStack, so
            // this just dissolves the now-empty deck footprint.
            exit={{ opacity: 0, transition: { duration: 0.22, ease: "easeOut" } }}
          >
            {/* Tight bottom buffer, the square deck (312px) reveals the next
                card in place, so there's no y-overshoot to clear and the info
                block can sit close beneath, putting comments on first glance. */}
            <div className="mt-4 mb-4" data-tutorial="community-photo-stack">
              <PolaroidStack
                posts={posts}
                status={status}
                loadMore={loadMore}
                topIndex={topIndex}
                advance={advance}
                onOpenProfile={onOpenProfile}
                onSwipeCommit={onPostSwiped}
                onPostClick={onPostClick}
                liked={topEngagement.liked}
                onToggleLike={topEngagement.toggleLike}
                likeBurstKey={topEngagement.burstKey}
                seenCount={seenCount}
                totalCount={totalCount}
              />
            </div>

            {/* Crossfade the info block as the deck advances so its content
                glides between posts instead of snapping. Keyed to the top post id;
                mode="popLayout" keeps the height stable through the swap. */}
            <AnimatePresence mode="popLayout" initial={false}>
              {topPost && (
                <motion.div
                  key={topPost.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                >
                  <SessionInfoCard
                    post={topPost}
                    engagement={topEngagement}
                    onCommentTap={onOpenComments}
                    onProfileTap={onOpenProfile}
                    onReact={handleReact}
                    onSubmitComment={handleSubmitComment}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
