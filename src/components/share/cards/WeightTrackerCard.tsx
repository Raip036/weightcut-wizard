import { forwardRef, useMemo } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";
import { usePremium } from "@/hooks/usePremium";

interface WeightLog {
  id: string;
  date: string;
  weight_kg: number;
}

interface WeightTrackerCardProps {
  weightLogs: WeightLog[];
  goalWeight?: number;
  timeFilter: string;
  aspect?: AspectRatio;
  transparent?: boolean;
}

// House share-card tokens. GREEN = the win (weight lost); AMBER = the wrong
// direction (gained); BLUE = supporting accent / the trend line.
const BLUE = "#4AB4ED";
const GREEN = "#34D399";
const AMBER = "#FBBF24";

const TIME_LABELS: Record<string, string> = {
  "1W": "Past Week",
  "1M": "Past Month",
  ALL: "All Time",
};

/** "#RRGGBB" + alpha (0..1) → "rgba(r,g,b,a)". */
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Premium floating weight trend — smooth area + line, gradient fill, a glowing
 * end-point dot, and a subtle dashed goal marker (no text). No box, no axes
 * clutter. Smoothing via quadratic midpoints. Capture-safe: no animation, no
 * SVG filters (gradient fill only).
 */
function WeightLine({
  data,
  goal,
  width,
  height,
  lineColor,
  dotColor,
  goalColor,
  idSuffix,
}: {
  data: number[];
  goal?: number;
  width: number;
  height: number;
  lineColor: string;
  dotColor: string;
  goalColor: string;
  idSuffix: string;
}) {
  if (data.length < 2) return null;

  const padY = height * 0.16;
  const padX = 10;
  const vals = goal != null ? [...data, goal] : data;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const x = (i: number) => padX + (i / (data.length - 1)) * (width - padX * 2);
  const y = (v: number) => padY + (1 - (v - min) / range) * (height - padY * 2);

  const pts = data.map((v, i) => ({ x: x(i), y: y(v) }));

  let line = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const cur = pts[i];
    const next = pts[i + 1];
    const midX = (cur.x + next.x) / 2;
    const midY = (cur.y + next.y) / 2;
    line += ` Q ${cur.x.toFixed(1)} ${cur.y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  line += ` L ${pts[pts.length - 1].x.toFixed(1)} ${pts[pts.length - 1].y.toFixed(1)}`;

  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${height} L ${pts[0].x.toFixed(1)} ${height} Z`;
  const end = pts[pts.length - 1];
  const gradId = `wl-fill-${idSuffix}`;

  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity={0.28} />
          <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
        </linearGradient>
      </defs>

      {goal != null && (
        <line
          x1={padX}
          y1={y(goal)}
          x2={width - padX}
          y2={y(goal)}
          stroke={goalColor}
          strokeWidth={2}
          strokeDasharray="2 10"
          strokeLinecap="round"
          opacity={0.6}
        />
      )}

      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke={lineColor} strokeWidth={Math.max(3, height * 0.018)} strokeLinecap="round" strokeLinejoin="round" />

      <circle cx={end.x} cy={end.y} r={Math.max(10, height * 0.05)} fill={hexA(dotColor, 0.25)} />
      <circle cx={end.x} cy={end.y} r={Math.max(6, height * 0.028)} fill={dotColor} />
    </svg>
  );
}

export const WeightTrackerCard = forwardRef<HTMLDivElement, WeightTrackerCardProps>(
  ({ weightLogs, goalWeight, timeFilter, aspect = "story", transparent }, ref) => {
    const { isPremium } = usePremium();
    const s = aspect === "story";

    const stats = useMemo(() => {
      if (weightLogs.length === 0) return null;
      const sorted = [...weightLogs].sort((a, b) => a.date.localeCompare(b.date));
      const first = sorted[0].weight_kg;
      const last = sorted[sorted.length - 1].weight_kg;
      const netChange = last - first;
      const weeks = Math.max(
        1,
        (new Date(sorted[sorted.length - 1].date).getTime() - new Date(sorted[0].date).getTime()) /
          (7 * 24 * 60 * 60 * 1000),
      );
      return { first, last, netChange, avgWeekly: netChange / weeks, series: sorted.map((l) => l.weight_kg) };
    }, [weightLogs]);

    if (!stats) return null;

    const losing = stats.netChange <= 0;
    const accent = losing ? GREEN : AMBER;
    const prefix = losing ? "" : "+";

    const StravaStat = ({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) => (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: s ? 8 : 5 }}>
        <span style={{ fontSize: s ? 28 : 16, fontWeight: 700, letterSpacing: "0.13em", textTransform: "uppercase", color: hexA(BLUE, 0.85) }}>
          {label}
        </span>
        <span style={{ fontSize: s ? 104 : 64, fontWeight: 900, color: color ?? "#fff", lineHeight: 0.9, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em" }}>
          {value}
          {unit && <span style={{ fontSize: s ? 42 : 26, fontWeight: 800, color: "rgba(255,255,255,0.4)", marginLeft: 5 }}>{unit}</span>}
        </span>
      </div>
    );

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPremium} transparent={transparent}>
        <div style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "center", gap: s ? 24 : 14 }}>
          {/* Hero net change */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: s ? 10 : 6 }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                color: accent,
                fontWeight: 900,
                letterSpacing: "-0.05em",
                lineHeight: 0.9,
                textShadow: `0 0 ${s ? 70 : 46}px ${hexA(accent, 0.4)}`,
              }}
            >
              <span style={{ fontSize: s ? 200 : 128, fontVariantNumeric: "tabular-nums" }}>
                {prefix}{stats.netChange.toFixed(1)}
              </span>
              <span style={{ fontSize: s ? 64 : 40, marginTop: s ? 28 : 18, marginLeft: s ? 8 : 5 }}>kg</span>
            </div>
            <div style={{ fontSize: s ? 26 : 16, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: hexA(accent, 0.9) }}>
              {losing ? "Down this " : "Up this "}{(TIME_LABELS[timeFilter] ?? timeFilter).toLowerCase()}
            </div>
          </div>

          {/* Floating trend — no box. */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <WeightLine
              data={stats.series}
              goal={goalWeight}
              width={s ? 960 : 600}
              height={s ? 420 : 260}
              lineColor={BLUE}
              dotColor={accent}
              goalColor={GREEN}
              idSuffix="weight-tracker"
            />
          </div>

          {/* Floating stats. */}
          <div style={{ display: "flex", justifyContent: "center", gap: s ? 52 : 30 }}>
            <StravaStat label="Start" value={stats.first.toFixed(1)} unit="kg" />
            <StravaStat label="Current" value={stats.last.toFixed(1)} unit="kg" color={accent} />
            <StravaStat label="Avg/wk" value={`${stats.avgWeekly <= 0 ? "" : "+"}${stats.avgWeekly.toFixed(1)}`} unit="kg" />
          </div>
        </div>
      </CardShell>
    );
  }
);

WeightTrackerCard.displayName = "WeightTrackerCard";
