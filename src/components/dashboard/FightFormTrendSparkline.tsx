import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FightFormState } from "@/scoring/types";
import { isScoredState } from "@/lib/fightFormState";

type Point = {
  date: string;
  score: number;
  state: FightFormState;
};

type Props = {
  points: Point[] | null;
  // Combined accent classes ("stroke-… fill-…"). Falls back to a neutral ramp.
  accentClass?: string;
};

const Y_MIN = 0;
const Y_MAX = 100;
const PAD_Y = 7;
const PAD_X = 6;

// Catmull-Rom → cubic-bezier smoothing so the trend reads as a flowing line
// rather than a jagged polyline.
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export function FightFormTrendSparkline({ points, accentClass }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // Render at the container's real pixel size so the line + dot scale
  // uniformly (the old preserveAspectRatio="none" stretch squashed the dot
  // into an ellipse and flattened the stroke).
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 320, h: 48 });
  const uid = useId().replace(/:/g, "");

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth || 320, h: el.clientHeight || 48 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geom = useMemo(() => {
    if (!points || points.length === 0) return null;
    const okPoints = points.filter((p) => isScoredState(p.state));
    const series = okPoints.length > 0 ? okPoints : points;
    const { w, h } = size;
    const yOf = (score: number) =>
      h - PAD_Y - ((Math.max(Y_MIN, Math.min(Y_MAX, score)) - Y_MIN) / (Y_MAX - Y_MIN)) * (h - 2 * PAD_Y);

    if (series.length === 1) {
      return { single: true as const, cx: w / 2, cy: yOf(series[0].score), line: "", area: "" };
    }

    const stride = (w - 2 * PAD_X) / (series.length - 1);
    const pts = series.map((p, i) => ({ x: PAD_X + i * stride, y: yOf(p.score) }));
    const line = smoothPath(pts);
    const last = pts[pts.length - 1];
    const area = `${line} L ${last.x.toFixed(2)} ${h} L ${pts[0].x.toFixed(2)} ${h} Z`;
    return { single: false as const, cx: last.x, cy: last.y, line, area };
  }, [points, size]);

  if (!geom) {
    return (
      <div ref={wrapRef} className="flex items-center justify-center w-full h-full text-[11px] text-muted-foreground">
        Not enough data yet
      </div>
    );
  }

  // The class string carries both stroke-* and fill-*; line uses the stroke,
  // area + dots use the fill (each element opts out of the other).
  const accent = accentClass ?? "stroke-foreground/70 fill-foreground/90";
  const fadeId = `fftrend-fade-${uid}`;
  const maskId = `fftrend-mask-${uid}`;
  const { w, h } = size;

  return (
    <div ref={wrapRef} className="w-full h-full">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
        <defs>
          {/* Vertical white→transparent fade; masking the accent-filled area
              gives a soft gradient under the line without hard-coding a colour. */}
          <linearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.30" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={maskId}>
            <rect x="0" y="0" width={w} height={h} fill={`url(#${fadeId})`} />
          </mask>
        </defs>

        {/* Midline reference. */}
        <line
          x1={0}
          x2={w}
          y1={h / 2}
          y2={h / 2}
          className="stroke-border/40"
          strokeWidth={1}
          strokeDasharray="2 4"
        />

        {!geom.single && (
          <>
            <path d={geom.area} className={accent} stroke="none" mask={`url(#${maskId})`} />
            <path
              d={geom.line}
              className={accent}
              fill="none"
              strokeWidth={2.25}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}

        {/* Endpoint (or sole calibrating) dot with a soft halo. */}
        <circle cx={geom.cx} cy={geom.cy} r={7} className={accent} stroke="none" opacity={0.16} />
        <circle cx={geom.cx} cy={geom.cy} r={3} className={accent} stroke="none" />
      </svg>
    </div>
  );
}
