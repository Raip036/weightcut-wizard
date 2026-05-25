/**
 * Off-screen 1080×1920 render of the weekly highlight card, optimised
 * for Instagram-Story export. Mounted in a portal at `left: -9999px`
 * during the share flow; html-to-image rasterises it at pixelRatio: 1
 * (intrinsic size is already the export size).
 *
 * The on-feed `WeeklyHighlightCard` stays compact (~400×400). This
 * template gets the extra chrome — larger type, the gym/brand mark,
 * safe-zone padding for IG's top/bottom UI overlays — that would
 * fight the in-feed layout.
 *
 * `topThumbs` images are expected to be pre-inlined as data URLs by
 * the caller before mounting (see `useStoryShare`). Cross-origin
 * <img> elements rasterise as blank on iOS WKWebView when html-to-image
 * tries to inline them at capture time.
 */
import { forwardRef } from "react";
import type { WeeklyHighlightData } from "./WeeklyHighlightCard";

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;
const SAFE_TOP = 220; // IG top UI overlap zone
const SAFE_BOTTOM = 280;

// Bolder hall palette — matches WeeklyHighlightCard.SESSION_COLORS.
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

function colorFor(type: string): string {
  return SESSION_COLORS[type.toLowerCase().trim()] ?? "#6b7280";
}

function formatRange(startMs: number, endMs: number): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(new Date(startMs))} → ${fmt(new Date(endMs))}`;
}

interface Props {
  data: WeeklyHighlightData;
  /** Pre-inlined dataURLs corresponding to `data.topThumbs` in the same
   *  order. Always supply these — capturing from the network is fragile
   *  on iOS WKWebView under html-to-image. */
  inlinedThumbs: string[];
  displayName?: string;
}

export const WeeklyHighlightStoryTemplate = forwardRef<HTMLDivElement, Props>(
  function WeeklyHighlightStoryTemplate(
    { data, inlinedThumbs, displayName },
    ref,
  ) {
    const typeEntries = Object.entries(data.sessionTypes).sort(
      (a, b) => b[1] - a[1],
    );
    return (
      <div
        ref={ref}
        style={{
          width: STORY_WIDTH,
          height: STORY_HEIGHT,
          background:
            "radial-gradient(120% 80% at 50% 0%, #0a0a0a 0%, #050505 60%, #000 100%)",
          color: "#fff",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif',
          position: "relative",
          padding: `${SAFE_TOP}px 80px ${SAFE_BOTTOM}px 80px`,
          display: "flex",
          flexDirection: "column",
          gap: 48,
          boxSizing: "border-box",
        }}
      >
        {/* Title block */}
        <header>
          <p
            style={{
              fontSize: 28,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              fontWeight: 800,
              color: "rgba(255,255,255,0.7)",
              margin: 0,
            }}
          >
            Your week
          </p>
          <p
            style={{
              fontSize: 72,
              fontWeight: 800,
              lineHeight: 1.05,
              margin: "12px 0 0 0",
            }}
          >
            {displayName ?? "Training"}
          </p>
          <p
            style={{
              fontSize: 28,
              color: "rgba(255,255,255,0.7)",
              marginTop: 12,
            }}
          >
            {formatRange(data.weekStart, data.weekEnd)}
          </p>
        </header>

        {/* Collage */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <StoryCollage thumbs={inlinedThumbs} />
        </div>

        {/* Stats — centred */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 96,
          }}
        >
          <StoryStat label="Sessions" value={data.postCount} />
          <StoryStat label="Likes" value={data.likeTotal} />
          <StoryStat label="Comments" value={data.commentTotal} />
        </div>

        {/* Type breakdown chips */}
        {typeEntries.length > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            {typeEntries.map(([type, count]) => {
              const c = colorFor(type);
              return (
                <span
                  key={type}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 14,
                    fontSize: 28,
                    padding: "14px 24px",
                    borderRadius: 6,
                    background: `${c}1c`,
                    color: c,
                    border: `2px solid ${c}55`,
                    fontWeight: 600,
                  }}
                >
                  <span style={{ fontWeight: 800 }}>{count}</span>
                  <span style={{ textTransform: "capitalize" }}>{type}</span>
                </span>
              );
            })}
          </div>
        )}

        {/* Footer watermark */}
        <p
          style={{
            position: "absolute",
            bottom: 100,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 26,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.4)",
            fontWeight: 700,
            margin: 0,
          }}
        >
          WeightCut Wizard
        </p>
      </div>
    );
  },
);

function StoryStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <span
        style={{
          fontSize: 96,
          fontWeight: 800,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      <span
        style={{
          marginTop: 14,
          fontSize: 22,
          letterSpacing: "0.25em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.6)",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function StoryCollage({ thumbs }: { thumbs: string[] }) {
  if (thumbs.length === 0) return null;
  const n = thumbs.length;
  // Vertical space is abundant in 9:16 — go for bigger grids than the
  // in-feed card. Maintains the "every photo fits" guarantee.
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: 8,
        borderRadius: 32,
        overflow: "hidden",
        width: "100%",
        height: "100%",
      }}
    >
      {thumbs.map((u, i) => (
        <div
          key={i}
          style={{
            position: "relative",
            width: "100%",
            paddingBottom: "100%",
            overflow: "hidden",
          }}
        >
          <img
            src={u}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        </div>
      ))}
    </div>
  );
}
