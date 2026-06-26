import { useMemo } from "react";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "motion/react";
import { api } from "@/../convex/_generated/api";
import { Icon } from "@/components/ui/Icon";
import { springs } from "@/lib/motion";

// ---------------------------------------------------------------------------
// Streak ring - a minimal, display-only gamification element that replaces the
// old "Last 7 days" completeness strip. It shows the user's current daily-
// ritual streak inside a tiny progress ring (progress = how close they are to
// the next milestone badge). A full day = all five pillars logged OR an
// explicit rest day (see `streakStats` on the backend).
//
// The flame is "dynamic": its colour + glow climb a tier ladder as the streak
// grows (cold ember → orange → blaze → blue white-hot at 100+), so the visual
// always corresponds to the number beside it.
// ---------------------------------------------------------------------------

// Milestone ladder. The ring fills from the previous milestone to the next,
// so each badge feels reachable rather than asymptotic.
const MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];

function nextMilestone(streak: number): number | null {
  for (const m of MILESTONES) if (m > streak) return m;
  return null; // past the top of the ladder → "maxed out"
}

function prevMilestone(streak: number): number {
  let prev = 0;
  for (const m of MILESTONES) {
    if (m <= streak) prev = m;
    else break;
  }
  return prev;
}

// Flame tiers. Hotter real flames run orange → red → blue-white, so the ramp
// reads as "this streak is heating up". Each tier drives the ring gradient,
// the flame tint, and the glow strength in one place.
interface Tier {
  from: string;
  to: string;
  flame: string;
  glow: number; // 0 → 1, scales the drop-shadow blur/alpha
}

function tierFor(streak: number): Tier {
  if (streak <= 0)
    return { from: "hsl(var(--muted-foreground))", to: "hsl(var(--muted-foreground))", flame: "hsl(var(--muted-foreground) / 0.6)", glow: 0 };
  if (streak < 3) return { from: "#FFD24A", to: "#FF9A1F", flame: "#FFB54A", glow: 0.4 };
  if (streak < 7) return { from: "#FFB020", to: "#FF5A1F", flame: "#FF8A2E", glow: 0.55 };
  if (streak < 14) return { from: "#FF8A1F", to: "#FF3B1F", flame: "#FF6A2A", glow: 0.7 };
  if (streak < 30) return { from: "#FF5A1F", to: "#FF1F4B", flame: "#FF4A3C", glow: 0.85 };
  if (streak < 100) return { from: "#FF3B5F", to: "#FF1FA0", flame: "#FF3C7A", glow: 1 };
  return { from: "#7CD8FF", to: "#3B6BFF", flame: "#6FC8FF", glow: 1 }; // blue white-hot
}

// Geometry - two scales: the standalone card row, and a tiny inline chip
// that tucks beside the date in the dashboard header.
const RING = {
  full: { size: 36, stroke: 3.5, flame: 16 },
  minimal: { size: 22, stroke: 2.5, flame: 11 },
} as const;

export interface StreakStats {
  current: number;
  best: number;
  total: number;
  todayComplete: boolean;
}

/**
 * Presentational streak card. Pure - takes the already-computed stats so it can
 * be previewed in a lab without a Convex round-trip. `minimal` renders a tiny
 * inline chip (ring + label, no card) for the header date row.
 */
export function StreakRingView({
  stats,
  minimal = false,
}: {
  stats: StreakStats;
  minimal?: boolean;
}) {
  const prefersReduced = useReducedMotion();

  const geom = minimal ? RING.minimal : RING.full;
  const ringR = (geom.size - geom.stroke) / 2;
  const ringC = 2 * Math.PI * ringR;

  const view = useMemo(() => {
    const { current, todayComplete } = stats;
    const next = nextMilestone(current);
    const prev = prevMilestone(current);
    const tier = tierFor(current);

    // Ring progress within the current milestone band - purely a VISUAL cue.
    const progress =
      next === null
        ? 1
        : Math.max(0, Math.min(1, (current - prev) / (next - prev)));

    // The streak count IS the headline; the ring conveys progress to the next
    // badge, so no sub-line is needed.
    const headline = current === 0 ? "Start your streak" : `${current}-day streak`;

    return { current, progress, headline, tier, todayComplete, active: current > 0 };
  }, [stats]);

  const dashOffset = ringC * (1 - view.progress);
  const uid = useMemo(
    () => `streakGrad-${minimal ? "m" : "f"}-${Math.round(view.progress * 1000)}`,
    [view.progress, minimal],
  );
  const t = view.tier;

  // The progress ring with the tier-coloured flame centred — shared by both
  // the card and the minimal chip; only the geometry differs.
  const ring = (
    <div className="relative shrink-0" style={{ width: geom.size, height: geom.size }}>
      <svg width={geom.size} height={geom.size} className="-rotate-90">
        <circle
          cx={geom.size / 2}
          cy={geom.size / 2}
          r={ringR}
          fill="none"
          stroke="hsl(var(--muted) / 0.5)"
          strokeWidth={geom.stroke}
        />
        <motion.circle
          cx={geom.size / 2}
          cy={geom.size / 2}
          r={ringR}
          fill="none"
          stroke={`url(#${uid})`}
          strokeWidth={geom.stroke}
          strokeLinecap="round"
          strokeDasharray={ringC}
          initial={prefersReduced ? false : { strokeDashoffset: ringC }}
          animate={{ strokeDashoffset: dashOffset }}
          transition={springs.gentle}
        />
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={t.from} />
            <stop offset="1" stopColor={t.to} />
          </linearGradient>
        </defs>
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center"
        // colour + glow scale with the tier so the flame visibly "heats up"
        // (Icon paints with currentColor, so colour cascades from here)
        style={{
          color: t.flame,
          filter: t.glow > 0 ? `drop-shadow(0 0 ${3 + t.glow * 5}px ${t.flame})` : undefined,
        }}
      >
        <Icon name={view.active ? "flame" : "flameOutline"} size={geom.flame} className="leading-none" />
      </span>
    </div>
  );

  // Minimal: a tiny inline chip (ring + label, no card) for the header row.
  if (minimal) {
    return (
      <div className="flex items-center gap-1.5">
        {ring}
        <span className="text-micro uppercase tracking-[0.1em] font-semibold text-muted-foreground/80 whitespace-nowrap">
          {view.headline}
        </span>
      </div>
    );
  }

  return (
    <div className="card-surface rounded-2xl pl-2.5 pr-3.5 py-2 flex items-center gap-3">
      {ring}

      {/* Headline only — the ring conveys progress to the next badge. */}
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-bold leading-tight tracking-tight truncate">
          {view.headline}
        </p>
      </div>
    </div>
  );
}

export default function StreakRing({ minimal = false }: { minimal?: boolean } = {}) {
  const stats = useQuery(api.fightFormScore.streakStats, {});

  // Loading or unauthenticated → render nothing (matches the old meter).
  if (!stats) return null;

  return <StreakRingView stats={stats} minimal={minimal} />;
}

export { StreakRing };
