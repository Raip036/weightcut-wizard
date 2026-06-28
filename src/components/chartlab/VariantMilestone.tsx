// THROWAWAY chart-lab variant. Delete after sign-off.
// Direction: "Journey / Now-to-Target" — a smooth emerald ACTUAL line with soft
// area covers the past up to TODAY; from TODAY to TARGET a lighter dashed
// projection shows "the road left", anchored to today's dot and an emphasized
// target endpoint, with a faint vertical "now" guide.

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
} from "./mockData";

export default function VariantMilestone() {
  const s = buildScales(320, 140);

  // Past actual: every log ends at TODAY.
  const actualPath = smoothPath(project(SMOOTH_LOGS, s));

  // Soft area under the actual line: close the curve down to the baseline.
  const actualPts = project(SMOOTH_LOGS, s);
  const firstX = actualPts[0].x;
  const lastX = actualPts[actualPts.length - 1].x;
  const areaPath = `${actualPath} L${lastX.toFixed(2)},140 L${firstX.toFixed(
    2,
  )},140 Z`;

  // Remaining projection: from today's dot to the target. Prepend a point at
  // today so the dashed road starts exactly where the actual line ends.
  const remainingPts = [
    { ts: TODAY_TS, kg: CURRENT_KG },
    ...MOCK_PLAN.filter((p) => p.ts >= TODAY_TS),
  ];
  const remainingPath = smoothPath(project(remainingPts, s));

  // Key coordinates.
  const todayX = s.sx(TODAY_TS);
  const todayY = s.sy(CURRENT_KG);
  const targetX = s.sx(TARGET_TS);
  const targetY = s.sy(TARGET_KG);

  return (
    <div>
      <svg
        viewBox="0 0 320 140"
        preserveAspectRatio="none"
        className="w-full h-[140px] text-emerald-400"
      >
        <defs>
          <linearGradient id="vm-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.2} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Vertical "now" guide */}
        <line
          x1={todayX}
          y1={todayY}
          x2={todayX}
          y2={140}
          className="stroke-foreground/12"
          strokeWidth={1}
        />

        {/* Soft area under the actual line */}
        <path d={areaPath} fill="url(#vm-area)" stroke="none" />

        {/* The road left: remaining plan, lighter + dashed */}
        <path
          d={remainingPath}
          fill="none"
          className="stroke-foreground/35"
          strokeWidth={1.75}
          strokeDasharray="4 4"
          strokeLinecap="round"
        />

        {/* Past actual line */}
        <path
          d={actualPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Target endpoint, emphasized */}
        <circle
          cx={targetX}
          cy={targetY}
          r={5}
          className="stroke-foreground/40 fill-[hsl(var(--card))]"
          strokeWidth={1.5}
        />
        <circle cx={targetX} cy={targetY} r={2.5} className="fill-foreground/50" />

        {/* Today dot */}
        <circle cx={todayX} cy={todayY} r={6} className="fill-[hsl(var(--card))]" />
        <circle cx={todayX} cy={todayY} r={4} fill="currentColor" />
      </svg>

      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground/70 tabular-nums">
        <span>start {START_KG.toFixed(1)}</span>
        <span>target {TARGET_KG.toFixed(1)}</span>
      </div>
    </div>
  );
}
