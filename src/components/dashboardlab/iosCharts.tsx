// MOCKUP - iOS-native widget primitives for the /widget-lab redesign.
// Self-contained SVG chart parts (line, wave, ring, week strip). Throwaway;
// delete with the lab page after sign-off.

type Pt = { x: number; y: number };

/** Catmull-Rom → cubic bézier, for soft Apple-Health-style curves. */
function smoothPath(pts: Pt[]): string {
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

function toPoints(values: number[], w: number, h: number, padY = 6): Pt[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stride = values.length > 1 ? w / (values.length - 1) : 0;
  return values.map((v, i) => ({
    x: i * stride,
    y: padY + (1 - (v - min) / span) * (h - padY * 2),
  }));
}

/** A straight-ish trend line with a soft gradient fill below it (weight). */
export function TrendLine({
  values,
  color,
  smooth = false,
  height = 56,
  id,
}: {
  values: number[];
  color: string;
  smooth?: boolean;
  height?: number;
  id: string;
}) {
  const W = 200;
  const pts = toPoints(values, W, height);
  const line = smooth ? smoothPath(pts) : `M ${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ")}`;
  const area = `${line} L ${W} ${height} L 0 ${height} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#fill-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={3.2} fill={color} />
    </svg>
  );
}

/** Closed ring with a progress arc, centered count + unit (training). */
export function ProgressRing({
  progress,
  color,
  center,
  unit,
  size = 76,
}: {
  progress: number;
  color: string;
  center: string;
  unit?: string;
  size?: number;
}) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(1, Math.max(0, progress)));
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(0 0% 100% / 0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-display text-xl font-bold tracking-tight">{center}</span>
        {unit ? <span className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">{unit}</span> : null}
      </div>
    </div>
  );
}

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** iOS-style week dots with a "today" pill (training session days filled). */
export function WeekStrip({
  active,
  today,
  color,
}: {
  active: boolean[];
  today: number;
  color: string;
}) {
  return (
    <div className="flex items-end justify-between">
      {DAYS.map((d, i) => {
        const isToday = i === today;
        const on = active[i];
        return (
          <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
            <span
              className="flex h-1.5 w-1.5 items-center justify-center rounded-full transition-colors"
              style={{
                backgroundColor: on ? color : "hsl(0 0% 100% / 0.16)",
                boxShadow: isToday ? `0 0 0 3px ${color}33` : "none",
              }}
            />
            <span
              className="text-[10px] font-medium"
              style={{ color: isToday ? color : "hsl(var(--muted-foreground))" }}
            >
              {d}
            </span>
          </div>
        );
      })}
    </div>
  );
}
