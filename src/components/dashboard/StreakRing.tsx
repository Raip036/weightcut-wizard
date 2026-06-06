import { useMemo } from "react";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "motion/react";
import { api } from "@/../convex/_generated/api";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import { springs } from "@/lib/motion";

// ---------------------------------------------------------------------------
// Streak ring — a minimal, display-only gamification element that replaces the
// old "Last 7 days" completeness strip. It shows the user's current daily-
// ritual streak inside a tiny progress ring (progress = how close they are to
// the next milestone badge), plus their best streak. A full day = all five
// pillars logged OR an explicit rest day (see `streakStats` on the backend).
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

// Flame-gradient ring stroke, sized to sit inline in a thin row.
const RING_SIZE = 38;
const RING_STROKE = 4;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

export default function StreakRing() {
  const prefersReduced = useReducedMotion();
  const stats = useQuery(api.fightFormScore.streakStats, {});

  const view = useMemo(() => {
    if (!stats) return null;
    const { current, todayComplete } = stats;
    const next = nextMilestone(current);
    const prev = prevMilestone(current);

    // Ring progress within the current milestone band. This stays a purely
    // VISUAL cue — the milestone math (best streak, days-to-next-badge) is
    // intentionally NOT spelled out in the copy, which kept the strip crowded.
    const progress =
      next === null
        ? 1
        : Math.max(0, Math.min(1, (current - prev) / (next - prev)));

    // One short, unambiguous line per state: the streak count IS the point,
    // the sub is a single nudge — not a stats dump.
    let headline: string;
    let sub: string;
    if (current === 0) {
      headline = "Start your streak";
      sub = todayComplete ? "Day 1 done — nice start" : "Log all 5 today to begin";
    } else {
      headline = `${current}-day streak`;
      sub = todayComplete ? "Locked in for today" : "Log all 5 today to keep it";
    }

    return { current, progress, headline, sub, active: current > 0 };
  }, [stats]);

  // Loading or unauthenticated → render nothing (matches the old meter).
  if (!view) return null;

  const dashOffset = RING_C * (1 - view.progress);

  return (
    <div className="card-surface rounded-2xl px-3.5 py-3 flex items-center gap-3.5">
      {/* Micro progress ring with the streak count centred. */}
      <div className="relative shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }}>
        <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90">
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_R}
            fill="none"
            stroke="hsl(var(--muted) / 0.55)"
            strokeWidth={RING_STROKE}
          />
          <motion.circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_R}
            fill="none"
            stroke="url(#streakGrad)"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={RING_C}
            initial={prefersReduced ? false : { strokeDashoffset: RING_C }}
            animate={{ strokeDashoffset: dashOffset }}
            transition={springs.gentle}
            style={{
              filter: view.active
                ? "drop-shadow(0 0 4px rgba(255,120,40,0.55))"
                : undefined,
            }}
          />
          <defs>
            <linearGradient id="streakGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#FFB020" />
              <stop offset="1" stopColor="#FF5A1F" />
            </linearGradient>
          </defs>
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold tabular-nums">
          {view.active ? (
            view.current
          ) : (
            <Icon name="flameOutline" size={15} className="text-muted-foreground/70" />
          )}
        </span>
      </div>

      {/* Headline + sub copy. */}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13.5px] font-bold leading-tight tracking-tight">
          {view.active && (
            <Icon name="flame" size={14} className="text-[#FF7A3C] shrink-0" />
          )}
          <span className="truncate">{view.headline}</span>
        </p>
        <p
          className={cn(
            "text-[11px] leading-tight mt-0.5 truncate",
            view.active ? "text-muted-foreground" : "text-muted-foreground/80",
          )}
        >
          {view.sub}
        </p>
      </div>
    </div>
  );
}

export { StreakRing };
