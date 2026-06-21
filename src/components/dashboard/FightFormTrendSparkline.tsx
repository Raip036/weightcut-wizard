import { useMemo } from "react";
import type { FightFormState } from "@/scoring/types";
import { isScoredState } from "@/lib/fightFormState";

type Point = {
  date: string;
  score: number;
  state: FightFormState;
};

type Props = {
  points: Point[] | null;
  // Optional accent, colors the line + endpoint dot. Falls back to the
  // foreground/60 ramp used elsewhere on the dashboard.
  accentClass?: string;
};

const WIDTH = 120;
const HEIGHT = 36;
const PAD_X = 4;
const PAD_Y = 4;
const Y_MIN = 0;
const Y_MAX = 100;

function buildPath(points: Point[]): { d: string; lastX: number; lastY: number } {
  if (points.length === 0) return { d: "", lastX: 0, lastY: 0 };
  const okPoints = points.filter((p) => isScoredState(p.state));
  const series = okPoints.length > 0 ? okPoints : points;
  const n = series.length;

  if (n === 1) {
    const cx = WIDTH / 2;
    const cy = HEIGHT - PAD_Y - ((series[0].score - Y_MIN) / (Y_MAX - Y_MIN)) * (HEIGHT - 2 * PAD_Y);
    return { d: `M ${cx} ${cy}`, lastX: cx, lastY: cy };
  }

  const stride = (WIDTH - 2 * PAD_X) / (n - 1);
  let d = "";
  let lastX = 0;
  let lastY = 0;
  for (let i = 0; i < n; i++) {
    const x = PAD_X + i * stride;
    const norm = (series[i].score - Y_MIN) / (Y_MAX - Y_MIN);
    const y = HEIGHT - PAD_Y - norm * (HEIGHT - 2 * PAD_Y);
    d += `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)} `;
    lastX = x;
    lastY = y;
  }
  return { d: d.trim(), lastX, lastY };
}

export function FightFormTrendSparkline({ points, accentClass }: Props) {
  const data = useMemo(() => {
    if (!points || points.length === 0) return null;
    return buildPath(points);
  }, [points]);

  const line = accentClass ?? "stroke-foreground/70";
  const dot = accentClass ?? "fill-foreground/90";

  if (!data || !data.d) {
    return (
      <div className="flex items-center justify-center w-full h-full text-[11px] text-muted-foreground">
        Not enough data yet
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="w-full h-full"
      aria-hidden
    >
      {/* Subtle 50-line so the user has a midline reference. */}
      <line
        x1={0}
        x2={WIDTH}
        y1={HEIGHT / 2}
        y2={HEIGHT / 2}
        className="stroke-border/40"
        strokeWidth={0.5}
        strokeDasharray="2 3"
      />
      <path d={data.d} className={line} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={data.lastX} cy={data.lastY} r={2} className={dot} />
    </svg>
  );
}
