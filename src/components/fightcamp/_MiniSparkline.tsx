// Minimal inline SVG sparkline — used in collapsed metric rows to show a
// 7-point trend at a glance. Renders nothing when given an empty array; if
// every value is identical the polyline still draws as a flat midline.
//
// Underscore-prefixed filename signals "internal/shared util", reused by
// RecoveryDashboard's ExpandableMetricCard and the new DriverRow stack.

interface MiniSparklineProps {
  values: number[];
  /** Tailwind text-color class applied to the polyline via currentColor. */
  color: string;
  className?: string;
}

export function MiniSparkline({ values, color, className }: MiniSparklineProps) {
  if (!values.length) return null;
  const w = 64,
    h = 24,
    pad = 2;
  const min = Math.min(...values),
    max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = pad + (i / Math.max(1, values.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((v - min) / range) * (h - 2 * pad);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className={color}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
