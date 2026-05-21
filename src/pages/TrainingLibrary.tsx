/**
 * Training Library — chronological gallery of every photo + video the
 * user has attached to a logged training session.
 *
 * Layout (recommended in the brainstorm):
 *  - Sticky discipline chip row at the top: "All / BJJ / Boxing / ..."
 *    populated from the user's actual session_types so we never show a
 *    chip with zero clips behind it.
 *  - Vertical scroll of date-grouped square thumbnails (Apple Photos
 *    pattern). Each tile shows the discipline chip in the corner.
 *  - Tap any tile → MediaLightbox opens at that index, swipe horizontal
 *    to scrub through the rest, swipe down to dismiss.
 *
 * Shipped intentionally small — the brainstorm proposed a Stories reel,
 * search, and pinned shelf, all of which can stack on this page later
 * without a rewrite (the lightbox already supports start-index).
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ChevronLeft, ImageIcon, Play, Trash2 } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { triggerHapticSelection } from "@/lib/haptics";
import { MediaLightbox, type LightboxItem } from "@/components/training/MediaLightbox";
import { TinderMediaSwiper } from "@/components/training/TinderMediaSwiper";
import { DashboardSkeleton } from "@/components/ui/skeleton-loader";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Tile = {
  id: string;
  url: string | null;
  kind: "photo" | "video";
  caption: string | null;
  capturedAt: string;
  sessionType: string | null;
  sessionDate: string;
};

const ALL_FILTER = "all";

function monthLabel(iso: string): string {
  try {
    return format(parseISO(iso), "MMMM yyyy");
  } catch {
    return iso.slice(0, 7);
  }
}

function dayLabel(iso: string): string {
  try {
    return format(parseISO(iso), "EEE, MMM d");
  } catch {
    return iso;
  }
}

export default function TrainingLibrary() {
  const navigate = useNavigate();
  const { userId } = useUser();
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>(ALL_FILTER);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Tinder swipe mode toggle. The user can launch the throw-card swiper
  // from the header to "study" their library Tinder-style.
  const [swiperStart, setSwiperStart] = useState<number | null>(null);
  // Pending delete confirmation. Holds the tile id while the alert is
  // open so we can fire `removeSessionMedia` once the user confirms.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // listMyMediaLibrary now returns a paginated envelope `{ page, isDone,
  // continueCursor }` after the perf refactor. We only consume the first
  // page for now; the rest of this file iterates `tiles` so we unwrap to
  // keep the existing rendering code unchanged. Future enhancement: load
  // more on scroll via continueCursor.
  const mediaPage = useQuery(
    api.fight_camp.listMyMediaLibrary,
    userId ? { disciplineFilter: filter === ALL_FILTER ? undefined : filter } : "skip",
  ) as { page: Tile[]; isDone: boolean; continueCursor: string | null } | undefined;
  const tiles: Tile[] | undefined = mediaPage ? mediaPage.page : undefined;
  const disciplines = useQuery(
    api.fight_camp.listMediaDisciplines,
    userId ? {} : "skip",
  ) as string[] | undefined;
  const removeMediaMut = useMutation(api.fight_camp.removeSessionMedia);

  const handleDelete = async () => {
    if (!pendingDeleteId) return;
    setDeleting(true);
    try {
      await removeMediaMut({ mediaId: pendingDeleteId as Id<"session_media"> });
      triggerHapticSelection();
      // Close any open viewers if the deleted clip was the active one —
      // the lightbox / swiper are uncontrolled past their startIndex
      // prop, so we pop them rather than try to reindex.
      setLightboxIndex(null);
      setSwiperStart(null);
    } catch (err: any) {
      toast({
        title: "Couldn't delete",
        description: err?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setPendingDeleteId(null);
    }
  };

  const grouped = useMemo(() => {
    const out = new Map<string, Tile[]>();
    for (const t of tiles ?? []) {
      const key = monthLabel(t.capturedAt);
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push(t);
    }
    return out;
  }, [tiles]);

  const lightboxItems: LightboxItem[] = useMemo(
    () =>
      (tiles ?? []).map((t) => ({
        id: t.id,
        url: t.url,
        kind: t.kind,
        caption: t.caption,
        capturedAt: t.capturedAt,
        sessionType: t.sessionType,
      })),
    [tiles],
  );

  if (!userId) return <DashboardSkeleton />;
  if (tiles === undefined) return <DashboardSkeleton />;

  const isEmpty = tiles.length === 0;
  const filterChips = [ALL_FILTER, ...(disciplines ?? [])];

  return (
    <>
      <div
        className="animate-page-in min-h-screen bg-background text-foreground"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 bg-background/85 backdrop-blur border-b border-border/40"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
        >
          <div className="flex items-center gap-2 px-4 pb-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="-ml-2 p-2 rounded-xs active:bg-muted/40 transition-colors"
              aria-label="Back"
            >
              <ChevronLeft className="h-5 w-5 text-muted-foreground" />
            </button>
            <h1 className="text-[20px] font-bold tracking-tight">Library</h1>
            <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">
              {tiles.length} {tiles.length === 1 ? "clip" : "clips"}
            </span>
            {tiles.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  setSwiperStart(0);
                }}
                aria-label="Open swipe mode"
                className="h-8 px-3 rounded-full bg-primary text-primary-foreground text-[12px] font-semibold active:scale-[0.97] transition-transform"
              >
                Swipe
              </button>
            )}
          </div>

          {/* Discipline chips. Only render when the user has at least one
              clip — keeps the page clean for first-time visitors. */}
          {filterChips.length > 1 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide px-4 pb-2">
              {filterChips.map((d) => {
                const active = filter === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      triggerHapticSelection();
                      setFilter(d);
                    }}
                    className={`shrink-0 h-8 px-3 rounded-full text-[12px] font-semibold transition-all active:scale-[0.97] ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/40 text-muted-foreground"
                    }`}
                  >
                    {d === ALL_FILTER ? "All" : d}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Body */}
        {isEmpty ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto h-16 w-16 rounded-xs bg-muted/30 flex items-center justify-center mb-4">
              <ImageIcon className="h-7 w-7 text-muted-foreground/60" />
            </div>
            <h2 className="text-[16px] font-semibold mb-1">No clips yet</h2>
            <p className="text-[13px] text-muted-foreground leading-snug max-w-[280px] mx-auto">
              Add a photo or video when you log a training session and it'll
              show up here.
            </p>
            <button
              type="button"
              onClick={() => navigate("/training-calendar")}
              className="mt-5 h-10 px-4 rounded-xs bg-primary text-primary-foreground text-[13px] font-semibold active:scale-[0.98] transition-transform"
            >
              Open training calendar
            </button>
          </div>
        ) : (
          <div className="px-3 pt-3 space-y-5">
            {Array.from(grouped.entries()).map(([month, items]) => (
              <section key={month}>
                <h2 className="px-1 mb-2 text-[11px] uppercase tracking-widest text-muted-foreground/80 font-semibold">
                  {month}
                </h2>
                <div className="grid grid-cols-3 gap-1.5">
                  {items.map((t) => {
                    const idx = lightboxItems.findIndex((x) => x.id === t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          triggerHapticSelection();
                          setLightboxIndex(idx);
                        }}
                        className="relative aspect-square rounded-xs overflow-hidden bg-muted/40 active:scale-[0.98] transition-transform"
                        style={{
                          // Tiles below the fold get lazy-rendered by the
                          // browser via content-visibility — keeps the
                          // initial paint snappy on long libraries.
                          contentVisibility: "auto",
                          containIntrinsicSize: "120px 120px",
                        }}
                      >
                        {t.url ? (
                          t.kind === "video" ? (
                            <>
                              <video
                                src={t.url}
                                className="w-full h-full object-cover"
                                muted
                                playsInline
                                preload="metadata"
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/15">
                                <div className="h-7 w-7 rounded-full bg-black/55 backdrop-blur flex items-center justify-center">
                                  <Play className="h-3 w-3 text-white fill-white" />
                                </div>
                              </div>
                            </>
                          ) : (
                            <img
                              src={t.url}
                              alt={t.caption ?? "Training media"}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          )
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-muted-foreground/40">
                            <ImageIcon className="h-5 w-5" />
                          </div>
                        )}
                        {/* Bottom overlay — discipline + day, only on the
                            tile so the grid still reads as a gallery. */}
                        <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/55 to-transparent text-left">
                          <p className="text-[9px] font-semibold uppercase tracking-wider text-white/90 truncate">
                            {t.sessionType ?? "Session"}
                          </p>
                          <p className="text-[9px] text-white/70 tabular-nums">
                            {dayLabel(t.capturedAt)}
                          </p>
                        </div>
                        {/* Per-tile delete. Stops propagation so tapping
                            the icon doesn't also open the lightbox. The
                            confirm dialog at the bottom of the page
                            handles the actual mutation. */}
                        <span
                          role="button"
                          aria-label="Delete clip"
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerHapticSelection();
                            setPendingDeleteId(t.id);
                          }}
                          className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 backdrop-blur text-white flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <Trash2 className="h-3 w-3" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <MediaLightbox
        items={lightboxItems}
        startIndex={lightboxIndex ?? 0}
        open={lightboxIndex !== null}
        onClose={() => setLightboxIndex(null)}
      />

      {/* Tinder swiper — alternative viewer launched from the "Swipe"
          button in the header. Renders the same items as the lightbox
          so the user can flip between view modes intuitively. */}
      <TinderMediaSwiper
        items={lightboxItems}
        startIndex={swiperStart ?? 0}
        open={swiperStart !== null}
        onClose={() => setSwiperStart(null)}
      />

      {/* Delete confirm — destructive op, gated by an explicit Delete
          tap so a stray finger on the trash chip can't wipe a clip. */}
      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this clip?</AlertDialogTitle>
            <AlertDialogDescription>
              The photo or video will be permanently removed from the session
              and your library. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="justify-center sm:justify-center">
            <AlertDialogCancel disabled={deleting} className="flex-1 sm:flex-none">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90 flex-1 sm:flex-none"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
