/**
 * ExerciseProgressCard: shareable image card for a single lift's progression.
 *
 * Visual language mirrors `TrainingCalendarCard`:
 *  - FightCamp Wizard brand header (from CardShell)
 *  - Centred period label (the exercise name, uppercase)
 *  - Three big Strava-style stats stacked vertically (Heaviest PR, Best Set,
 *    Max Reps) with huge bold white numbers
 *  - Graphic at the bottom: per-session progression curve (SVG area chart of
 *    the heaviest working-set weight per session)
 *
 * The bottom chart is hand-rolled SVG (not recharts) so html-to-image can
 * snapshot it without waiting for chart layout, matching the rest of the
 * share cards, which all rasterise deterministically.
 *
 * Bodyweight exercises (every set has `is_bodyweight` or `weight_kg=0`) flip
 * the chart to plot reps instead of weight, and the unit on the stats row
 * becomes "reps" rather than "kg".
 */
import { forwardRef, useMemo } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";
import { StravaStat, StravaPeriodLabel } from "../templates/StravaStat";
import { usePremium } from "@/hooks/usePremium";
import type { GymSet } from "@/pages/gym/types";

interface ExerciseProgressCardProps {
  exerciseName: string;
  muscleGroup?: string;
  sets: GymSet[];
  aspect?: AspectRatio;
  transparent?: boolean;
}

interface SessionPoint {
  date: string;
  topWeight: number;
  topReps: number;
}

function formatWeightLabel(kg: number): string {
  if (kg <= 0) return "-";
  return kg % 1 === 0 ? `${kg}` : kg.toFixed(1);
}

function formatBestSet(topWeight: number, topReps: number, isBodyweight: boolean): string {
  if (isBodyweight) return `${topReps}`;
  if (topWeight <= 0) return `${topReps}`;
  return `${formatWeightLabel(topWeight)} × ${topReps}`;
}

function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  } catch {
    return "";
  }
}

/** Collapse the flat set list into one point per session (keyed by date),
 *  keeping the heaviest working set's weight and reps for that day. We rely
 *  on `created_at` being trustworthy enough to date-bucket; the underlying
 *  query already orders by it. */
function aggregateByDate(sets: GymSet[]): SessionPoint[] {
  const buckets = new Map<string, SessionPoint>();
  for (const s of sets) {
    if (s.is_warmup) continue;
    const day = (s.created_at ?? "").slice(0, 10);
    if (!day) continue;
    const w = s.weight_kg ?? 0;
    const r = s.reps ?? 0;
    const prev = buckets.get(day);
    if (!prev) {
      buckets.set(day, { date: day, topWeight: w, topReps: r });
    } else if (w > prev.topWeight || (w === prev.topWeight && r > prev.topReps)) {
      prev.topWeight = w;
      prev.topReps = r;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export const ExerciseProgressCard = forwardRef<HTMLDivElement, ExerciseProgressCardProps>(
  ({ exerciseName, muscleGroup, sets, aspect = "story", transparent }, ref) => {
    const { isPremium } = usePremium();
    const s = aspect === "story";

    const { stats, points, isBodyweight, percentChange } = useMemo(() => {
      const working = sets.filter((set) => !set.is_warmup);
      const isBw = working.length > 0 && working.every((set) => set.is_bodyweight || (set.weight_kg ?? 0) === 0);

      let maxWeight = 0;
      let maxReps = 0;
      let bestSet: { weight: number; reps: number } = { weight: 0, reps: 0 };
      for (const set of working) {
        const w = set.weight_kg ?? 0;
        const r = set.reps ?? 0;
        if (w > maxWeight) maxWeight = w;
        if (r > maxReps) maxReps = r;
        if (w > bestSet.weight || (w === bestSet.weight && r > bestSet.reps)) {
          bestSet = { weight: w, reps: r };
        }
      }

      const pts = aggregateByDate(sets);

      // % progress vs first logged session: gives the headline "how much
      // stronger over time" the user asked for, and works for both weight
      // and bodyweight (rep-based) progression.
      let pct: number | null = null;
      if (pts.length >= 2) {
        const first = isBw ? pts[0].topReps : pts[0].topWeight;
        const last = isBw ? pts[pts.length - 1].topReps : pts[pts.length - 1].topWeight;
        if (first > 0) pct = ((last - first) / first) * 100;
      }

      return {
        stats: { maxWeight, maxReps, bestSet },
        points: pts,
        isBodyweight: isBw,
        percentChange: pct,
      };
    }, [sets]);

    const heaviestValue = isBodyweight ? String(stats.maxReps || 0) : formatWeightLabel(stats.maxWeight);
    const heaviestUnit = isBodyweight ? "reps" : "kg";
    const bestSetValue = formatBestSet(stats.bestSet.weight, stats.bestSet.reps, isBodyweight);
    const bestSetUnit = isBodyweight ? "reps" : undefined;
    const maxRepsValue = String(stats.maxReps || 0);

    const subline = useMemo(() => {
      if (points.length === 0) return null;
      const firstDate = formatDateShort(points[0].date);
      const lastDate = formatDateShort(points[points.length - 1].date);
      const sessionCount = points.length;
      return `${firstDate} → ${lastDate} · ${sessionCount} sessions`;
    }, [points]);

    // All on-card text is uniformly bumped 20% larger for Instagram-story
    // legibility. Title font, muscle-group subline, stat sizes (via the
    // StravaStat `scale` prop), chart corner labels, and the date subline
    // are all multiplied by this single constant, keeping the relative
    // hierarchy intact while reading much bigger on phone screens.
    const TEXT_SCALE = 1.2;
    const px = (n: number) => Math.round(n * TEXT_SCALE);

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPremium} transparent={transparent}>
        {/* `textAlign: center` on the root locks every inline text node and
            every block child (via `margin: auto` defaults) to the card's
            vertical centreline, including the stat values whose visual
            widths differ ("12" vs "100 × 5"). Each StravaStat then self-
            centres its own label/value as its own intrinsic block. */}
        <div style={{ display: "flex", flexDirection: "column", height: "100%", textAlign: "center", alignItems: "center" }}>
          {/* Title: exercise name as a proper hero headline, centred. The
              muscle-group sub-line lives directly under it so the eye reads
              "what lift, what muscle" before scanning the stats. */}
          <div style={{ width: "100%", textAlign: "center" }}>
            <div
              style={{
                fontSize: px(s ? 64 : 30),
                fontWeight: 800,
                letterSpacing: "-0.02em",
                lineHeight: 1.05,
                color: "#ffffff",
                padding: s ? "0 24px" : "0 16px",
              }}
            >
              {exerciseName}
            </div>
            {muscleGroup && (
              <div
                style={{
                  marginTop: s ? 12 : 6,
                  fontSize: px(s ? 22 : 13),
                  color: transparent ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.55)",
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  paddingLeft: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                {muscleGroup.replace(/_/g, " ")}
              </div>
            )}
          </div>

          <div style={{ flex: 1, minHeight: s ? 24 : 8 }} />

          {/* Hero stats: heaviest, best set, progress %. Wrapper is a
              full-width centred column so every stat aligns to the same
              centreline regardless of its value width. `scale` plumbs the
              20% type bump into StravaStat's internal sizes. */}
          <div
            style={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              gap: px(s ? 28 : 12),
            }}
          >
            <StravaStat
              label={isBodyweight ? "Max Reps PR" : "Heaviest"}
              value={heaviestValue}
              unit={heaviestUnit}
              s={s}
              transparent={transparent}
              scale={TEXT_SCALE}
            />
            <StravaStat
              label="Best Set"
              value={bestSetValue}
              unit={bestSetUnit}
              s={s}
              transparent={transparent}
              scale={TEXT_SCALE}
            />
            {/* Headline number that shows "strength increasing" over time.
                falls back to absolute max reps when we don't yet have two
                sessions to diff. */}
            {percentChange !== null ? (
              <StravaStat
                label={percentChange >= 0 ? "Progress" : "Change"}
                value={`${percentChange >= 0 ? "+" : ""}${percentChange.toFixed(0)}%`}
                s={s}
                transparent={transparent}
                accentColor={percentChange >= 0 ? "#39d353" : "#f97316"}
                scale={TEXT_SCALE}
              />
            ) : (
              <StravaStat
                label="Max Reps"
                value={maxRepsValue}
                s={s}
                transparent={transparent}
                scale={TEXT_SCALE}
              />
            )}
          </div>

          <div style={{ flex: 1, minHeight: s ? 24 : 8 }} />

          {/* Bottom graphic: progression curve. Wrapper is full-width so the
              chart spans edge-to-edge while the date subline beneath it stays
              centred to the card. */}
          <div style={{ width: "100%", textAlign: "center" }}>
            <ProgressionChart points={points} isBodyweight={isBodyweight} s={s} transparent={transparent} textScale={TEXT_SCALE} />
            {subline && (
              <div
                style={{
                  textAlign: "center",
                  marginTop: s ? 18 : 8,
                  fontSize: px(s ? 18 : 12),
                  color: transparent ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.5)",
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  paddingLeft: "0.05em",
                }}
              >
                {subline}
              </div>
            )}
          </div>
        </div>
      </CardShell>
    );
  },
);

ExerciseProgressCard.displayName = "ExerciseProgressCard";

/* ─── Progression chart ─── */
interface ProgressionChartProps {
  points: SessionPoint[];
  isBodyweight: boolean;
  s: boolean;
  transparent?: boolean;
  /** Multiplier applied to text-only sizes inside the chart (corner value
   *  labels, empty-state message). Curve geometry stays unscaled. */
  textScale?: number;
}

/** Hand-rolled SVG area chart so html-to-image snapshots without waiting on
 *  recharts layout. Uses a smooth monotone-ish line by joining points with
 *  cubic Béziers anchored at the midpoints, so the curve never overshoots a
 *  data point, so it's safe for honest progression copy. */
function ProgressionChart({ points, isBodyweight, s, transparent, textScale = 1 }: ProgressionChartProps) {
  const width = 960;
  const height = s ? 360 : 200;
  const padX = s ? 40 : 24;
  const padY = s ? 32 : 18;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const accent = "#39d353";
  const accentFill = "rgba(57, 211, 83, 0.18)";

  if (points.length < 2) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: Math.round((s ? 22 : 14) * textScale),
          color: transparent ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.4)",
          letterSpacing: "0.05em",
          fontWeight: 600,
          background: transparent ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.03)",
          border: transparent ? "1px solid rgba(255,255,255,0.15)" : "1px solid rgba(255,255,255,0.06)",
          borderRadius: s ? 24 : 12,
        }}
      >
        Log more sessions to see your curve
      </div>
    );
  }

  const values = points.map((p) => (isBodyweight ? p.topReps : p.topWeight));
  const maxV = Math.max(...values);
  const minV = Math.min(...values);
  const range = maxV - minV || 1;

  // Linear x-scale by index: datestamps would compress recent sessions if a
  // user has a multi-month gap, and the bottom subline already shows the
  // date span so equal spacing reads as "session #1 → #N" cleanly.
  const xAt = (i: number) =>
    padX + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yAt = (v: number) => padY + innerH - ((v - minV) / range) * innerH;

  // Build smooth path using cubic Béziers anchored to midpoints between
  // adjacent points. This guarantees the curve passes through every data
  // point (overshoots only along the spline, which we damp).
  let linePath = `M ${xAt(0)} ${yAt(values[0])}`;
  for (let i = 1; i < points.length; i++) {
    const x0 = xAt(i - 1);
    const y0 = yAt(values[i - 1]);
    const x1 = xAt(i);
    const y1 = yAt(values[i]);
    const cx = (x0 + x1) / 2;
    linePath += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
  }
  // Close the area to the baseline so we can fill below the line.
  const areaPath = `${linePath} L ${xAt(points.length - 1)} ${padY + innerH} L ${xAt(0)} ${padY + innerH} Z`;

  // Dot at the latest point so the eye lands on "where you are now".
  const lastIdx = points.length - 1;
  const lastX = xAt(lastIdx);
  const lastY = yAt(values[lastIdx]);

  return (
    <div
      style={{
        background: transparent ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.03)",
        border: transparent ? "1px solid rgba(255,255,255,0.15)" : "1px solid rgba(255,255,255,0.06)",
        borderRadius: s ? 24 : 12,
        padding: s ? "32px 16px" : "12px 10px",
      }}
    >
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width, display: "block" }}>
        {/* Baseline */}
        <line
          x1={padX}
          y1={padY + innerH}
          x2={width - padX}
          y2={padY + innerH}
          stroke={transparent ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.12)"}
          strokeWidth={2}
        />

        {/* Area under the curve */}
        <path d={areaPath} fill={accentFill} />

        {/* Line */}
        <path d={linePath} fill="none" stroke={accent} strokeWidth={s ? 6 : 3.5} strokeLinecap="round" strokeLinejoin="round" />

        {/* Latest-point dot */}
        <circle cx={lastX} cy={lastY} r={s ? 14 : 8} fill={accent} stroke="#0a0a0a" strokeWidth={s ? 4 : 2} />

        {/* Min / max value labels: show the start and end values so the
            jump is readable without a y-axis. */}
        <text
          x={padX}
          y={padY - (s ? 8 : 4)}
          fontSize={Math.round((s ? 22 : 13) * textScale)}
          fontWeight={700}
          fill={transparent ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.55)"}
        >
          {formatWeightLabel(values[0])}{isBodyweight ? "" : " kg"}
        </text>
        <text
          x={width - padX}
          y={padY - (s ? 8 : 4)}
          fontSize={Math.round((s ? 22 : 13) * textScale)}
          fontWeight={700}
          textAnchor="end"
          fill="#ffffff"
        >
          {formatWeightLabel(values[lastIdx])}{isBodyweight ? "" : " kg"}
        </text>
      </svg>
    </div>
  );
}
