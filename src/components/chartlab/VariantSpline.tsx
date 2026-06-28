// THROWAWAY chart-lab variant. Delete after sign-off.
// Direction: "Refined Spline + Soft Area" — the polished baseline upgrade.
// Key fix over production: a monotone smooth curve (no jagged daily segments)
// rendered on a taller, aspect-correct viewBox so it reads calm and premium.
import {
  MOCK_LOGS,
  SMOOTH_LOGS,
  MOCK_PLAN,
  START_KG,
  CURRENT_KG,
  TARGET_KG,
  TODAY_TS,
  TARGET_TS,
  buildScales,
  project,
  smoothPath,
} from "./mockData";

export default function VariantSpline() {
  const s = buildScales(320, 140);

  // Actual weight: smooth monotone curve (the calm-line upgrade).
  const actualPts = project(SMOOTH_LOGS, s);
  const actualPath = smoothPath(actualPts);

  // Soft area under the actual line: close the smooth path down to the baseline.
  const firstX = actualPts[0].x.toFixed(2);
  const lastX = actualPts[actualPts.length - 1].x.toFixed(2);
  const areaPath = `${actualPath} L${lastX},140 L${firstX},140 Z`;

  // Plan: muted dashed reference line.
  const planPath = smoothPath(project(MOCK_PLAN, s));

  // Markers.
  const [target] = project([{ ts: TARGET_TS, kg: TARGET_KG }], s);
  const [today] = project([{ ts: TODAY_TS, kg: CURRENT_KG }], s);

  return (
    <div className="text-emerald-400">
      <svg
        viewBox="0 0 320 140"
        preserveAspectRatio="none"
        className="w-full h-[140px]"
      >
        <defs>
          <linearGradient id="variant-spline-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Soft area fill under the actual line */}
        <path d={areaPath} fill="url(#variant-spline-area)" stroke="none" />

        {/* Plan reference (muted dashed) */}
        <path
          d={planPath}
          fill="none"
          className="stroke-foreground/25"
          strokeWidth={1.25}
          strokeDasharray="3 3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Actual weight line (smooth, emerald) */}
        <path
          d={actualPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Target marker: small hollow circle */}
        <circle
          cx={target.x}
          cy={target.y}
          r={3.5}
          className="fill-[hsl(var(--card))] stroke-foreground/40"
          strokeWidth={1.25}
        />

        {/* Today dot: glow + card halo + solid core */}
        <circle cx={today.x} cy={today.y} r={9} fill="currentColor" opacity={0.18} />
        <circle cx={today.x} cy={today.y} r={6} className="fill-[hsl(var(--card))]" />
        <circle cx={today.x} cy={today.y} r={4} fill="currentColor" />
      </svg>

      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground/70 tabular-nums">
        <span>start {START_KG.toFixed(1)}</span>
        <span>target {TARGET_KG.toFixed(1)}</span>
      </div>
    </div>
  );
}
