/**
 * PostGrid: 3-column square grid of a single user's posts.
 *
 * Renders into the Profile page below the stats row. Each tile is a
 * shared-element source for the polaroid stack transition via framer
 * `layoutId` (`post-${id}-image`, same key the polaroid uses on the
 * Corner tab so the cross-page swap is "free").
 *
 * Performance notes:
 *  - Tiles use `loading="lazy"` so the browser defers off-screen image
 *    fetches automatically.
 *  - An `IntersectionObserver` on a sentinel `<div>` at the end of the
 *    grid triggers `onLoadMore` when ~one screen of tiles remains.
 *  - LQIP base64 thumb is rendered as the `<img src>` *until* the real
 *    URL loads. The `onLoad` handler swaps in the full thumb. This
 *    gives an instant first paint with a CSS `blur(8px)` decoration that
 *    fades out once the high-res image arrives.
 */
import { Lock } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useImageReady } from "@/hooks/useImageReady";
import type { ProfilePost } from "@/hooks/community/useProfilePosts";

interface PostGridProps {
  posts: ProfilePost[];
  loading?: boolean;
  onLoadMore?: () => void;
  canLoadMore?: boolean;
  /** Skeleton tile count when loading the first page. */
  skeletonCount?: number;
  /** Optional click handler: used by the parent to dispatch detail navs. */
  onTilePress?: (post: ProfilePost) => void;
}

/** Standalone tile so the LQIP/full-image swap state stays local. */
function PostTile({
  post,
  onPress,
}: {
  post: ProfilePost;
  onPress?: (post: ProfilePost) => void;
}) {
  // Prefer the 256px thumb URL, falling back to the full-resolution url.
  const src = post.thumbUrl ?? post.url ?? null;
  // Robust load state: resets on src change, resolves on error, and catches
  // already-cached images, so the LQIP fades out and the tile never freezes.
  const img = useImageReady(src);

  return (
    <button
      type="button"
      onClick={() => onPress?.(post)}
      className="relative block aspect-square overflow-hidden rounded-md bg-zinc-900 active:scale-[0.98] transition-transform"
      aria-label={post.caption ?? "Post"}
    >
      {/* LQIP layer: always renders if available; fades out under the real image. */}
      {post.thumbDataUrl && (
        <img
          src={post.thumbDataUrl}
          alt=""
          aria-hidden
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            // 8px blur emulates the BlurHash-style ramp; fades out when full thumb lands.
            "scale-110 [filter:blur(8px)]",
            img.ready ? "opacity-0" : "opacity-100",
          )}
          draggable={false}
        />
      )}

      {/* Real image: shared layoutId so the polaroid → grid transition is one element. */}
      {src && !img.errored ? (
        <motion.img
          ref={img.ref}
          layoutId={`post-${String(post._id)}-image`}
          src={src}
          alt={post.caption ?? ""}
          loading="lazy"
          decoding="async"
          onLoad={img.onLoad}
          onError={img.onError}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            img.ready ? "opacity-100" : "opacity-0",
          )}
          draggable={false}
        />
      ) : (
        // No src available: show a flat fallback so the grid still has a tile.
        <div className="absolute inset-0 bg-zinc-900" aria-hidden />
      )}

      {/* Privacy overlay: small but unmistakable. */}
      {post.visibility === "private" && (
        <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
          <Lock className="h-2.5 w-2.5 text-white" />
        </div>
      )}
    </button>
  );
}

/** Single skeleton tile: flat zinc square, shimmer applied via parent class. */
function SkeletonTile() {
  return (
    <div
      className="aspect-square animate-pulse rounded-md bg-zinc-800/60"
      aria-hidden
    />
  );
}

export function PostGrid({
  posts,
  loading = false,
  onLoadMore,
  canLoadMore = false,
  skeletonCount = 9,
  onTilePress,
}: PostGridProps) {
  // Sentinel for infinite scroll. The observer fires `onLoadMore` once
  // the user is within ~one screen of the bottom.
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Keep the most recent loader in a ref so the IntersectionObserver
  // callback doesn't need to re-bind every render; the observer setup
  // is itself expensive enough that thrashing it on every parent rerender
  // would be wasteful.
  const onLoadMoreRef = useRef(onLoadMore);
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  const setSentinel = useCallback((node: HTMLDivElement | null) => {
    sentinelRef.current = node;
  }, []);

  useEffect(() => {
    if (!canLoadMore || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onLoadMoreRef.current?.();
          }
        }
      },
      // Pre-fetch when sentinel enters viewport with one-screen margin.
      { rootMargin: "600px 0px", threshold: 0 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [canLoadMore]);

  // First-page-loading branch: skeleton-only grid so the page isn't blank.
  if (loading && posts.length === 0) {
    return (
      <div className="grid grid-cols-3 gap-px">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <SkeletonTile key={i} />
        ))}
      </div>
    );
  }

  // Empty-but-loaded branch: a calm "no posts yet" cell so the layout
  // doesn't pop in mid-scroll.
  if (!loading && posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm font-semibold text-white">No posts yet</p>
        <p className="mt-1 text-xs text-white/50">
          Photos from logged training sessions show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-px">
      {posts.map((post) => (
        <PostTile key={String(post._id)} post={post} onPress={onTilePress} />
      ))}

      {/* Infinite-scroll sentinel. Only mounted when there's more to fetch. */}
      {canLoadMore && (
        <div
          ref={setSentinel}
          className="col-span-3 h-1 w-full"
          aria-hidden
        />
      )}

      {/* Loading-more spinner row: shown only when actively fetching the next page. */}
      {loading && posts.length > 0 && (
        <div className="col-span-3 flex justify-center py-4 text-xs text-white/40">
          Loading…
        </div>
      )}
    </div>
  );
}
