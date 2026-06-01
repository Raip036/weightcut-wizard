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

  // Single sync effect — collapses three separate re-renders into one
  // when the upstream server snapshot changes. Caller is expected to
  // memoize the `server` object so this fires only on actual value
  // changes, not on every parent render.
  useEffect(() => {
    setLiked(server.viewerLiked);
    setLikeCount(server.likeCount);
    setCommentCount(server.commentCount);
  }, [server.viewerLiked, server.likeCount, server.commentCount]);

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

  return {
    liked,
    likeCount,
    commentCount,
    burstKey,
    toggleLike,
    doubleTapLike,
    toggleReaction,
    incrementCommentCount,
    decrementCommentCount,
  };
}
