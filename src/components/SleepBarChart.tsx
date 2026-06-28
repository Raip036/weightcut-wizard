// SleepBarChart — presentational weekly/period bar chart for the Sleep page.
//
// Pure SVG (no chart lib) styled to the approved "Calm" mockup: clean rounded
// bars with an 8h goal baseline, status-coloured (recovery-green ≥ goal-ish,
// warning-yellow below). Bars are status-coloured by the `good` threshold.
// Composited transforms only; honours prefers-reduced-motion via CSS.

interface SleepBarChartProps {
  /** Already date-sorted, oldest→newest. Each point feeds one bar. */
  data: { label: string; hours: number }[];
  /** Nightly goal used for the baseline + status colouring. Default 8. */
  goal?: number;
}

const CW = 300;
const CH = 110;
const PAD_T = 14; // headroom for the goal label
const PAD_B = 16; // room for day labels
const BAR_AREA = CH - PAD_T - PAD_B;

export function SleepBarChart({ data, goal = 8 }: SleepBarChartProps) {
  // Scale the y-axis to the taller of the goal or the best night so a great
  // night never clips above the goal line.
  const maxHours = Math.max(goal, ...data.map((d) => d.hours), 1);
  const baselineY = PAD_T + (1 - goal / maxHours) * BAR_AREA;

  // Bars get wider when there are fewer of them; cap so a long 3M range stays
  // readable as thin columns rather than overflowing.
  const n = data.length;
  const slot = n > 0 ? CW / n : CW;
  const bw = Math.max(2, Math.min(22, slot * 0.62));
  // Thin many-bar ranges drop their per-bar day label to avoid a crowded axis.
  const showLabels = n <= 14;

  return (
    <svg
      viewBox={`0 0 ${CW} ${CH}`}
      className="w-full"
      style={{ height: CH }}
      role="img"
      aria-label={`Nightly sleep hours, ${goal}h goal baseline`}
    >
      {/* 8h goal baseline */}
      <line
        x1={0}
        y1={baselineY}
        x2={CW}
        y2={baselineY}
        stroke="hsl(217 91% 58% / 0.35)"
        strokeWidth={1}
        strokeDasharray="2 4"
      />
      <text x={CW - 2} y={baselineY - 4} fontSize={8.5} fontWeight={700} fill="hsl(217 91% 58%)" textAnchor="end">
        {goal}H GOAL
      </text>

      {data.map((d, i) => {
        const x = slot * i + (slot - bw) / 2;
        const h = Math.max(2, (d.hours / maxHours) * BAR_AREA);
        const y = PAD_T + BAR_AREA - h;
        const good = d.hours >= goal - 1; // within an hour of goal reads as "on track"
        return (
          <g key={`${d.label}-${i}`}>
            <rect
              x={x}
              y={y}
              width={bw}
              height={h}
              rx={Math.min(5, bw / 2)}
              fill={good ? "hsl(217 91% 60%)" : "rgb(var(--func-warning-yellow))"}
              fillOpacity={good ? 0.92 : 0.85}
            />
            {showLabels && (
              <text
                x={x + bw / 2}
                y={CH - 4}
                fontSize={8}
                fill="hsl(0 0% 50%)"
                textAnchor="middle"
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default SleepBarChart;
