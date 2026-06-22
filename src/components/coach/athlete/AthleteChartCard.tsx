/**
 * AthleteChartCard — the 2x2 grid tile. Tiny self-contained widget:
 * tracker label up top, big tabular value, sparkline, and a 1-line
 * change/sub-label below.
 *
 * Props are deliberately dumb — the parent passes pre-formatted strings
 * and a raw numeric array for the sparkline. That keeps the card free
 * of business logic and trivially reusable for any metric.
 *
 * The mount uses a fade + small lift driven by `motion/react`. The
 * parent passes `index` so cards stagger in (0 → 60 → 120 → 180ms).
 * `prefers-reduced-motion` collapses the animation.
 */
import { memo, useId, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";

export type ChartCardTone = "green" | "amber" | "red" | "neutral";

const TONE_STROKE: Record<ChartCardTone, string> = {
  green: "hsl(var(--func-recovery-green))",
  amber: "hsl(var(--func-warning-yellow))",
  red: "hsl(var(--func-danger-red))",
  neutral: "hsl(var(--primary))",
};

const TONE_TEXT: Record<ChartCardTone, string> = {
  green: "text-func-recovery-green",
  amber: "text-func-warning-yellow",
  red: "text-func-danger-red",
  neutral: "text-foreground",
};

interface Props {
  label: string;
  /** Big value — keep it pre-formatted (e.g. "72", "80.0 → 73.5") */
  value: string;
  /** Sub-label that sits to the right of (or below) the value. */
  valueSubLabel?: string;
  tone?: ChartCardTone;
  /** Raw numeric series, oldest → newest. Empty/<2 → renders "no data". */
  sparkline?: number[];
  /** Optional change copy (e.g. "+20% vs avg" or "-1.5kg/wk"). */
  changeText?: string;
  /** 0-based index used to stagger entry. */
  index?: number;
  className?: string;
}

function Sparkline({
  values,
  stroke,
  hasData,
}: {
  values: number[];
  stroke: string;
  hasData: boolean;
}) {
  const gradientId = useId();
  const w = 100;
  const h = 32;
  const pad = 2;

  const points = useMemo(() => {
    if (!hasData) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return values
      .map((v, i) => {
        const x =
          pad + (i / Math.max(1, values.length - 1)) * (w - 2 * pad);
        const y = h - pad - ((v - min) / range) * (h - 2 * pad);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [values, hasData]);

  if (!hasData) {
    return (
      <div className="h-8 flex items-center">
        <span className="text-[10px] text-muted-foreground/60">No data</span>
      </div>
    );
  }

  const lastIdx = values.length - 1;
  const lastX = pad + (lastIdx / Math.max(1, lastIdx)) * (w - 2 * pad);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const lastY = h - pad - ((values[lastIdx] - min) / range) * (h - 2 * pad);

  // Fill area pulls the sparkline towards the bottom with a soft fade.
  const areaPath = `M ${pad},${h - pad} L ${points
    .split(" ")
    .join(" L ")} L ${w - pad},${h - pad} Z`;

  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
      className="block"
      style={{ maxWidth: "100%" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r={1.8} fill={stroke} />
    </svg>
  );
}

export const AthleteChartCard = memo(function AthleteChartCard({
  label,
  value,
  valueSubLabel,
  tone = "neutral",
  sparkline = [],
  changeText,
  index = 0,
  className = "",
}: Props) {
  const reduced = useReducedMotion();
  const hasData = sparkline.length >= 2;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: (index * 0.06) }}
      className={`glass-card p-3.5 flex flex-col gap-2 min-h-[120px] ${className}`}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold leading-none">
        {label}
      </p>
      <div className="flex items-baseline gap-1.5 leading-none min-w-0 flex-wrap">
        <span
          className={`display-number text-[22px] tabular-nums ${TONE_TEXT[tone]}`}
        >
          {value}
        </span>
        {valueSubLabel && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {valueSubLabel}
          </span>
        )}
      </div>
      <div className="flex-1 min-h-[32px]">
        <Sparkline
          values={sparkline}
          stroke={TONE_STROKE[tone]}
          hasData={hasData}
        />
      </div>
      {changeText ? (
        <p className="text-[10px] text-muted-foreground tabular-nums leading-snug break-words">
          {changeText}
        </p>
      ) : (
        // Spacer to keep card height consistent when no change copy.
        <span className="text-[10px] leading-none opacity-0">·</span>
      )}
    </motion.div>
  );
});
