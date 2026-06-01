/**
 * Paginated gym feed reader for the Corner (Community) page.
 *
 * Wraps Convex's `usePaginatedQuery` against `api.gymFeed.listFeed` and
 * surfaces a normalised `{ results, status, loadMore }` triple that the
 * polaroid stack consumes. The hook is intentionally thin — server-side
 * privacy filtering, author-dedupe, and thumb hydration all live in the
 * existing Convex query, so this layer only:
 *
 *   1. Defers the query until `gymId` resolves (so cold-launch doesn't
 *      fire a request before the user's primary gym is known).
 *   2. Caps `loadMore` at 8 docs per page (the polaroid stack only ever
 *      shows the top 3 cards — fetching 12 fresh rows at a time is more
 *      than enough headroom while keeping doc-read counts low).
 *
 * Why not cache via `AIPersistence`? The feed is reactive — every like /
 * comment / new post that lands on the gym pushes a fresh snapshot down
 * the websocket. Caching a stale page would force a manual invalidate
 * step on every mutation. Convex's own subscription is already faster
 * and cheaper than disk I/O for this access pattern.
 */
import { useMemo, useRef } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const INITIAL_PAGE = 6;
const LOAD_MORE_PAGE = 8;

/**
 * Single post shape returned by `gymFeed.listFeed`. We re-export it here
 * (rather than importing the inferred Convex return type) so consumers
 * downstream don't pull the whole API surface into their files.
 *
 * Field nullability mirrors the server contract exactly — `caption` and
 * `session` can be null for posts created outside the session-logging
 * flow, and `url` is null when Convex Storage hasn't finished hydrating
 * the upload yet.
 */
export interface FeedPost {
  id: Id<"session_media">;
  createdAt: number;
  kind: "photo" | "video";
  url: string | null;
  caption: string | null;
  author: {
    userId: Id<"users">;
    displayName: string;
    avatarUrl: string | null;
    /**
     * Consecutive-day post streak for the author, capped at 365. Drives
     * the flame ring on the polaroid avatar + SessionInfoCard. 0 = no
     * ring; 7+ triggers the visual. Server-computed in
     * `computeAuthorStreak`.
     */
    streakDays?: number;
  };
  session: {
    id: Id<"training_sessions">;
    date: string;
    sessionType: string;
    rpe: number;
    durationMinutes: number;
  } | null;
  likeCount: number;
  commentCount: number;
  viewerLiked: boolean;
  /** Optional LQIP — present when the backfill action has run. */
  thumbDataUrl?: string | null;
  /** 256-px thumbnail URL for stack positions 1/2 (lower bandwidth). */
  thumbUrl?: string | null;
  width?: number | null;
  height?: number | null;
}

export type FeedStatus =
  | "LoadingFirstPage"
  | "CanLoadMore"
  | "LoadingMore"
  | "Exhausted";

export interface UseGymFeedResult {
  results: FeedPost[];
  status: FeedStatus;
  /** No-arg `loadMore` — fetches the next 8 docs. Safe to call multiple
   *  times; Convex de-dupes in-flight requests. */
  loadMore: () => void;
}

export function useGymFeed(gymId: Id<"gyms"> | null): UseGymFeedResult {
  const { results, status, loadMore } = usePaginatedQuery(
    api.gymFeed.listFeed,
    gymId ? { gymId } : "skip",
    { initialNumItems: INITIAL_PAGE },
  );

  // Cast the loadMore to a no-arg wrapper — `usePaginatedQuery` exposes
  // `(numItems: number) => void`, but every caller of this hook should
  // request the same page size for consistent prefetch math in the
  // polaroid stack.
  const loadMoreBounded = () => loadMore(LOAD_MORE_PAGE);

  // Per-postId URL cache — pins the first observed signed Storage URL
  // for each post so that Convex's per-query URL regeneration (every
  // refetch after a mutation re-signs Storage URLs) doesn't churn the
  // <img src>. Without this, every `markPostViewed` mutation would
  // cause the top card's image to flash black during the browser
  // re-fetch round-trip. Survives across renders via useRef; never
  // shrinks (feeds are bounded — typical session sees < 50 posts).
  const urlCacheRef = useRef<
    Map<string, { url: string | null; thumbUrl: string | null }>
  >(new Map());

  const stableResults = useMemo<FeedPost[]>(() => {
    const cache = urlCacheRef.current;
    const raw = (results ?? []) as unknown as FeedPost[];
    return raw.map((p) => {
      const idStr = String(p.id);
      const cached = cache.get(idStr);
      // Prefer the fresh URL if non-null, else fall back to cache.
      const url = p.url ?? cached?.url ?? null;
      const thumbUrl = p.thumbUrl ?? cached?.thumbUrl ?? null;
      if (url) {
        const prev = cache.get(idStr);
        // Lock in the first working URL we observe. Once cached, we
        // keep using it forever — even when Convex re-signs the URL on
        // the next query refetch. Only update if we never had a URL
        // before (prev?.url === null / not set).
        if (!prev || prev.url === null) {
          cache.set(idStr, { url, thumbUrl });
        } else if (!prev.thumbUrl && thumbUrl) {
          // Lazily backfill thumbUrl if it arrives later (server-side
          // backfill action populates this after the initial post).
          cache.set(idStr, { ...prev, thumbUrl });
        }
      }
      const pinned = cache.get(idStr);
      return {
        ...p,
        url: pinned?.url ?? url,
        thumbUrl: pinned?.thumbUrl ?? thumbUrl,
      } as FeedPost;
    });
  }, [results]);

  // The query's inferred result type matches FeedPost — but we cast at
  // the boundary to keep the public surface stable if the server adds
  // optional fields later.
  return {
    results: stableResults,
    status: status as FeedStatus,
    loadMore: loadMoreBounded,
  };
}
