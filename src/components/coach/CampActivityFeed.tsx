/**
 * CampActivityFeed — last 5–7 events across the user's logging surfaces
 * (training, weight, sleep, wellness, completed missions). Renders nothing
 * while the query is pending or empty so the host page doesn't show a
 * lonely "Recent activity" heading. Each row is tappable and navigates to
 * the canonical surface for that event kind.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";

// Persist the collapsed state across navigations/remounts so the section
// stays the way the user left it.
const COLLAPSE_KEY = "campActivityCollapsed";
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export type CampActivityFeedProps = {
  /** When null the underlying Convex query is skipped (component returns null). */
  userId: Id<"users"> | string | null;
  limit?: number;
};

type EventKind = "workout" | "weight" | "sleep" | "wellness" | "mission" | "meal" | "reaction";

// Icon per event kind. Weight uses `speedometerOutline` to match the rest
// of the dashboard chrome (TodayStrip, MilestoneBadges, FightFormScoreSheet
// all use it for the weight/scale surface — `scaleOutline` would read as
// inconsistent next to those). Reactions use `happyOutline` to keep a
// distinct glyph from wellness (which already owns `heartOutline`).
const ICONS: Record<EventKind, IonIconName> = {
  workout:  "barbellOutline",
  weight:   "speedometerOutline",
  sleep:    "moonOutline",
  wellness: "heartOutline",
  mission:  "trophyOutline",
  meal:     "restaurantOutline",
  reaction: "happyOutline",
};

const COLORS: Record<EventKind, string> = {
  workout:  "text-blue-400",
  weight:   "text-amber-400",
  sleep:    "text-indigo-400",
  wellness: "text-rose-400",
  mission:  "text-emerald-400",
  meal:     "text-orange-400",
  reaction: "text-pink-400",
};

/**
 * Compact human-readable "time since" formatter. The shared
 * `relativeTime` helper in `@/lib/relativeTime` consumes ISO strings; here
 * we already have epoch ms from `_creationTime` and want a slightly richer
 * vocabulary (explicit "yesterday", "N days ago"), so a small inline
 * implementation is cheaper than coercing back to ISO.
 */
function timeAgo(ms: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - ms);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  if (diff < MIN) return "just now";
  if (diff < HOUR) {
    const m = Math.floor(diff / MIN);
    return `${m} min ago`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h} h ago`;
  }
  if (diff < 2 * DAY) return "yesterday";
  if (diff < 7 * DAY) {
    const d = Math.floor(diff / DAY);
    return `${d} days ago`;
  }
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function CampActivityFeed({ userId, limit = 7 }: CampActivityFeedProps) {
  const navigate = useNavigate();

  // `userId` here is a gate — the query authenticates itself via
  // `optionalUserId` on the server, so we just need *some* identity to
  // know whether to fire it. Skipping when null keeps the dashboard quiet
  // during the cold-start auth race.
  const events = useQuery(
    api.campActivityFeed.getRecent,
    userId ? { limit } : "skip",
  );
  const clearActivity = useMutation(api.campActivityFeed.clearActivity);

  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const toggleCollapsed = () => {
    triggerHapticSelection();
    setConfirmingClear(false);
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* private mode / storage disabled — non-fatal */
      }
      return next;
    });
  };

  const handleClear = async () => {
    triggerHapticSelection();
    setConfirmingClear(false);
    try {
      // Reactive: the query re-runs and the section empties out (→ null).
      await clearActivity({});
    } catch (err) {
      console.warn("CampActivityFeed: clear failed", err);
    }
  };

  // Hide the section entirely while loading or when there's nothing to
  // show — a heading with no rows underneath reads as a broken state.
  const visibleEvents = useMemo(() => events ?? null, [events]);

  if (!userId) return null;
  if (visibleEvents === null) return null;       // pending
  if (visibleEvents.length === 0) return null;    // empty → hide section

  return (
    <section className="space-y-2" aria-label="Recent activity">
      <div className="flex items-center justify-between gap-2">
        {/* Tap the heading to collapse/expand the feed. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          className="flex items-center gap-1.5 py-0.5 active:opacity-70 transition-opacity"
        >
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/80 font-semibold">
            Recent activity
          </span>
          <Icon
            name="chevronDownOutline"
            size={13}
            className={cn(
              "text-muted-foreground/60 transition-transform",
              collapsed && "-rotate-90",
            )}
          />
        </button>

        {/* Clear — two-step inline confirm to avoid accidental taps. */}
        {confirmingClear ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmingClear(false)}
              className="text-[11px] font-semibold text-muted-foreground/70 active:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="text-[11px] font-semibold text-rose-400 active:text-rose-300 transition-colors"
            >
              Clear all
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              triggerHapticSelection();
              setConfirmingClear(true);
            }}
            className="text-[11px] font-semibold text-muted-foreground/60 active:text-foreground transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {!collapsed && (
      <ul className="space-y-1.5">
        {visibleEvents.map((ev, i) => {
          const kind = ev.kind as EventKind;
          return (
            <li key={`${ev.timestamp}-${i}`}>
              <button
                type="button"
                onClick={() => navigate(ev.route)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl",
                  "card-surface",
                  "active:brightness-110 transition-[filter] text-left",
                )}
              >
                <Icon name={ICONS[kind]} size={16} className={COLORS[kind]} />
                <div className="flex-1 min-w-0">
                  {/* Wrap to at most 2 lines instead of single-line truncate,
                      so long titles (e.g. mission names) stay readable without
                      blowing out the row or pushing the time label around. */}
                  <p className="text-sm font-medium leading-snug line-clamp-2 break-words">{ev.title}</p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {timeAgo(ev.timestamp)}
                  </p>
                </div>
                {ev.value && (
                  <span className="text-sm font-semibold tabular-nums shrink-0">
                    {ev.value}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      )}
    </section>
  );
}

export default CampActivityFeed;
