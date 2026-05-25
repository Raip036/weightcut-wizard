/**
 * Weekly highlight card — Sunday-only summary card that lands above the
 * polaroid stack and gives the viewer a snapshot of their training week.
 *
 * MVP scope:
 *  - Reads `api.feedSocial.weeklyHighlight` (last 7d window of the
 *    caller's own session_media).
 *  - Renders headline stats (posts / likes), a 2×2 photo collage from
 *    the most-liked thumbs, and a session-type breakdown row.
 *  - No share UX, no canvas image generation. Both deferred — the data
 *    is the load-bearing thing, the screenshot is the bonus.
 *
 * Visibility: surfaced only on Sundays (UTC) so the surface stays a
 * Sunday-night ritual moment rather than a permanent fixture. The card
 * also hides itself when there's nothing meaningful to show (zero posts
 * this week).
 */
import { useQuery } from "convex/react";
import { motion } from "motion/react";
import { api } from "../../../convex/_generated/api";

interface WeeklyHighlightCardProps {
  /** Override the auto Sunday-only gate — useful for the in-app preview
   *  surface or a "view last week" entry point. Defaults to `false`. */
  alwaysVisible?: boolean;
}

export function WeeklyHighlightCard({ alwaysVisible = false }: WeeklyHighlightCardProps) {
  // Sunday = day 0 in JS's local clock. We honour the user's local day
  // boundary rather than UTC so a fighter in Bangkok sees the card on
  // their Sunday, not 4-7 hours late.
  const isSunday = new Date().getDay() === 0;
  const enabled = alwaysVisible || isSunday;
  const data = useQuery(api.feedSocial.weeklyHighlight, enabled ? {} : "skip");

  if (!enabled) return null;
  if (!data) return null;
  if (data.postCount === 0) return null;

  const weekRange = formatWeekRange(data.weekStart, data.weekEnd);
  const typeEntries = Object.entries(data.sessionTypes).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      className="mb-3 rounded-2xl border border-primary/25 bg-card/70 overflow-hidden"
      aria-label="Your week in review"
    >
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.15em] font-bold text-primary/80">
            Your week
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
            {weekRange}
          </p>
        </div>
        <span aria-hidden className="text-base">🏆</span>
      </div>

      {/* 2×2 photo collage — fills slot-by-slot. Empty slots fade into
          the card surface so a 1-photo week doesn't look broken. */}
      <CollageGrid thumbs={data.topThumbs} />

      <div className="px-4 py-3 flex items-center gap-4">
        <Stat label="Sessions" value={data.postCount} />
        <Stat label="Likes" value={data.likeTotal} />
        {data.commentTotal > 0 && (
          <Stat label="Comments" value={data.commentTotal} />
        )}
      </div>

      {typeEntries.length > 0 && (
        <div className="px-4 pb-3.5 flex flex-wrap items-center gap-1.5">
          {typeEntries.map(([type, count]) => (
            <span
              key={type}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-muted/50 text-[11px] text-foreground/85 tabular-nums"
            >
              <span className="font-semibold">{count}</span>
              <span className="capitalize text-muted-foreground">{type}</span>
            </span>
          ))}
        </div>
      )}
    </motion.section>
  );
}

/* ─── helpers ─── */

function CollageGrid({ thumbs }: { thumbs: string[] }) {
  // Always render a 2×2 grid so the card height is stable; missing
  // slots get a soft placeholder so the layout doesn't reflow as
  // photos hydrate over the websocket.
  const slots = [thumbs[0], thumbs[1], thumbs[2], thumbs[3]];
  return (
    <div className="grid grid-cols-2 gap-0.5">
      {slots.map((url, i) => (
        <div
          key={i}
          className="relative aspect-square bg-muted/40 overflow-hidden"
        >
          {url && (
            <img
              src={url}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[17px] font-bold tabular-nums leading-none">
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
        {label}
      </span>
    </div>
  );
}

function formatWeekRange(startMs: number, endMs: number): string {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(start)} → ${fmt(end)}`;
}
