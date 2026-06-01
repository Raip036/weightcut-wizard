import { memo } from "react";

/**
 * Camp progress info — matches CampActiveCampHero's existing shape so the
 * caller (Camp.tsx) can swap the import with no other edits. `elapsed` is
 * kept (not renamed to `elapsedDays`) and `fightLabel` is the pre-formatted
 * fight date string (e.g. "Jul 4, 2026").
 */
interface CampProgressInfo {
  daysLeft: number;
  elapsed: number;
  totalDays: number;
  pct: number;
  fightLabel: string;
}

interface PhaseInfo {
  /** Short phase label, e.g. "Build", "Peak", "Fight Week" */
  label: string;
  /** Tailwind bg class for the phase pill, e.g. "bg-primary/10" */
  bg: string;
  /** Tailwind text-color class — also drives the SVG arc via currentColor */
  text: string;
  /** Tailwind border class for the phase pill */
  border: string;
}

interface CampHeroCardProps {
  campName: string;
  campProgress: CampProgressInfo;
  phase: PhaseInfo;
  onTap: () => void;
}

// SVG ring geometry. viewBox is a 0-100 square; the visual ring is
// scaled by the wrapper's width/height (92px). Stroke-width 8 inside a
// 100-unit box reads as ~7.4px at 92px — matches the spec.
const RING_VIEWBOX = 100;
const RING_RADIUS = 42;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export const CampHeroCard = memo(function CampHeroCard({
  campName,
  campProgress,
  phase,
  onTap,
}: CampHeroCardProps) {
  const { daysLeft, elapsed, totalDays, pct, fightLabel } = campProgress;
  // Clamp progress so out-of-range pct values (e.g. >1 from a stale calc)
  // don't paint a backwards-rotating arc.
  const clampedPct = Math.max(0, Math.min(1, pct));
  const pctDisplay = Math.round(clampedPct * 100);
  const dashOffset = RING_CIRCUMFERENCE * (1 - clampedPct);

  const ariaLabel =
    `${campName} — Day ${elapsed} of ${totalDays}, ` +
    `${daysLeft} days remaining, ${phase.label} phase`;

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={ariaLabel}
      className="w-full text-left rounded-2xl card-surface card-press p-4 flex items-center gap-4 overflow-hidden"
    >
      {/* Left column — circular progress ring. Wrapper carries `phase.text`
          so `currentColor` inside the SVG resolves to the phase-tinted color
          (red/amber/blue). The track sits at 0.15 opacity of the same color
          so the ring reads as a single unified hue. */}
      <div
        className={`relative shrink-0 ${phase.text}`}
        style={{ width: 92, height: 92 }}
      >
        <svg
          width={92}
          height={92}
          viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}
          className="-rotate-90"
        >
          <circle
            cx={RING_VIEWBOX / 2}
            cy={RING_VIEWBOX / 2}
            r={RING_RADIUS}
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeWidth={8}
            fill="none"
          />
          <circle
            cx={RING_VIEWBOX / 2}
            cy={RING_VIEWBOX / 2}
            r={RING_RADIUS}
            stroke="currentColor"
            strokeWidth={8}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            className="transition-[stroke-dashoffset] duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="display-number text-foreground text-[22px] leading-none">
            {pctDisplay}%
          </span>
        </div>
      </div>

      {/* Right column — name + phase pill, days-left headline, fight date,
          and day-of progress. Min-width-0 + truncate on the name row so a
          long camp name doesn't push the phase pill off-card. */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-[19px] font-bold tracking-tight leading-tight truncate min-w-0">
            {campName}
          </p>
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="display-number text-[28px] leading-none tabular-nums text-foreground">
            {daysLeft}
          </span>
          <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
            days left
          </span>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Fight: <span className="text-foreground/90 font-semibold">{fightLabel}</span>
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">
          Day {elapsed} of {totalDays}
        </p>
      </div>
    </button>
  );
});
