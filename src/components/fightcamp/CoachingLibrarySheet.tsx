import { memo, useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowDownAZ, ArrowUpAZ, BookOpen, Loader2, Lock } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCoachingLibrary } from "@/hooks/useCoachingLibrary";
import { useSubscription } from "@/hooks/useSubscription";
import { getSessionColor, getUserColors } from "@/lib/sessionColors";

interface CoachingLibrarySheetProps {
  userId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SortOrder = "newest" | "oldest";

export const CoachingLibrarySheet = memo(function CoachingLibrarySheet({
  userId,
  open,
  onOpenChange,
}: CoachingLibrarySheetProps) {
  const { isPremium, openPaywall } = useSubscription();
  const { entries, loading, loadingMore, allLoaded, error, loadMore } =
    useCoachingLibrary(userId, open && isPremium);
  const [activeFilter, setActiveFilter] = useState<string>("All");
  const [sort, setSort] = useState<SortOrder>("newest");

  const userColors = useMemo(
    () => (userId ? getUserColors(userId) : {}),
    [userId, open]
  );

  const disciplines = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => set.add(e.session_type));
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    let list = entries;
    if (activeFilter !== "All") {
      list = list.filter((e) => e.session_type === activeFilter);
    }
    if (sort === "oldest") list = [...list].reverse();
    return list;
  }, [entries, activeFilter, sort]);

  // Locked: render minimal upsell content inside the sheet
  if (!isPremium) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="h-[60vh] rounded-t-xl border-0 bg-card/95 backdrop-blur-xl p-0"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 4rem)" }}
        >
          <div className="px-5 pt-5 pb-3">
            <SheetHeader>
              <SheetTitle className="text-[14px] font-semibold flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                Coaching Library
              </SheetTitle>
            </SheetHeader>
          </div>
          <div className="px-5 flex flex-col items-center justify-center text-center mt-6 gap-3">
            <div className="h-10 w-10 rounded-full bg-muted/40 flex items-center justify-center">
              <Lock className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-[13px] font-semibold">Pro feature</p>
            <p className="text-[12px] text-muted-foreground max-w-xs">
              Every coaching insight you ever generate, saved chronologically and
              filterable by discipline. Upgrade to unlock.
            </p>
            <button
              onClick={() => {
                onOpenChange(false);
                openPaywall();
              }}
              className="mt-2 h-10 px-5 rounded-full bg-primary text-primary-foreground text-[13px] font-semibold"
            >
              Upgrade
            </button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[88vh] rounded-t-xl border-0 bg-card/95 backdrop-blur-xl overflow-y-auto p-0"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}
      >
        <div className="px-4 pt-4 pb-2 sticky top-0 z-10 bg-card/95 backdrop-blur-xl">
          <SheetHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-xs bg-primary/15 flex items-center justify-center">
                  <BookOpen className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <SheetTitle className="text-[13px] font-semibold">
                    Coaching Library
                  </SheetTitle>
                  <p className="text-[11px] text-muted-foreground">
                    {entries.length} saved insight{entries.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSort((s) => (s === "newest" ? "oldest" : "newest"))}
                className="h-8 px-3 rounded-full bg-muted/30 text-[11px] font-semibold flex items-center gap-1.5 active:scale-95 transition-transform"
                aria-label={`Sort ${sort === "newest" ? "oldest first" : "newest first"}`}
              >
                {sort === "newest" ? (
                  <>
                    <ArrowDownAZ className="h-3.5 w-3.5" />
                    Newest
                  </>
                ) : (
                  <>
                    <ArrowUpAZ className="h-3.5 w-3.5" />
                    Oldest
                  </>
                )}
              </button>
            </div>
          </SheetHeader>

          {/* Discipline filter pills */}
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pt-3 pb-1 -mx-4 px-4">
            {(["All", ...disciplines] as string[]).map((d) => {
              const color = d === "All" ? null : getSessionColor(d, userColors);
              const active = activeFilter === d;
              return (
                <button
                  key={d}
                  onClick={() => setActiveFilter(d)}
                  className={`shrink-0 h-7 px-3 rounded-full text-[11px] font-semibold transition-all ${
                    active
                      ? "text-foreground"
                      : "text-muted-foreground bg-muted/20"
                  }`}
                  style={
                    active
                      ? color
                        ? { backgroundColor: `${color}25`, border: `1px solid ${color}55` }
                        : { backgroundColor: "hsl(var(--primary) / 0.15)", border: "1px solid hsl(var(--primary) / 0.4)" }
                      : undefined
                  }
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-4 pt-2 space-y-2.5">
          {loading && entries.length === 0 && (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="card-surface rounded-xs border border-border p-3 space-y-2"
                >
                  <div className="h-2.5 rounded shimmer-skeleton w-1/3" />
                  <div className="h-2.5 rounded shimmer-skeleton w-full" />
                  <div className="h-2.5 rounded shimmer-skeleton w-4/5" />
                </div>
              ))}
            </div>
          )}

          {!loading && entries.length === 0 && (
            <div className="card-surface rounded-xs border border-border p-6 text-center">
              <p className="text-[13px] text-muted-foreground">
                No coaching insights yet.
              </p>
              <p className="text-[11px] text-muted-foreground/70 mt-1">
                Open the Training Coach widget on the Dashboard to generate your first one.
              </p>
            </div>
          )}

          {!loading && entries.length > 0 && filtered.length === 0 && (
            <div className="card-surface rounded-xs border border-border p-5 text-center">
              <p className="text-[13px] text-muted-foreground">
                No insights for {activeFilter}.
              </p>
            </div>
          )}

          {filtered.map((entry) => {
            const color = getSessionColor(entry.session_type, userColors);
            const data = entry.insight_data || {};
            const dateLabel = (() => {
              try {
                return format(new Date(entry.created_at), "MMM d, yyyy");
              } catch {
                return entry.created_at.slice(0, 10);
              }
            })();
            return (
              <div
                key={entry.id}
                className="card-surface rounded-xs border border-border p-3 space-y-2 overflow-hidden"
                style={{ borderLeft: `3px solid ${color}` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                    {entry.session_type}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{dateLabel}</span>
                </div>
                {typeof data.what_you_did === "string" && data.what_you_did && (
                  <p className="text-[13px] text-muted-foreground leading-snug">
                    {data.what_you_did}
                  </p>
                )}
                {typeof data.next_focus === "string" && data.next_focus && (
                  <div
                    className="rounded-xs p-2.5"
                    style={{
                      backgroundColor: `${color}10`,
                      border: `1px solid ${color}33`,
                    }}
                  >
                    <p
                      className="text-[10px] uppercase tracking-wide font-semibold mb-1"
                      style={{ color }}
                    >
                      Focus next
                    </p>
                    <p className="text-[13px] text-foreground leading-snug">
                      {data.next_focus}
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {error && (
            <p className="text-[11px] text-destructive text-center pt-1">{error}</p>
          )}

          {!allLoaded && entries.length > 0 && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full h-10 rounded-xs bg-muted/30 text-[12px] font-semibold flex items-center justify-center gap-2 active:opacity-80 transition-opacity disabled:opacity-60"
            >
              {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
});
