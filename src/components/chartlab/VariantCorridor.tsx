// THROWAWAY chart-lab variant. Delete after sign-off.
// Direction "Plan Corridor": the plan is rendered as a soft translucent SAFE
// CORRIDOR band (±0.5 kg tolerance) rather than a thin dashed line, so staying
// inside the band reads as "on plan" pre-attentively. The smooth actual weight
// line rides through it.

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
  smoothPath,
  project,
  type Pt,
} from "./mockData";

const TOLERANCE_KG = 0.5;

/** Shift every plan vertex by `d` kg (keeps timestamps). */
const shiftPlan = (d: number): Pt[] =>
  MOCK_PLAN.map((p) => ({ ts: p.ts, kg: p.kg + d }));

export default function VariantCorridor() {
  const s = buildScales(320, 140);

  // Smooth upper/lower edges of the safe corridor.
  const upperPts = project(shiftPlan(TOLERANCE_KG), s);
  const lowerPts = project(shiftPlan(-TOLERANCE_KG), s);

  const upperPath = smoothPath(upperPts);
  const lowerPathFwd = smoothPath(lowerPts);

  // Stitch into one closed polygon: upper edge forward (smooth), then drop to the
  // lower edge and trace it back as straight L-segments to its first point, close.
  const reversedLower = [...lowerPts].reverse();
  const corridorPath =
    `${upperPath} ` +
    `L${reversedLower[0].x.toFixed(2)},${reversedLower[0].y.toFixed(2)} ` +
    reversedLower
      .slice(1)
      .map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(" ") +
    " Z";

  // Faint center plan line (dashed) through the corridor.
  const centerPath = smoothPath(project(MOCK_PLAN, s));

  // Actual weight line (calm monotone curve) + area fill under it for depth.
  const logPts = project(SMOOTH_LOGS, s);
  const actualPath = smoothPath(logPts);
  const areaPath =
    `${actualPath} ` +
    `L${logPts[logPts.length - 1].x.toFixed(2)},${(s.h - 1).toFixed(2)} ` +
    `L${logPts[0].x.toFixed(2)},${(s.h - 1).toFixed(2)} Z`;

  const todayX = s.sx(TODAY_TS);
  const todayY = s.sy(CURRENT_KG);
  const targetX = s.sx(TARGET_TS);
  const targetY = s.sy(TARGET_KG);

  return (
    <div className="w-full">
      <svg
        viewBox="0 0 320 140"
        preserveAspectRatio="none"
        className="w-full h-[140px] text-emerald-400"
      >
        <defs>
          <linearGradient id="corridorFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.1} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id="actualArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.16} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Safe corridor band */}
        <path
          d={corridorPath}
          className="fill-foreground/[0.06]"
          fill="url(#corridorFill)"
        />

        {/* Faint center plan line */}
        <path
          d={centerPath}
          fill="none"
          className="stroke-foreground/20"
          strokeWidth={1}
          strokeDasharray="3 4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Actual weight: area fill for depth */}
        <path d={areaPath} fill="url(#actualArea)" stroke="none" />

        {/* Actual weight: smooth line */}
        <path
          d={actualPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Target hollow marker */}
        <circle
          cx={targetX}
          cy={targetY}
          r={4}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />

        {/* Today dot with card-colored halo */}
        <circle cx={todayX} cy={todayY} r={6} className="fill-card" />
        <circle cx={todayX} cy={todayY} r={4} fill="currentColor" />
      </svg>

      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground/70 tabular-nums">
        <span>start {START_KG.toFixed(1)}</span>
        <span>target {TARGET_KG.toFixed(1)}</span>
      </div>
    </div>
  );
}
