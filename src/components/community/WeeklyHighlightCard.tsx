/**
 * Weekly highlight card — Sunday/Monday recap card that lands above the
 * polaroid stack and gives the viewer a snapshot of their training week.
 *
 * Renders:
 *  - Headline stats (sessions / likes / comments) — centred row.
 *  - Dynamic collage that scales to whatever the user actually posted:
 *    bento templates for 1-6 photos (curated for hierarchy), justified
 *    mosaic fallback for 7+ so every shot makes the cut without an
 *    overflow chip.
 *  - Session-type breakdown coloured to match the Training Calendar.
 *  - Prev/next chevrons to scrub back through previous weeks (12 weeks).
 *  - Tap-to-expand: opens a fullscreen sheet with the same content at
 *    "Story preview" scale + the same archive nav + share button.
 *  - Save + Share-to-Story button (wired in `useStoryShare`) that
 *    rasterises a 9:16 off-screen render and pushes it through the
 *    iOS share sheet.
 *
 * Visibility: Sunday + Monday only — a fighter who misses Sunday still
 * catches the recap before the new training week buries it. After
 * Monday the card disappears so it doesn't compete with the new week's
 * training feed.
 */
import { useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { motion, AnimatePresence } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";
import { api } from "../../../convex/_generated/api";
import { useStoryShare } from "@/hooks/community/useStoryShare";
import { WeeklyHighlightStoryTemplate } from "./WeeklyHighlightStoryTemplate";

export interface WeeklyHighlightData {
  weekStart: number;
  weekEnd: number;
  postCount: number;
  likeTotal: number;
  commentTotal: number;
  topThumbs: string[];
  sessionTypes: Record<string, number>;
}

// How far back we let users scrub through prior weeks. 12 weeks ≈ one
// fight-camp cycle — anything further back belongs in a dedicated
// archive screen, not the in-feed card.
const MAX_WEEK_OFFSET = 12;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function WeeklyHighlightCard() {
  // Sun (0) and Mon (1) — accommodates fighters who don't open the app
  // until Monday morning. After Monday the card disappears so it doesn't
  // compete with the new week's training feed.
  const day = new Date().getDay();
  const enabled = day === 0 || day === 1;

  // Week-offset scrubber: 0 = the rolling 7d window ending now.
  // weekOffset N = the window ending (now - N*7d).
  const [weekOffset, setWeekOffset] = useState(0);
  // Stabilise the window endpoint: `Date.now()` changes every millisecond, so
  // computing it inline made `weekEndMs` a fresh value on EVERY render — and
  // since Convex keys a useQuery subscription by its args, that spun up a brand
  // new `weeklyHighlight` execution per re-render. Capture it once per
  // `weekOffset` (only changes when the user actually scrubs weeks).
  const weekEndMs = useMemo(
    () => Date.now() - weekOffset * SEVEN_DAYS_MS,
    [weekOffset],
  );

  const data = useQuery(
    api.feedSocial.weeklyHighlight,
    enabled ? { weekEndMs } : "skip",
  );

  // Fullscreen expansion state. Lifted here so navigation chevrons
  // share the same `weekOffset` between the small card and the modal.
  const [expanded, setExpanded] = useState(false);

  const { share, isSharing, templateProps, templateRef } = useStoryShare();

  if (!enabled) return null;
  if (!data) return null;
  if (data.postCount === 0 && weekOffset === 0) return null;

  const handleShare = () => {
    void share(data).catch(() => {
      /* Errors already logged in the hook; swallow here so the button
         doesn't bubble an unhandled-promise rejection on user cancel. */
    });
  };

  const canPrev = weekOffset < MAX_WEEK_OFFSET;
  const canNext = weekOffset > 0;
  const goPrev = () => {
    if (!canPrev) return;
    triggerHapticSelection();
    setWeekOffset((o) => Math.min(MAX_WEEK_OFFSET, o + 1));
  };
  const goNext = () => {
    if (!canNext) return;
    triggerHapticSelection();
    setWeekOffset((o) => Math.max(0, o - 1));
  };

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
        className="mb-3 rounded-2xl border border-primary/25 bg-neutral-800 overflow-hidden"
        aria-label="Your week in review"
        style={{ fontFamily: IOS_FONT }}
      >
        <CardHeader
          data={data}
          weekOffset={weekOffset}
          canPrev={canPrev}
          canNext={canNext}
          onPrev={goPrev}
          onNext={goNext}
        />

        {/* Body is tap-to-expand. Buttons inside (prev/next, share)
            stop propagation so they don't double-fire the expand. */}
        <button
          type="button"
          onClick={() => {
            triggerHapticSelection();
            setExpanded(true);
          }}
          className="block w-full text-left"
          aria-label="Expand week recap"
        >
          <Collage thumbs={data.topThumbs} />
          <StatsRow data={data} />
          <TypesRow sessionTypes={data.sessionTypes} />
        </button>

        <div className="px-4 pb-3.5">
          <button
            type="button"
            onClick={handleShare}
            disabled={isSharing}
            className="w-full h-10 inline-flex items-center justify-center gap-2 bg-foreground text-background text-[13px] font-semibold active:scale-[0.98] transition-transform disabled:opacity-50"
            style={{ borderRadius: 4 }}
          >
            {isSharing ? (
              <>
                <Icon name="syncOutline" size={14} className="animate-spin" />
                Preparing…
              </>
            ) : (
              <>
                <Icon name="shareOutline" size={14} />
                Share to Story
              </>
            )}
          </button>
        </div>
      </motion.section>

      {/* Fullscreen expanded view. Portal'd to body so the parent
          PageTransition's transform doesn't trap position: fixed. */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {expanded && (
              <ExpandedView
                data={data}
                weekOffset={weekOffset}
                canPrev={canPrev}
                canNext={canNext}
                onPrev={goPrev}
                onNext={goNext}
                onClose={() => setExpanded(false)}
                onShare={handleShare}
                isSharing={isSharing}
              />
            )}
          </AnimatePresence>,
          document.body,
        )}

      {/* Off-screen story render for share. */}
      {templateProps &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            aria-hidden
            style={{
              position: "fixed",
              left: -10000,
              top: 0,
              pointerEvents: "none",
              opacity: 0,
            }}
          >
            <WeeklyHighlightStoryTemplate ref={templateRef} {...templateProps} />
          </div>,
          document.body,
        )}
    </>
  );
}

/* ─── shared sub-pieces ─── */

function CardHeader({
  data,
  weekOffset,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: {
  data: WeeklyHighlightData;
  weekOffset: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const range = formatWeekRange(data.weekStart, data.weekEnd);
  const label = weekOffset === 0 ? "Your week" : weekOffset === 1 ? "Last week" : `${weekOffset} weeks ago`;
  return (
    <div className="px-4 pt-3.5 pb-2 flex items-start justify-between">
      <div>
        <p className="text-[10px] uppercase tracking-[0.15em] font-bold text-foreground/80">
          {label}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
          {range}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0 -mr-1">
        <NavChevron direction="prev" disabled={!canPrev} onClick={onPrev} />
        <NavChevron direction="next" disabled={!canNext} onClick={onNext} />
      </div>
    </div>
  );
}

function NavChevron({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      disabled={disabled}
      aria-label={direction === "prev" ? "Previous week" : "Next week"}
      className="h-8 w-8 flex items-center justify-center rounded-full active:bg-muted/40 disabled:opacity-25 transition-colors"
    >
      <Icon
        name={direction === "prev" ? "chevronBackOutline" : "chevronForwardOutline"}
        size={16}
      />
    </button>
  );
}

function StatsRow({ data }: { data: WeeklyHighlightData }) {
  return (
    <div className="px-4 py-3 flex items-center justify-center gap-8">
      <Stat label="Sessions" value={data.postCount} />
      <Stat label="Likes" value={data.likeTotal} />
      <Stat label="Comments" value={data.commentTotal} />
    </div>
  );
}

function TypesRow({ sessionTypes }: { sessionTypes: Record<string, number> }) {
  const entries = Object.entries(sessionTypes).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <div className="px-4 pb-3 flex flex-wrap items-center justify-center gap-1.5">
      {entries.map(([type, count]) => {
        const color = sessionTypeColor(type);
        return (
          <span
            key={type}
            className="inline-flex items-center gap-1.5 h-6 px-2 text-[11px] tabular-nums"
            style={{
              background: `${color}1a`,
              color,
              border: `1px solid ${color}40`,
              borderRadius: 3,
            }}
          >
            <span className="font-semibold">{count}</span>
            <span className="capitalize" style={{ color }}>
              {type}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/* ─── fullscreen expanded view ─── */

function ExpandedView({
  data,
  weekOffset,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onClose,
  onShare,
  isSharing,
}: {
  data: WeeklyHighlightData;
  weekOffset: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onShare: () => void;
  isSharing: boolean;
}) {
  const label = weekOffset === 0 ? "Your week" : weekOffset === 1 ? "Last week" : `${weekOffset} weeks ago`;
  const range = formatWeekRange(data.weekStart, data.weekEnd);
  return (
    <motion.div
      key="weekly-highlight-expanded"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      className="fixed inset-0 z-[10050] bg-background text-foreground overflow-y-auto"
      style={{
        fontFamily: IOS_FONT,
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="flex items-center justify-between px-5 pt-3 pb-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="h-9 w-9 flex items-center justify-center rounded-full active:bg-muted/40 transition-colors -ml-2"
        >
          <Icon name="closeOutline" size={20} />
        </button>
        <div className="flex items-center gap-1">
          <NavChevron direction="prev" disabled={!canPrev} onClick={onPrev} />
          <NavChevron direction="next" disabled={!canNext} onClick={onNext} />
        </div>
      </div>

      <motion.div
        key={`${data.weekStart}-${data.weekEnd}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        className="px-5 pb-8"
      >
        <p className="text-[12px] uppercase tracking-[0.18em] font-bold text-foreground/80">
          {label}
        </p>
        <p className="text-[28px] font-bold tracking-tight leading-tight mt-1">
          {range}
        </p>

        <div className="mt-5 rounded-2xl overflow-hidden border border-border/40">
          <Collage thumbs={data.topThumbs} />
        </div>

        <div className="mt-5 flex items-center justify-center gap-10">
          <BigStat label="Sessions" value={data.postCount} />
          <BigStat label="Likes" value={data.likeTotal} />
          <BigStat label="Comments" value={data.commentTotal} />
        </div>

        <div className="mt-5">
          <TypesRow sessionTypes={data.sessionTypes} />
        </div>

        <button
          type="button"
          onClick={onShare}
          disabled={isSharing}
          className="mt-3 w-full h-12 inline-flex items-center justify-center gap-2 bg-foreground text-background text-[14px] font-semibold active:scale-[0.99] transition-transform disabled:opacity-50"
          style={{ borderRadius: 6 }}
        >
          {isSharing ? (
            <>
              <Icon name="syncOutline" size={16} className="animate-spin" />
              Preparing…
            </>
          ) : (
            <>
              <Icon name="shareOutline" size={16} />
              Share to Story
            </>
          )}
        </button>
      </motion.div>
    </motion.div>
  );
}

function BigStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[34px] font-bold tabular-nums leading-none">
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1.5">
        {label}
      </span>
    </div>
  );
}

/* ─── helpers ─── */

const SESSION_COLORS: Record<string, string> = {
  bjj: "#2f6fe0",
  "muay thai": "#dc3a3a",
  muaythai: "#dc3a3a",
  striking: "#dc3a3a",
  boxing: "#e07a26",
  wrestling: "#d49a26",
  grappling: "#2f6fe0",
  sparring: "#ef8033",
  strength: "#38a85a",
  conditioning: "#1ea59a",
  cardio: "#1ea59a",
  run: "#2c93c8",
  recovery: "#9a55de",
  rest: "#6f8aa6",
  clinch: "#9a55de",
  cut: "#d49a26",
  weighin: "#d4b226",
  "weigh in": "#d4b226",
  "weigh-in": "#d4b226",
};

const IOS_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif';

function sessionTypeColor(type: string): string {
  const key = type.toLowerCase().trim();
  return SESSION_COLORS[key] ?? "#6b7280";
}

interface CollageProps {
  thumbs: string[];
}

function Collage({ thumbs }: CollageProps) {
  if (thumbs.length === 0) return null;
  if (thumbs.length <= 6) return <BentoCollage thumbs={thumbs} />;
  return <JustifiedCollage thumbs={thumbs} />;
}

function BentoCollage({ thumbs }: { thumbs: string[] }) {
  const n = thumbs.length;
  if (n === 1) {
    return (
      <div className="grid grid-cols-1">
        <Tile url={thumbs[0]} aspect="aspect-[4/3]" />
      </div>
    );
  }
  if (n === 2) {
    return (
      <div className="grid grid-cols-2 gap-0.5">
        <Tile url={thumbs[0]} aspect="aspect-square" />
        <Tile url={thumbs[1]} aspect="aspect-square" />
      </div>
    );
  }
  if (n === 3) {
    return (
      <div className="grid grid-cols-3 grid-rows-2 gap-0.5 aspect-[3/2]">
        <div className="col-span-2 row-span-2 relative overflow-hidden">
          <BgImg url={thumbs[0]} />
        </div>
        <div className="relative overflow-hidden">
          <BgImg url={thumbs[1]} />
        </div>
        <div className="relative overflow-hidden">
          <BgImg url={thumbs[2]} />
        </div>
      </div>
    );
  }
  if (n === 4) {
    return (
      <div className="grid grid-cols-2 gap-0.5">
        {thumbs.slice(0, 4).map((u, i) => (
          <Tile key={i} url={u} aspect="aspect-square" />
        ))}
      </div>
    );
  }
  if (n === 5) {
    return (
      <div className="space-y-0.5">
        <div className="grid grid-cols-2 gap-0.5">
          <Tile url={thumbs[0]} aspect="aspect-[4/3]" />
          <Tile url={thumbs[1]} aspect="aspect-[4/3]" />
        </div>
        <div className="grid grid-cols-3 gap-0.5">
          <Tile url={thumbs[2]} aspect="aspect-square" />
          <Tile url={thumbs[3]} aspect="aspect-square" />
          <Tile url={thumbs[4]} aspect="aspect-square" />
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-0.5">
      {thumbs.slice(0, 6).map((u, i) => (
        <Tile key={i} url={u} aspect="aspect-square" />
      ))}
    </div>
  );
}

function JustifiedCollage({ thumbs }: { thumbs: string[] }) {
  const n = thumbs.length;
  const cols = Math.min(5, Math.max(3, Math.ceil(Math.sqrt(n * 1.5))));
  const remainder = n % cols;
  const lastCellSpans = remainder === cols - 1;
  return (
    <div
      className="grid gap-0.5"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {thumbs.map((u, i) => {
        const isLast = i === n - 1 && lastCellSpans;
        return (
          <div
            key={i}
            className={`relative aspect-square overflow-hidden ${
              isLast ? "col-span-2" : ""
            }`}
            style={isLast ? { aspectRatio: "2 / 1" } : undefined}
          >
            <BgImg url={u} />
          </div>
        );
      })}
    </div>
  );
}

function Tile({ url, aspect }: { url: string | undefined; aspect: string }) {
  return (
    <div className={`relative ${aspect} overflow-hidden bg-muted/40`}>
      <BgImg url={url} />
    </div>
  );
}

function BgImg({ url }: { url: string | undefined }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      crossOrigin="anonymous"
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[20px] font-bold tabular-nums leading-none">
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
