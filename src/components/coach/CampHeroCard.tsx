import { memo, useEffect, useState } from "react";
import { AnimatedNumber } from "@/components/motion";

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
// scaled by the wrapper's width/height. Stroke-width 7 inside a 100-unit
// box reads as a clean focal ring at 128px.
const RING_VIEWBOX = 100;
const RING_RADIUS = 44;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Camp hero — the headline block at the very top of the Camp page for
 * fighters with an active camp. Centred vertical stack: camp name (Sora) →
 * days-left → percentage progress ring → fight date → day-of-camp. On mount
 * the ring grows from 0 and every number counts up, matching the nutrition
 * page's load animation language.
 */
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

  // Mount-gate the arc so it grows from empty → target on load, riding the
  // CSS transition below (same pattern as the nutrition rings).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const dashOffset = RING_CIRCUMFERENCE * (1 - (mounted ? clampedPct : 0));

  const ariaLabel =
    `${campName} — Day ${elapsed} of ${totalDays}, ` +
    `${daysLeft} days remaining, ${phase.label} phase`;

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={ariaLabel}
      className="w-full text-center flex flex-col items-center active:scale-[0.99] transition"
    >
      {/* Camp name — Sora display face, centred directly under the page title. */}
      <p className="font-display text-[24px] font-bold leading-tight tracking-tight text-foreground">
        {campName}
      </p>

      {/* Days-left headline */}
      <p className="mt-1 text-[13px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
        <AnimatedNumber
          value={daysLeft}
          className="text-foreground font-bold tabular-nums"
        />{" "}
        days left
      </p>

      {/* Percentage progress ring — phase-tinted via `phase.text` →
          `currentColor`. Grows from 0 on mount. */}
      <div
        className={`relative mt-4 ${phase.text}`}
        style={{ width: 128, height: 128 }}
      >
        <svg
          width={128}
          height={128}
          viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}
          className="-rotate-90"
        >
          <circle
            cx={RING_VIEWBOX / 2}
            cy={RING_VIEWBOX / 2}
            r={RING_RADIUS}
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeWidth={7}
            fill="none"
          />
          <circle
            cx={RING_VIEWBOX / 2}
            cy={RING_VIEWBOX / 2}
            r={RING_RADIUS}
            stroke="currentColor"
            strokeWidth={7}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            className="transition-all duration-700 ease-out"
            style={{ filter: "drop-shadow(0 0 5px currentColor)" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <AnimatedNumber
            value={pctDisplay}
            format={(n) => `${Math.round(n)}%`}
            className="display-number text-foreground text-[30px] leading-none tabular-nums"
          />
        </div>
      </div>

      {/* Fight date */}
      <p className="mt-4 text-[13px] text-muted-foreground">
        Fight:{" "}
        <span className="text-foreground/90 font-semibold">{fightLabel}</span>
      </p>

      {/* Day-of-camp */}
      <p className="mt-1 text-[13px] text-muted-foreground tabular-nums">
        Day{" "}
        <AnimatedNumber
          value={elapsed}
          className="text-foreground/90 font-semibold tabular-nums"
        />{" "}
        of {totalDays}
      </p>
    </button>
  );
});
