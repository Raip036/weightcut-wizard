import { memo, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { Icon } from "@/components/ui/Icon";
import { AnimatedNumber } from "@/components/motion";
import { disciplineLabel, disciplineToken } from "@/lib/coachColors";
import { LevelRing } from "./LevelRing";
import { LevelSheet } from "./LevelSheet";

/**
 * Camp progress info. Matches CampActiveCampHero's existing shape so the
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
  /** Tailwind text-color class, also drives the SVG arc via currentColor */
  text: string;
  /** Tailwind border class for the phase pill */
  border: string;
}

interface CampHeroCardProps {
  campName: string;
  campProgress: CampProgressInfo;
  phase: PhaseInfo;
  /** Tap target for the camp identity / countdown → the fight-camps surface. */
  onTap: () => void;
  /** Optional: navigate to the canonical cut/weight plan timeline. When
   *  provided, a "View full plan" link is shown in the trajectory footer. */
  onViewPlan?: () => void;
}

const DISC_RING_SIZE = 48;

/**
 * Camp hero — the headline block at the top of the Camp page for fighters
 * with an active camp. Boxless (sits directly on the page, no card surface):
 *
 *   camp name + fight date · bold phase label
 *   ↓
 *   big "days to fight" countdown (counts up on mount)
 *   ↓
 *   Discipline XP — a horizontal-scrolling strip of level rings that scales
 *   to any number of disciplines
 *   ↓
 *   camp trajectory bar (Build → Peak → Fight week) with a "you are here"
 *   node whose position is `elapsed / total`, so it travels along as the
 *   camp progresses. The fill + node slide into place on mount.
 *
 * Tapping the identity/countdown opens the fight-camps surface; tapping a
 * discipline ring opens the same LevelSheet the old "Your level" card used.
 */
export const CampHeroCard = memo(function CampHeroCard({
  campName,
  campProgress,
  phase,
  onTap,
  onViewPlan,
}: CampHeroCardProps) {
  const { daysLeft, elapsed, totalDays, pct, fightLabel } = campProgress;
  // Clamp progress so out-of-range pct values don't paint past the track end.
  const clampedPct = Math.max(0, Math.min(1, pct));
  const pctDisplay = Math.round(clampedPct * 100);

  // Phase boundaries as fractions of the whole camp, derived from the same
  // day thresholds as derivePhase(): Peak begins 14 days out, Fight week 7.
  const peakStart = Math.max(0, Math.min(1, (totalDays - 14) / totalDays));
  const fwStart = Math.max(0, Math.min(1, (totalDays - 7) / totalDays));

  // What's the next milestone the fighter is counting toward?
  const nextLabel =
    daysLeft > 14
      ? `${daysLeft - 14} days to Peak`
      : daysLeft > 7
        ? `${daysLeft - 7} days to Fight week`
        : "Fight week";

  // Mount-gate the trajectory + discipline arcs so they animate from empty →
  // target on load, matching the count-up on the big number.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // All disciplines (not just two), newest/most-XP first as returned.
  const disciplines = useQuery(api.user_discipline_xp.getAllForUser) ?? [];
  const [levelSheetOpen, setLevelSheetOpen] = useState(false);

  const ariaLabel =
    `${campName}, Day ${elapsed} of ${totalDays}, ` +
    `${daysLeft} days remaining, ${phase.label} phase`;

  return (
    <div className="relative w-full">
      {/* Ambient glow — a soft radial wash that anchors the countdown to the
          page without drawing a container. Pure gradient (no blur()) so it
          survives the native-app perf stripping. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-4 -left-8 h-56 w-80"
        style={{
          background:
            "radial-gradient(closest-side, hsl(var(--primary) / 0.18), transparent 72%)",
        }}
      />

      {/* Identity row: camp name + fight date | bold phase label */}
      <div className="relative flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onTap}
          aria-label={ariaLabel}
          className="flex flex-col items-start text-left active:scale-[0.99] transition"
        >
          <p className="font-display text-[17px] font-semibold leading-tight tracking-tight text-foreground">
            {campName}
          </p>
          <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <Icon name="calendarOutline" size={13} className="flex-shrink-0" />
            Fight night · {fightLabel}
          </span>
        </button>
        <span
          className={`font-display text-[13px] font-bold tracking-wide whitespace-nowrap pt-0.5 ${phase.text}`}
        >
          {phase.label} phase
        </span>
      </div>

      {/* Countdown — big days-to-fight numeral, counts up on mount. */}
      <button
        type="button"
        onClick={onTap}
        aria-label={ariaLabel}
        className="relative mt-3 flex items-baseline gap-3 active:scale-[0.99] transition"
      >
        <AnimatedNumber
          value={daysLeft}
          className="display-number font-display font-extrabold bg-gradient-to-b from-white to-[#cfe0ff] bg-clip-text text-transparent text-[78px] sm:text-[92px] leading-none tracking-[-0.04em] tabular-nums pt-[0.06em]"
          // textShadow draws a glyph-shaped glow even through the transparent
          // gradient fill; it isn't blur()/box-shadow so it isn't stripped.
        />
        <span className="pb-2.5 text-left">
          <span className="block font-display text-[16px] font-semibold leading-tight text-foreground">
            days to fight
          </span>
          <span className="mt-0.5 block text-[13px] text-muted-foreground tabular-nums">
            Day{" "}
            <AnimatedNumber value={elapsed} className="tabular-nums" /> of{" "}
            {totalDays} ·{" "}
            <AnimatedNumber value={pctDisplay} className="tabular-nums" />%
            complete
          </span>
        </span>
      </button>

      {/* Discipline XP — horizontal-scrolling strip, scales to any count. The
          right edge is masked to a soft fade so overflow reads as scrollable. */}
      {disciplines.length > 0 && (
        <>
          <p className="relative mt-5 mb-3 text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground/60">
            Discipline XP
          </p>
          <div
            className="relative flex gap-5 overflow-x-auto scrollbar-hide pb-1"
            style={{
              WebkitMaskImage:
                "linear-gradient(90deg, #000 92%, transparent)",
              maskImage: "linear-gradient(90deg, #000 92%, transparent)",
            }}
          >
            {disciplines.map((row) => (
              <button
                key={row.sport}
                type="button"
                onClick={() => setLevelSheetOpen(true)}
                aria-label={`${disciplineLabel(row.sport)} level ${row.level}`}
                className="flex flex-shrink-0 flex-col items-center gap-1.5 active:scale-95 transition"
              >
                <LevelRing
                  token={disciplineToken(row.sport)}
                  level={row.level}
                  progress={mounted ? row.progress : 0}
                  size={DISC_RING_SIZE}
                  strokeWidth={4}
                />
                <span
                  className="text-[10px] font-bold uppercase tracking-[0.04em] leading-none whitespace-nowrap"
                  style={{ color: `hsl(var(${disciplineToken(row.sport)}))` }}
                >
                  {disciplineLabel(row.sport)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Trajectory (signature) — Build → Peak → Fight week, with a node at
          today's position that slides in on mount and tracks elapsed/total. */}
      <div className="relative mt-5 border-t border-white/[0.07] pt-4">
        <div className="mb-3 flex justify-between text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/60">
          <span className="text-primary">Camp start · now</span>
          <span>Peak</span>
          <span>Fight week</span>
        </div>

        <div className="relative mx-1 h-1.5 rounded-full bg-white/[0.07]">
          {/* phase segments */}
          <div
            className="absolute top-0 h-1.5 rounded-full bg-gradient-to-r from-primary/60 to-primary/20"
            style={{ left: 0, width: `${peakStart * 100}%` }}
          />
          <div
            className="absolute top-0 h-1.5 rounded-full bg-muted-foreground/25"
            style={{ left: `${peakStart * 100}%`, width: `${(fwStart - peakStart) * 100}%` }}
          />
          <div
            className="absolute top-0 h-1.5 rounded-full bg-red-500/40"
            style={{ left: `${fwStart * 100}%`, width: `${(1 - fwStart) * 100}%` }}
          />
          {/* phase boundary ticks */}
          <span className="absolute -top-1 h-3.5 w-px bg-white/20" style={{ left: `${peakStart * 100}%` }} />
          <span className="absolute -top-1 h-3.5 w-px bg-white/20" style={{ left: `${fwStart * 100}%` }} />
          {/* progress fill (camp start → today) */}
          <div
            className="absolute top-0 h-1.5 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.7)] transition-[width] duration-[1200ms] ease-out"
            style={{ width: mounted ? `${clampedPct * 100}%` : "0%" }}
          />
          {/* you-are-here node */}
          <span
            className="absolute top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_5px_hsl(var(--primary)/0.18),0_0_16px_hsl(var(--primary)/0.9)] transition-[left] duration-[1200ms] ease-out"
            style={{ left: mounted ? `${clampedPct * 100}%`: "0%", borderWidth: 3, borderColor: "#0c1422" }}
          />
        </div>

        <div className="mt-3.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
            You are here · {nextLabel}
          </span>
          {onViewPlan && (
            <button
              type="button"
              data-tutorial="camp-full-plan"
              onClick={onViewPlan}
              className="flex items-center gap-0.5 font-display text-[12.5px] font-semibold text-primary active:opacity-70 transition"
            >
              View full plan
              <Icon name="chevronForwardOutline" size={13} />
            </button>
          )}
        </div>
      </div>

      <LevelSheet open={levelSheetOpen} onOpenChange={setLevelSheetOpen} />
    </div>
  );
});
