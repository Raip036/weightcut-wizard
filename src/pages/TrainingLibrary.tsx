/**
 * Training — the athlete's training hub. Two segmented tabs:
 *
 *  • Gallery    — a BeReal-style monthly CALENDAR of training media. Each day
 *                 cell shows that day's clip, tinted by discipline. Tapping a
 *                 day opens a detail sheet with the session type, notes, and
 *                 every clip from that day; tapping a clip opens the full-screen
 *                 MediaLightbox. The old Tinder-swipe deck was removed.
 *  • Techniques — the all-time, searchable technique log.
 *
 * Techniques is a Pro feature. Free users see the shared animated
 * ProUpsellScreen (the Recovery-style aurora gate) inside the tab. The weekly
 * Recaps tab was removed; Technique Mastery + the weekly summary cover it.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, parseISO, getDay, getDaysInMonth } from "date-fns";
import { ChevronLeft, ImageIcon, Play } from "lucide-react";
import { useMutation, useQuery, usePaginatedQuery } from "convex/react";
import { TrainingGalleryMasonry } from "@/components/training/TrainingGalleryMasonry";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { useSubscription } from "@/hooks/useSubscription";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { triggerHapticSelection } from "@/lib/haptics";
import { disciplineToken, disciplineLabel } from "@/lib/coachColors";
import { MediaLightbox, type LightboxItem } from "@/components/training/MediaLightbox";
import { TechniqueLog } from "@/components/fightcamp/TechniqueLog";
import { ProUpsellScreen } from "@/components/subscription/ProUpsellScreen";
import { DashboardSkeleton } from "@/components/ui/skeleton-loader";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
  sessionId: string | null;
  url: string | null;
  /** 256px thumbnail (full-res fallback server-side) for the grid. */
  thumbUrl: string | null;
  /** Inline LQIP placeholder. */
  thumbDataUrl: string | null;
  /** Intrinsic dimensions, for aspect-locking the masonry tile. */
  width: number | null;
  height: number | null;
  kind: "photo" | "video";
  caption: string | null;
  capturedAt: string;
  /** PRIMARY discipline (martial art / "S&C" / "Rest"). */
  sessionType: string | null;
  /** OPTIONAL activity descriptor (Sparring, Strength, …); null when absent. */
  sessionTag?: string | null;
  sessionDate: string;
  sessionNotes?: string | null;
};

type SessionGroup = {
  key: string;
  sessionType: string | null;
  sessionTag: string | null;
  note: string | null;
  items: Tile[];
};

type TabKey = "gallery" | "techniques";

const ALL_FILTER = "all";
const TABS: { key: TabKey; label: string }[] = [
  { key: "gallery", label: "Gallery" },
  { key: "techniques", label: "Techniques" },
];
// Monday-first week, matching the rest of the app (weekStartsOn: 1).
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** Day bucket key (yyyy-MM-dd) for a clip — prefers the logged session date,
 *  falls back to the capture timestamp. */
function dayKeyOf(t: Tile): string {
  const sd = t.sessionDate;
  if (sd && /^\d{4}-\d{2}-\d{2}/.test(sd)) return sd.slice(0, 10);
  try {
    return format(parseISO(t.capturedAt), "yyyy-MM-dd");
  } catch {
    return (t.capturedAt ?? "").slice(0, 10);
  }
}

/** Group a day's clips into the sessions they belong to (orphans = solo). */
function groupBySession(items: Tile[]): SessionGroup[] {
  const out: SessionGroup[] = [];
  const index = new Map<string, number>();
  for (const t of items) {
    const key = t.sessionId ?? `solo-${t.id}`;
    let i = index.get(key);
    if (i === undefined) {
      i = out.length;
      index.set(key, i);
      out.push({
        key,
        sessionType: t.sessionType,
        sessionTag: t.sessionTag ?? null,
        note: t.sessionNotes ?? t.caption ?? null,
        items: [],
      });
    }
    out[i].items.push(t);
  }
  return out;
}

export default function TrainingLibrary() {
  const navigate = useNavigate();
  const { userId } = useUser();
  const { toast } = useToast();
  const { openPaywall, isSubscriptionResolved } = useSubscription();
  const { hasAccess: hasRecapAccess } = useFeatureAccess("AI_TRAINING_SUMMARY");

  const [tab, setTab] = useState<TabKey>("gallery");
  const [filter, setFilter] = useState<string>(ALL_FILTER);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const {
    results: pagedTiles,
    status: mediaStatus,
    loadMore: loadMoreMedia,
  } = usePaginatedQuery(
    api.fight_camp.listMyMediaLibrary,
    userId ? { disciplineFilter: filter === ALL_FILTER ? undefined : filter } : "skip",
    { initialNumItems: 60 },
  );
  const tiles = pagedTiles as Tile[];
  const mediaLoadingFirst = mediaStatus === "LoadingFirstPage";
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
      setLightboxIndex(null);
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

  // Bucket clips by day, then list the months that contain any clips (newest
  // first) so the calendar can render a full month grid for each.
  const { dayMap, months } = useMemo(() => {
    const dm = new Map<string, Tile[]>();
    for (const t of tiles ?? []) {
      const key = dayKeyOf(t);
      const arr = dm.get(key);
      if (arr) arr.push(t);
      else dm.set(key, [t]);
    }
    const monthSet = new Set<string>();
    for (const k of dm.keys()) monthSet.add(k.slice(0, 7));
    const monthList = Array.from(monthSet).sort((a, b) => b.localeCompare(a));
    return { dayMap: dm, months: monthList };
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
        sessionTag: t.sessionTag ?? null,
      })),
    [tiles],
  );

  const openClip = (tileId: string) => {
    const idx = lightboxItems.findIndex((x) => x.id === tileId);
    if (idx >= 0) {
      triggerHapticSelection();
      setSelectedDay(null);
      setLightboxIndex(idx);
    }
  };

  if (!userId) return <DashboardSkeleton />;

  const filterChips = [ALL_FILTER, ...(disciplines ?? [])];
  const clipCount = tiles?.length ?? 0;
  const dayGroups = selectedDay ? groupBySession(dayMap.get(selectedDay) ?? []) : [];

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
          <div className="flex items-center gap-2 px-4 pb-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="-ml-2 p-2 rounded-xs active:bg-muted/40 transition-colors"
              aria-label="Back"
            >
              <ChevronLeft className="h-5 w-5 text-muted-foreground" />
            </button>
            <h1 className="text-[21px] font-bold tracking-tight">Training</h1>
            {tab === "gallery" && clipCount > 0 && (
              <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">
                {clipCount} {clipCount === 1 ? "clip" : "clips"}
              </span>
            )}
          </div>

          {/* Segmented control */}
          <div className="mx-4 mb-3 flex gap-1 rounded-2xl bg-muted/40 border border-border/40 p-1">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    setTab(t.key);
                  }}
                  className={`flex-1 rounded-xl py-2 text-[13px] font-semibold transition-all active:scale-[0.98] ${
                    active
                      ? "bg-primary text-primary-foreground shadow-[0_3px_10px_-2px_hsl(var(--primary)/0.5)]"
                      : "text-muted-foreground"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Discipline chips — gallery only, and only once the user has clips. */}
          {tab === "gallery" && filterChips.length > 1 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide px-4 pb-2.5">
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
                    {d === ALL_FILTER ? "All" : disciplineLabel(d)}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── GALLERY (Pinterest-style masonry) ─────────────────────── */}
        {tab === "gallery" &&
          (mediaLoadingFirst ? (
            <DashboardSkeleton />
          ) : tiles.length === 0 && mediaStatus === "Exhausted" ? (
            // Only "empty" once pagination is truly done. A discipline filter is
            // applied AFTER pagination server-side, so the first page can be
            // empty-but-not-done — in that case we still render the masonry so
            // its sentinel keeps fetching pages until matches appear or we run out.
            <EmptyGallery onOpenCalendar={() => navigate("/training-calendar")} />
          ) : (
            <TrainingGalleryMasonry
              tiles={tiles}
              onOpen={openClip}
              onEndReached={() => {
                if (mediaStatus === "CanLoadMore") loadMoreMedia(30);
              }}
              loadingMore={mediaStatus === "LoadingMore"}
            />
          ))}

        {/* ── TECHNIQUES ─────────────────────────────────────────────── */}
        {tab === "techniques" && (
          <TabGate
            unlocked={hasRecapAccess}
            resolved={isSubscriptionResolved}
            title="The Technique Log is a Pro feature"
            blurb="Every technique you drill is saved to a searchable, all-time library you build over time."
            perks={[
              "All-time, searchable technique library",
              "Grouped by discipline with quick cues",
              "Tracks how often you've drilled each one",
            ]}
            onUpgrade={() => openPaywall("training_library")}
            onDismiss={() => setTab("gallery")}
          >
            <div className="px-4 pt-4">
              <TechniqueLog />
            </div>
          </TabGate>
        )}
      </div>

      {/* Day detail — session type, notes, and that day's clips. */}
      <Sheet
        open={selectedDay !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedDay(null);
        }}
      >
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[85vh] overflow-y-auto">
          {selectedDay && (
            <>
              <SheetHeader>
                <SheetTitle>{format(parseISO(selectedDay), "EEEE, d MMMM")}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-5">
                {dayGroups.map((g) => {
                  const token = disciplineToken(g.sessionType ?? "");
                  const label = g.sessionType ? disciplineLabel(g.sessionType) : "Session";
                  return (
                    <section key={g.key}>
                      <div className="flex items-center gap-2 mb-2.5">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                          style={{
                            color: `hsl(var(${token}))`,
                            backgroundColor: `hsl(var(${token}) / 0.16)`,
                          }}
                        >
                          {label}
                        </span>
                        {g.sessionTag && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {g.sessionTag}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {g.items.map((t) => (
                          <Thumb key={t.id} tile={t} onClick={() => openClip(t.id)} />
                        ))}
                      </div>
                      {g.note && (
                        <p className="mt-2.5 text-[12.5px] text-muted-foreground leading-snug">
                          {g.note}
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <MediaLightbox
        items={lightboxItems}
        startIndex={lightboxIndex ?? 0}
        open={lightboxIndex !== null}
        onClose={() => setLightboxIndex(null)}
        onDelete={(item) => setPendingDeleteId(item.id)}
      />

      {/* Delete confirm — destructive op, gated by an explicit Delete tap. */}
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
            <AlertDialogCancel disabled={deleting} className="flex-1 sm:flex-none">
              Cancel
            </AlertDialogCancel>
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

// ─── Gallery: one BeReal-style month grid ─────────────────────────────────
function MonthCalendar({
  ym,
  dayMap,
  onOpenDay,
}: {
  ym: string;
  dayMap: Map<string, Tile[]>;
  onOpenDay: (dayKey: string) => void;
}) {
  const monthDate = parseISO(`${ym}-01T00:00:00`);
  const daysInMonth = getDaysInMonth(monthDate);
  // getDay: 0=Sun..6=Sat → convert to Monday-first offset.
  const leadOffset = (getDay(monthDate) + 6) % 7;

  const cells: (number | null)[] = [
    ...Array.from({ length: leadOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <section>
      <div className="grid grid-cols-7 gap-1 mb-1.5">
        {WEEKDAYS.map((d, i) => (
          <div
            key={i}
            className="text-center text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={`pad-${i}`} className="aspect-square" />;
          const dayKey = `${ym}-${String(day).padStart(2, "0")}`;
          const items = dayMap.get(dayKey);
          return (
            <DayCell
              key={dayKey}
              day={day}
              items={items}
              onClick={() => onOpenDay(dayKey)}
            />
          );
        })}
      </div>
    </section>
  );
}

function DayCell({
  day,
  items,
  onClick,
}: {
  day: number;
  items?: Tile[];
  onClick: () => void;
}) {
  // Empty day — faint number on a subtle tile.
  if (!items || items.length === 0) {
    return (
      <div className="aspect-square rounded-lg bg-muted/15 flex items-start justify-end p-1">
        <span className="text-[9px] font-semibold text-muted-foreground/35 tabular-nums">
          {day}
        </span>
      </div>
    );
  }

  const primary = items[0];
  const token = disciplineToken(primary.sessionType ?? "");
  const photo = items.find((t) => t.url && t.kind === "photo") ?? primary;
  const hasVideo = items.some((t) => t.kind === "video");

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-square rounded-lg overflow-hidden bg-muted/40 active:scale-[0.95] transition-transform ring-1"
      style={{ ["--tw-ring-color" as any]: `hsl(var(${token}) / 0.55)` }}
    >
      {photo.url && photo.kind === "photo" ? (
        <img src={photo.url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
      ) : (
        // Video-only day (or no photo) → coloured tile, no <video> so the grid
        // never fetches video data. The play badge below marks it as a clip;
        // the real video loads in the lightbox on tap.
        <div
          className="w-full h-full"
          style={{ backgroundColor: `hsl(var(${token}) / 0.22)` }}
        />
      )}
      {/* legibility wash for the day number */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
      <span className="absolute top-0.5 right-1 text-[9px] font-bold text-white/90 tabular-nums drop-shadow">
        {day}
      </span>
      {/* discipline dot */}
      <span
        className="absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: `hsl(var(${token}))` }}
      />
      {hasVideo && (
        <span className="absolute bottom-0.5 right-1">
          <Play className="h-2.5 w-2.5 text-white fill-white drop-shadow" />
        </span>
      )}
      {items.length > 1 && (
        <span className="absolute top-0.5 left-1 text-[8px] font-bold text-white/90 tabular-nums drop-shadow">
          {items.length}
        </span>
      )}
    </button>
  );
}

function Thumb({ tile, onClick }: { tile: Tile; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-square rounded-xl overflow-hidden bg-muted/40 active:scale-[0.97] transition-transform"
    >
      {tile.url ? (
        tile.kind === "video" ? (
          // Video clip — coloured tile + play badge instead of a <video> (which
          // would fetch metadata for every thumbnail). It plays in the lightbox.
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundColor: `hsl(var(${disciplineToken(tile.sessionType ?? "")}) / 0.25)` }}
          >
            <div className="h-7 w-7 rounded-full bg-black/55 backdrop-blur flex items-center justify-center">
              <Play className="h-3 w-3 text-white fill-white" />
            </div>
          </div>
        ) : (
          <img
            src={tile.url}
            alt={tile.caption ?? "Training media"}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        )
      ) : (
        <div className="h-full w-full flex items-center justify-center text-muted-foreground/40">
          <ImageIcon className="h-4 w-4" />
        </div>
      )}
    </button>
  );
}

function EmptyGallery({ onOpenCalendar }: { onOpenCalendar: () => void }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="mx-auto h-16 w-16 rounded-2xl bg-muted/30 flex items-center justify-center mb-4">
        <ImageIcon className="h-7 w-7 text-muted-foreground/60" />
      </div>
      <h2 className="text-[16px] font-semibold mb-1">No clips yet</h2>
      <p className="text-[13px] text-muted-foreground leading-snug max-w-[280px] mx-auto">
        Add a photo or video when you log a training session and it'll show up
        here on your training calendar.
      </p>
      <button
        type="button"
        onClick={onOpenCalendar}
        className="mt-5 h-10 px-4 rounded-xs bg-primary text-primary-foreground text-[13px] font-semibold active:scale-[0.98] transition-transform"
      >
        Open training calendar
      </button>
    </div>
  );
}

// ─── Pro gate wrapper — shows the animated upsell for free users ───────────
function TabGate({
  unlocked,
  resolved,
  title,
  blurb,
  perks,
  onUpgrade,
  onDismiss,
  children,
}: {
  unlocked: boolean;
  resolved: boolean;
  title: string;
  blurb: string;
  perks: string[];
  onUpgrade: () => void;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  if (!resolved) return <DashboardSkeleton />;
  if (unlocked) return <>{children}</>;
  return (
    <ProUpsellScreen
      source="training_library"
      title={title}
      blurb={blurb}
      perks={perks}
      upgradeLabel="Unlock with Pro"
      onUpgrade={() => {
        triggerHapticSelection();
        onUpgrade();
      }}
      onDismiss={onDismiss}
    />
  );
}
