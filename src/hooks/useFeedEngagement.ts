/**
 * Optimistic engagement state for one feed post.
 *
 * The Convex `useQuery(listFeed)` returns server-authoritative
 * `viewerLiked`, `likeCount`, `commentCount`. This hook overlays an
 * optimistic local copy on top so taps feel instant — local state flips
 * synchronously, the mutation runs in parallel, and on rejection we
 * roll back the local change and surface a toast.
 *
 * Why this lives in a hook (not the component): the same optimistic
 * rules need to apply whether the like was triggered by the rail heart
 * or a double-tap on the post body. Centralising prevents two slightly-
 * different rollback paths from drifting.
 */
import { useCallback, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";

interface ServerSnapshot {
  viewerLiked: boolean;
  likeCount: number;
  commentCount: number;
}

export interface UseFeedEngagementResult {
  liked: boolean;
  likeCount: number;
  commentCount: number;
  /** Increments each time a like FIRES (false→true). Drives the burst overlay. */
  burstKey: number;
  /** Tap the rail heart — toggles. Always optimistic, rolls back on error. */
  toggleLike: () => void;
  /** Double-tap on the post body — like-only, never un-likes. No-op if already liked. */
  doubleTapLike: () => void;
  /**
   * Tap a reaction in the bar — toggles. Fires the Convex mutation
   * without local optimistic state because the bar reads its counts off
   * the live `listFeed` snapshot; the round-trip is typically <100ms and
   * the haptic confirms the tap landed. `key` is an ASCII slug (`heart`
   * / `fire` / `muscle` / `praise` / `clap`) — see `EmojiReactionBar`
   * for the slug → emoji mapping.
   */
  toggleReaction: (key: string) => void;
  /**
   * Optimistic per-reaction override map (slug → isActive). An entry means
   * "the viewer just toggled this reaction and the server snapshot hasn't
   * caught up yet"; no entry means "defer to the server's
   * `viewerReactions`". Reset whenever the server snapshot reconciles.
   */
  optimisticReactions: Record<string, boolean>;
  /**
   * Optimistic reaction toggle. Flips `key` against the supplied
   * `currentlyActive` state, paints the override instantly, fires the
   * Convex mutation, and rolls the override back on failure — mirroring
   * the `toggleLike` rollback pattern. The caller owns the truth of
   * `currentlyActive` (it has the server `viewerReactions` + this
   * overlay), since the hook never receives the server reaction list.
   */
  toggleReactionOptimistic: (key: string, currentlyActive: boolean) => void;
  /**
   * Merge the server's `viewerReactions` with the optimistic overlay into
   * the effective set of slugs the viewer is currently reacting with.
   */
  resolveViewerReactions: (serverReactions: string[]) => string[];
  /** Called by CommentsSheet after a successful comment add. */
  incrementCommentCount: () => void;
  decrementCommentCount: () => void;
}

export function useFeedEngagement(
  postId: Id<"session_media">,
  server: ServerSnapshot,
): UseFeedEngagementResult {
  const { toast } = useToast();
  const toggleLikeMut = useMutation(api.feedSocial.toggleLike);
  const toggleReactionMut = useMutation(api.gymFeed.toggleReaction);

  // Mirror server state into local optimistic state. We re-sync whenever
  // the SERVER snapshot changes (e.g. another user liked the post, or
  // our own mutation resolved). The mirror lets us flip instantly on
  // tap without waiting for the round-trip.
  const [liked, setLiked] = useState(server.viewerLiked);
  const [likeCount, setLikeCount] = useState(server.likeCount);
  const [commentCount, setCommentCount] = useState(server.commentCount);
  const [burstKey, setBurstKey] = useState(0);
  // Optimistic reaction overlay: slug → isActive override on top of the
  // server's `viewerReactions`. Lets a tap on the bar flip the "you
  // reacted" ring instantly instead of waiting a feed round-trip.
  const [reactionOverrides, setReactionOverrides] = useState<
    Record<string, boolean>
  >({});

  // Single sync effect — collapses three separate re-renders into one
  // when the upstream server snapshot changes. Caller is expected to
  // memoize the `server` object so this fires only on actual value
  // changes, not on every parent render. A fresh snapshot means the
  // server has caught up, so we drop the optimistic reaction overlay and
  // trust the authoritative `viewerReactions` from here on.
  useEffect(() => {
    setLiked(server.viewerLiked);
    setLikeCount(server.likeCount);
    setCommentCount(server.commentCount);
    setReactionOverrides({});
  }, [server.viewerLiked, server.likeCount, server.commentCount]);

  // When the post under us swaps (deck advance) the overlay must not leak
  // onto the next post, whose snapshot values may coincidentally match.
  useEffect(() => {
    setReactionOverrides({});
  }, [postId]);

  const toggleLike = useCallback(() => {
    // Capture pre-tap state so we can roll back.
    const wasLiked = liked;
    const prevCount = likeCount;
    const nextLiked = !wasLiked;

    setLiked(nextLiked);
    setLikeCount(nextLiked ? prevCount + 1 : Math.max(0, prevCount - 1));
    if (nextLiked) {
      setBurstKey((k) => k + 1);
      triggerHaptic(ImpactStyle.Medium);
    }

    toggleLikeMut({ postId }).catch(() => {
      // Roll back and toast. Don't rollback the burst — it was an
      // animation, not a state, and re-triggering it on undo would be
      // visually noisy.
      setLiked(wasLiked);
      setLikeCount(prevCount);
      toast({ title: "Couldn't update like", variant: "destructive" });
    });
  }, [liked, likeCount, postId, toggleLikeMut, toast]);

  const doubleTapLike = useCallback(() => {
    if (liked) {
      // Spec rule: double-tap NEVER un-likes — replaying the burst on an
      // already-liked post would be confusing. Show the burst as
      // feedback, skip the mutation entirely.
      setBurstKey((k) => k + 1);
      triggerHaptic(ImpactStyle.Light);
      return;
    }
    // Same path as the rail tap.
    toggleLike();
  }, [liked, toggleLike]);

  const incrementCommentCount = useCallback(() => {
    setCommentCount((c) => c + 1);
  }, []);
  const decrementCommentCount = useCallback(() => {
    setCommentCount((c) => Math.max(0, c - 1));
  }, []);

  // Reactions piggy-back on the server's cached `reactionCounts` map,
  // which the next reactive `listFeed` tick will repaint. We don't
  // mirror the toggle locally — the round-trip is short and the haptic
  // already confirms the tap. On rejection we surface a toast. `key` is
  // the ASCII slug (see `EmojiReactionBar` for the slug ↔ emoji map).
  const toggleReaction = useCallback(
    (key: string) => {
      triggerHaptic(ImpactStyle.Light);
      toggleReactionMut({ postId, key }).catch(() => {
        toast({ title: "Couldn't update reaction", variant: "destructive" });
      });
    },
    [postId, toggleReactionMut, toast],
  );

  // Optimistic variant: paints the override before the mutation resolves
  // and rolls it back on failure (same shape as `toggleLike`). The caller
  // hands in the current effective active state because the hook never
  // receives the server `viewerReactions` list.
  const toggleReactionOptimistic = useCallback(
    (key: string, currentlyActive: boolean) => {
      const nextActive = !currentlyActive;
      setReactionOverrides((prev) => ({ ...prev, [key]: nextActive }));
      triggerHaptic(ImpactStyle.Light);
      toggleReactionMut({ postId, key }).catch(() => {
        // Roll back this key to its pre-tap state and surface a toast.
        setReactionOverrides((prev) => ({ ...prev, [key]: currentlyActive }));
        toast({ title: "Couldn't update reaction", variant: "destructive" });
      });
    },
    [postId, toggleReactionMut, toast],
  );

  const resolveViewerReactions = useCallback(
    (serverReactions: string[]) => {
      const set = new Set(serverReactions);
      for (const key in reactionOverrides) {
        if (reactionOverrides[key]) set.add(key);
        else set.delete(key);
      }
      return Array.from(set);
    },
    [reactionOverrides],
  );

  return {
    liked,
    likeCount,
    commentCount,
    burstKey,
    toggleLike,
    doubleTapLike,
    toggleReaction,
    optimisticReactions: reactionOverrides,
    toggleReactionOptimistic,
    resolveViewerReactions,
    incrementCommentCount,
    decrementCommentCount,
  };
}
