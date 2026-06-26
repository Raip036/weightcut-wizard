/**
 * CampActivityFeed: last 5-7 events across the user's logging surfaces
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
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";

// Number of activities always shown; the rest sit behind a "Show more"
// dropdown so the section stays compact by default.
const PREVIEW_COUNT = 4;

export type CampActivityFeedProps = {
  /** When null the underlying Convex query is skipped (component returns null). */
  userId: Id<"users"> | string | null;
  limit?: number;
};

type EventKind = "workout" | "weight" | "sleep" | "wellness" | "mission" | "meal" | "reaction";

// Per-kind accent colour. Rendered as a small status dot rather than a
// glyph: the dot keeps the at-a-glance type cue while letting typography
// carry the row, which reads cleaner and more premium than a row of
// saturated icons.
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

  // `userId` here is a gate: the query authenticates itself via
  // `optionalUserId` on the server, so we just need *some* identity to
  // know whether to fire it. Skipping when null keeps the dashboard quiet
  // during the cold-start auth race.
  const events = useQuery(
    api.campActivityFeed.getRecent,
    userId ? { limit } : "skip",
  );
  const clearActivity = useMutation(api.campActivityFeed.clearActivity);

  const [expanded, setExpanded] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const toggleExpanded = () => {
    triggerHapticSelection();
    setConfirmingClear(false);
    setExpanded((v) => !v);
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
  // show. A heading with no rows underneath reads as a broken state.
  const visibleEvents = useMemo(() => events ?? null, [events]);

  if (!userId) return null;
  if (visibleEvents === null) return null;       // pending
  if (visibleEvents.length === 0) return null;    // empty → hide section

  return (
    <section className="space-y-2" aria-label="Recent activity">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground/80 font-semibold py-0.5">
          Recent activity
        </span>

        {/* Clear: two-step inline confirm to avoid accidental taps. */}
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

      <ul className="divide-y divide-border/40">
        {(expanded ? visibleEvents : visibleEvents.slice(0, PREVIEW_COUNT)).map((ev, i) => {
          const kind = ev.kind as EventKind;
          return (
            <li key={`${ev.timestamp}-${i}`}>
              <button
                type="button"
                onClick={() => navigate(ev.route)}
                className={cn(
                  "w-full flex items-center gap-3 px-1 py-3",
                  "active:opacity-70 transition-opacity text-left",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full bg-current shrink-0",
                    COLORS[kind],
                  )}
                  aria-hidden="true"
                />
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

      {visibleEvents.length > PREVIEW_COUNT && (
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70 active:text-foreground transition-colors"
        >
          {expanded ? "Show less" : `Show ${visibleEvents.length - PREVIEW_COUNT} more`}
          <Icon
            name="chevronDownOutline"
            size={13}
            className={cn(
              "text-muted-foreground/60 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>
      )}
    </section>
  );
}

export default CampActivityFeed;
