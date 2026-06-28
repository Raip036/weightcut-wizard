// THROWAWAY chart-lab variant. Delete after sign-off.
// Direction: "Minimal Apple Health" — thin smooth line, almost no area,
// generous whitespace, hairline baseline, tiny week tick labels.
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

export default function VariantMinimal() {
  const s = buildScales(320, 140);

  const actualD = smoothPath(project(SMOOTH_LOGS, s));
  const planD = smoothPath(project(MOCK_PLAN, s));

  const todayX = s.sx(TODAY_TS);
  const todayY = s.sy(CURRENT_KG);
  const targetX = s.sx(TARGET_TS);
  const targetY = s.sy(TARGET_KG);

  // Four evenly spaced week tick labels for the bottom row.
  const ticks = ["W1", "W2", "W3", "W4"];

  return (
    <div className="w-full">
      <svg
        viewBox="0 0 320 140"
        preserveAspectRatio="none"
        className="w-full h-[140px] text-emerald-400"
      >
        <defs>
          <linearGradient id="vm-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.1" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Hairline baseline near the bottom */}
        <line
          x1="0"
          y1="132"
          x2="320"
          y2="132"
          className="stroke-foreground/8"
          strokeWidth="1"
        />

        {/* Very subtle area beneath the actual line */}
        {actualD && (
          <path
            d={`${actualD} L${todayX.toFixed(2)},132 L${s
              .sx(MOCK_LOGS[0].ts)
              .toFixed(2)},132 Z`}
            fill="url(#vm-area)"
            stroke="none"
          />
        )}

        {/* Plan line — extremely subtle dashed guide */}
        <path
          d={planD}
          fill="none"
          className="stroke-foreground/15"
          strokeWidth="1"
          strokeDasharray="2 4"
          strokeLinecap="round"
        />

        {/* Actual trajectory — thin, calm, no glow */}
        <path
          d={actualD}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Target — tiny hollow ring */}
        <circle
          cx={targetX}
          cy={targetY}
          r="3"
          fill="none"
          className="stroke-foreground/30"
          strokeWidth="1"
        />

        {/* Today dot — minimal halo + core */}
        <circle cx={todayX} cy={todayY} r="5" fill="hsl(var(--card))" />
        <circle cx={todayX} cy={todayY} r="3" fill="currentColor" />
      </svg>

      {/* Week tick labels live outside the svg so preserveAspectRatio="none"
          doesn't distort the text. */}
      <div className="mt-1 flex justify-between px-1 text-[9px] uppercase tracking-wide text-muted-foreground/50">
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>

      {/* Start / target value row */}
      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground/70 tabular-nums">
        <span>start {START_KG.toFixed(1)}</span>
        <span>target {TARGET_KG.toFixed(1)}</span>
      </div>
    </div>
  );
}
