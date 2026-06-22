import { useId } from "react";

interface SparklineProps {
  /** Ordered series, oldest → newest. Needs >= 2 points to render. */
  data: number[];
  className?: string;
  /** Stroke colour. Defaults to the primary token; pass any CSS colour. */
  stroke?: string;
  /** Draw the soft gradient area beneath the line. Default true. */
  fill?: boolean;
}

interface Pt {
  x: number;
  y: number;
}

/**
 * Builds a smooth path through `pts` using monotone cubic Hermite
 * interpolation (Fritsch–Carlson). Unlike a Catmull-Rom spline it never
 * overshoots the data, so peaks/troughs stay inside the box — the curve
 * reads as a clean, premium trend line rather than a wobbly one.
 */
function smoothLinePath(pts: Pt[]): string {
  const n = pts.length;
  if (n < 2) return "";
  if (n === 2) {
    return `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)} L ${pts[1].x.toFixed(2)},${pts[1].y.toFixed(2)}`;
  }

  // Secant slopes between consecutive points.
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = pts[i + 1].x - pts[i].x;
    dx.push(h);
    slope.push((pts[i + 1].y - pts[i].y) / h);
  }

  // Tangents at each point.
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0; // local extremum → flat tangent, no overshoot
    } else {
      m[i] = (slope[i - 1] + slope[i]) / 2;
    }
  }

  // Fritsch–Carlson monotonicity clamp.
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }

  let d = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i];
    const c1x = pts[i].x + h / 3;
    const c1y = pts[i].y + (m[i] * h) / 3;
    const c2x = pts[i + 1].x - h / 3;
    const c2y = pts[i + 1].y - (m[i + 1] * h) / 3;
    d += ` C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
  }
  return d;
}

/**
 * Minimal SVG sparkline for the dashboard metric cards. No axes, labels or
 * tooltip — just a clean, smooth trend line over a soft gradient wash.
 * Generic over any numeric series (weight, sleep hours, readiness…). Returns
 * null with < 2 points so the caller can render its own empty state.
 */
export default function Sparkline({
  data,
  className,
  stroke = "hsl(var(--primary))",
  fill = true,
}: SparklineProps) {
  const uid = useId().replace(/[:]/g, "");
  if (data.length < 2) return null;

  const W = 100;
  const H = 32;
  // Vertical breathing room so the round-capped stroke at a peak or trough is
  // never clipped by the viewBox edge.
  const PAD = 2.5;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = W / (data.length - 1);
  const pts: Pt[] = data.map((v, i) => ({
    x: i * stepX,
    y: PAD + (H - 2 * PAD) * (1 - (v - min) / range),
  }));

  const linePath = smoothLinePath(pts);
  const areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(2)},${H} L ${pts[0].x.toFixed(2)},${H} Z`;
  const fillId = `spark-fill-${uid}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      width="100%"
      height="100%"
      aria-hidden="true"
    >
      {fill && (
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="55%" stopColor={stroke} stopOpacity="0.06" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {fill && <path d={areaPath} fill={`url(#${fillId})`} stroke="none" />}
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
