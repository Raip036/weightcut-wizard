import { useEffect, useMemo, useRef } from "react";
import { Play } from "lucide-react";
import { disciplineToken, disciplineLabel } from "@/lib/coachColors";

/** Minimal media shape the masonry needs. The page's richer `Tile` is
 *  structurally assignable to this. */
export interface MasonryTile {
  id: string;
  kind: "photo" | "video";
  /** Always an IMAGE or null (server guarantees it; never a video file). */
  thumbUrl: string | null;
  /** Inline LQIP for instant placeholder paint. */
  thumbDataUrl: string | null;
  width: number | null;
  height: number | null;
  sessionType: string | null;
}

interface TrainingGalleryMasonryProps {
  tiles: MasonryTile[];
  onOpen: (id: string) => void;
  /** Called when the user nears the end; the parent decides whether to load more. */
  onEndReached: () => void;
  loadingMore: boolean;
}

/** Relative height (for unit column width) used to greedily balance columns. */
function aspectHeight(t: MasonryTile): number {
  if (t.width && t.height && t.width > 0) return t.height / t.width;
  return 4 / 3; // sensible default when dimensions are unknown
}

function Tile({ t, onOpen }: { t: MasonryTile; onOpen: (id: string) => void }) {
  const aspect = t.width && t.height ? `${t.width} / ${t.height}` : "3 / 4";
  return (
    <button
      type="button"
      onClick={() => onOpen(t.id)}
      className="card-press relative block w-full overflow-hidden rounded-2xl bg-muted/20"
      style={{
        aspectRatio: aspect,
        backgroundImage: t.thumbDataUrl ? `url(${t.thumbDataUrl})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
      aria-label="Open training clip"
    >
      {/* thumbUrl is guaranteed an image (or null) by the server. */}
      {t.thumbUrl && (
        <img
          src={t.thumbUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}

      {t.kind === "video" && (
        <span className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
          <Play className="h-3 w-3 fill-white text-white" />
        </span>
      )}

      {t.sessionType && (
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 via-black/15 to-transparent p-2.5">
          <span className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: `hsl(var(${disciplineToken(t.sessionType)}))` }}
            />
            <span className="text-[11px] font-semibold text-white">
              {disciplineLabel(t.sessionType)}
            </span>
          </span>
        </div>
      )}
    </button>
  );
}

/**
 * Pinterest-style 2-column masonry of training media. Columns are distributed
 * in JS (each tile appended to the currently-shorter column) so adding a page
 * NEVER reflows the tiles already on screen. Tiles load THUMBNAILS, lock their
 * aspect box from width/height, and paint an inline LQIP instantly; full-res
 * is only fetched later in the lightbox. Infinite scroll fetches the next page
 * one at a time near the end.
 */
export function TrainingGalleryMasonry({
  tiles,
  onOpen,
  onEndReached,
  loadingMore,
}: TrainingGalleryMasonryProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Latest values for the observer callback without re-subscribing each render.
  const cbRef = useRef(onEndReached);
  cbRef.current = onEndReached;
  const loadingRef = useRef(loadingMore);
  loadingRef.current = loadingMore;

  // Greedy shortest-column distribution. Stable as the list grows: existing
  // tiles keep their column + position, new tiles only ever append.
  const columns = useMemo(() => {
    const cols: MasonryTile[][] = [[], []];
    const heights = [0, 0];
    for (const t of tiles) {
      const target = heights[0] <= heights[1] ? 0 : 1;
      cols[target].push(t);
      heights[target] += aspectHeight(t);
    }
    return cols;
  }, [tiles]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        // Only ask for one page at a time; the parent also guards on its
        // pagination status, and Convex's loadMore is idempotent.
        if (entries[0]?.isIntersecting && !loadingRef.current) cbRef.current();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="px-3 pt-3">
      <div className="flex gap-2">
        {columns.map((col, ci) => (
          <div key={ci} className="flex flex-1 flex-col gap-2">
            {col.map((t) => (
              <Tile key={t.id} t={t} onOpen={onOpen} />
            ))}
          </div>
        ))}
      </div>

      {/* Infinite-scroll sentinel + loader */}
      <div ref={sentinelRef} className="h-8" />
      {loadingMore && (
        <div className="flex justify-center py-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-primary" />
        </div>
      )}
    </div>
  );
}
