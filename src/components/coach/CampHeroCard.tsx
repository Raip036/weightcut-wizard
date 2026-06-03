import { memo, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { AnimatedNumber } from "@/components/motion";
import { disciplineLabel, disciplineToken } from "@/lib/coachColors";
import { LevelRing } from "./LevelRing";
import { LevelSheet } from "./LevelSheet";

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

// SVG ring geometry. viewBox is a 0-100 square; the visual ring is scaled by
// the wrapper's width/height. A bigger focal ring (160px) than before.
const RING_VIEWBOX = 100;
const RING_RADIUS = 44;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_SIZE = 160;

// Flanking discipline level-ring size.
const DISC_RING_SIZE = 60;

/**
 * Camp hero — the headline block at the top of the Camp page for fighters
 * with an active camp. Centred vertical stack: camp name (Sora) → days-left →
 * the big fight-progress ring flanked by the user's top discipline level rings
 * → fight date → day-of-camp. On mount the main ring grows from 0 and every
 * number counts up, matching the nutrition page's load-animation language.
 *
 * The discipline rings replace the old standalone "Your level" card: tapping
 * either of them opens the same LevelSheet that card used to. The central
 * column (name / main ring / dates) taps through to the fight-camps surface.
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

  // Top disciplines by XP — one flanks each side of the main ring.
  const disciplines = useQuery(api.user_discipline_xp.getAllForUser);
  const [left, right] = (disciplines ?? []).slice(0, 2);
  const [levelSheetOpen, setLevelSheetOpen] = useState(false);

  const ariaLabel =
    `${campName} — Day ${elapsed} of ${totalDays}, ` +
    `${daysLeft} days remaining, ${phase.label} phase`;

  // A flanking discipline level ring + label. Tapping opens the LevelSheet.
  const DisciplineRing = ({
    row,
  }: {
    row: { sport: string; level: number; progress: number };
  }) => (
    <button
      type="button"
      onClick={() => setLevelSheetOpen(true)}
      aria-label={`${disciplineLabel(row.sport)} level ${row.level}`}
      className="flex flex-col items-center gap-1 active:scale-95 transition"
    >
      <LevelRing
        token={disciplineToken(row.sport)}
        level={row.level}
        progress={row.progress}
        size={DISC_RING_SIZE}
        strokeWidth={5}
      />
      <span
        className="text-[9px] font-bold uppercase tracking-[0.1em] leading-none"
        style={{ color: `hsl(var(${disciplineToken(row.sport)}))` }}
      >
        {disciplineLabel(row.sport)}
      </span>
    </button>
  );

  return (
    <div className="w-full flex flex-col items-center">
      {/* Camp name + days-left — taps through to the fight-camps surface. */}
      <button
        type="button"
        onClick={onTap}
        aria-label={ariaLabel}
        className="flex flex-col items-center active:scale-[0.99] transition"
      >
        <p className="font-display text-[24px] font-bold leading-tight tracking-tight text-foreground">
          {campName}
        </p>
        <p className="mt-1 text-[13px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
          <AnimatedNumber
            value={daysLeft}
            className="text-foreground font-bold tabular-nums"
          />{" "}
          days left
        </p>
      </button>

      {/* Ring row — the big fight-progress ring stays page-centred; the
          discipline level rings are absolutely pinned to either edge so a
          single side ring never shifts the main ring off-centre. */}
      <div className="relative mt-4 flex items-center justify-center">
        {left && (
          <div className="absolute inset-y-0 left-0 flex items-center">
            <DisciplineRing row={left} />
          </div>
        )}

        {/* Main fight-progress ring — phase-tinted via `phase.text` →
            `currentColor`. Grows from 0 on mount. Taps through to camp. */}
        <button
          type="button"
          onClick={onTap}
          aria-label={ariaLabel}
          className={`relative active:scale-[0.98] transition ${phase.text}`}
          style={{ width: RING_SIZE, height: RING_SIZE }}
        >
          <svg
            width={RING_SIZE}
            height={RING_SIZE}
            viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}
            className="-rotate-90"
          >
            <circle
              cx={RING_VIEWBOX / 2}
              cy={RING_VIEWBOX / 2}
              r={RING_RADIUS}
              stroke="currentColor"
              strokeOpacity={0.15}
              strokeWidth={6}
              fill="none"
            />
            <circle
              cx={RING_VIEWBOX / 2}
              cy={RING_VIEWBOX / 2}
              r={RING_RADIUS}
              stroke="currentColor"
              strokeWidth={6}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              className="transition-all duration-700 ease-out"
              style={{ filter: "drop-shadow(0 0 6px currentColor)" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <AnimatedNumber
              value={pctDisplay}
              format={(n) => `${Math.round(n)}%`}
              className="display-number text-foreground text-[38px] leading-none tabular-nums"
            />
          </div>
        </button>

        {right && (
          <div className="absolute inset-y-0 right-0 flex items-center">
            <DisciplineRing row={right} />
          </div>
        )}
      </div>

      {/* Fight date + day-of-camp — taps through to the fight-camps surface. */}
      <button
        type="button"
        onClick={onTap}
        aria-label={ariaLabel}
        className="mt-4 flex flex-col items-center active:scale-[0.99] transition"
      >
        <p className="text-[13px] text-muted-foreground">
          Fight:{" "}
          <span className="text-foreground/90 font-semibold">{fightLabel}</span>
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground tabular-nums">
          Day{" "}
          <AnimatedNumber
            value={elapsed}
            className="text-foreground/90 font-semibold tabular-nums"
          />{" "}
          of {totalDays}
        </p>
      </button>

      <LevelSheet open={levelSheetOpen} onOpenChange={setLevelSheetOpen} />
    </div>
  );
});
