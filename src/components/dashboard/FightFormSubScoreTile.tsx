import { useMemo } from "react";
import { useReducedMotion } from "motion/react";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

export type TrendPoint = { date: string; value: number };

type Props = {
  subKey: string;
  label: string;
  icon: IonIconName;
  value: number;
  /** Optional yesterday value for the delta chip. Omitted ⇒ chip hidden. */
  yesterdayValue?: number;
  /** Ascending series for the inline sparkline. Length < 2 ⇒ sparkline hidden. */
  trend?: TrendPoint[];
  expanded: boolean;
  onToggle: () => void;
};

// ─── Tier helpers ──────────────────────────────────────────────────────────
// Locked-in mapping from the brief. Bronze/Silver/Gold escalate with the
// numeric value. Anything below 40 is treated as "Building", explicitly
// not a tier, so we still acknowledge the user is logging without
// gamifying a low score.
type Tier = "gold" | "silver" | "bronze" | "building";

function tierFor(value: number): Tier {
  if (value >= 80) return "gold";
  if (value >= 60) return "silver";
  if (value >= 40) return "bronze";
  return "building";
}

const TIER_BADGE: Record<Tier, { label: string; className: string }> = {
  gold: { label: "Gold", className: "text-amber-300 bg-amber-500/10 border-amber-400/25" },
  silver: { label: "Silver", className: "text-slate-200 bg-slate-500/10 border-slate-300/25" },
  bronze: { label: "Bronze", className: "text-orange-300 bg-orange-700/15 border-orange-500/25" },
  building: { label: "Building", className: "text-muted-foreground bg-muted/20 border-border/40" },
};

// ─── Sparkline ─────────────────────────────────────────────────────────────
// Tiny SVG polyline confined to the tile footer. Uses currentColor so the
// surrounding tier-tinted className flows through. 0-100 domain matches the
// engine; we clamp anything off-range so a stale row can't blow the viewBox.
const SPARK_W = 80;
const SPARK_H = 18;

function buildSparkPath(points: TrendPoint[]): string | null {
  if (points.length < 2) return null;
  const n = points.length;
  const stride = SPARK_W / (n - 1);
  let d = "";
  for (let i = 0; i < n; i++) {
    const x = i * stride;
    const norm = Math.max(0, Math.min(100, points[i].value)) / 100;
    const y = SPARK_H - norm * SPARK_H;
    d += `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d.trim();
}

export function FightFormSubScoreTile({
  subKey,
  label,
  icon,
  value,
  yesterdayValue,
  trend,
  expanded,
  onToggle,
}: Props) {
  const prefersReducedMotion = useReducedMotion();
  const tier = tierFor(value);
  const badge = TIER_BADGE[tier];

  // Delta chip, only render when yesterday's value is known. ±0 still
  // surfaces (muted) so the user sees "steady" rather than nothing.
  const delta = useMemo(() => {
    if (yesterdayValue == null || !Number.isFinite(yesterdayValue)) return null;
    const d = Math.round(value - yesterdayValue);
    return d;
  }, [value, yesterdayValue]);

  const deltaClass =
    delta == null
      ? ""
      : delta > 0
        ? "text-func-recovery-green bg-func-recovery-green/10"
        : delta < 0
          ? "text-func-danger-red bg-func-danger-red/10"
          : "text-muted-foreground bg-muted/30";

  const sparkPath = useMemo(() => buildSparkPath(trend ?? []), [trend]);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={`subscore-detail-${subKey}`}
      className={cn(
        "card-surface rounded-xs border border-border/50 p-3 text-left",
        "flex flex-col gap-1.5 transition-colors",
        "active:scale-[0.98]",
        expanded && "border-primary/40 bg-primary/5",
      )}
    >
      {/* Top, icon + label */}
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon name={icon} size={14} />
        <span className="text-micro font-semibold uppercase tracking-[0.06em]">
          {label}
        </span>
      </div>

      {/* Middle, big number + delta chip */}
      <div className="flex items-baseline justify-between gap-1.5">
        {prefersReducedMotion ? (
          <span className="font-display font-bold text-[28px] leading-none text-foreground tabular-nums">
            {Math.round(value)}
          </span>
        ) : (
          <AnimatedNumber
            value={value}
            className="font-display font-bold text-[28px] leading-none text-foreground tabular-nums"
          />
        )}
        {delta != null && (
          <span
            className={cn(
              "text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full leading-none",
              deltaClass,
            )}
          >
            {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
            {Math.abs(delta)}
          </span>
        )}
      </div>

      {/* Tier badge */}
      <div className="flex items-center justify-between gap-1.5">
        <span
          className={cn(
            "text-[10px] font-semibold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-xs border leading-none",
            badge.className,
          )}
        >
          {badge.label}
        </span>
        {/* Sparkline pinned to the right so the badge breathes. Hidden
            when we don't have at least 2 points, no fallback bar. */}
        {sparkPath && (
          <svg
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            preserveAspectRatio="none"
            className={cn(
              "h-[18px] w-[60%] max-w-[80px]",
              tier === "gold" && "text-amber-300/80",
              tier === "silver" && "text-slate-300/80",
              tier === "bronze" && "text-orange-300/80",
              tier === "building" && "text-muted-foreground/70",
            )}
            aria-hidden
          >
            <path
              d={sparkPath}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>

      {/* Chevron affordance so the tap target is obvious. CSS rotate
          keeps reduced-motion users from rendering a motion subtree. */}
      <div className="flex items-center justify-end">
        <Icon
          name="chevronForwardOutline"
          size={12}
          className={cn(
            "text-muted-foreground/50 transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
      </div>
    </button>
  );
}
