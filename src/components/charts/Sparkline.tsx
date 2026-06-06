interface SparklineProps {
  /** Ordered series, oldest → newest. Needs >= 2 points to render. */
  data: number[];
  className?: string;
  /** Stroke colour. Defaults to the primary token; pass any CSS colour. */
  stroke?: string;
}

/**
 * Minimal SVG sparkline for the dashboard metric cards. No axes, labels or
 * tooltip — just a clean trend line. Generic over any numeric series (weight,
 * sleep hours, readiness…). Returns null with < 2 points so the caller can
 * render its own empty state.
 */
export default function Sparkline({
  data,
  className,
  stroke = "hsl(var(--primary))",
}: SparklineProps) {
  if (data.length < 2) return null;
  const W = 100;
  const H = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = W / (data.length - 1);
  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = H - ((v - min) / range) * H;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      width="100%"
      height="100%"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
