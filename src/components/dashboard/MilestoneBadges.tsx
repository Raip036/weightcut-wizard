import { memo, useEffect, useRef, useState } from "react";
import { Flame, Calendar, Utensils, Trophy, Scale, TrendingUp, Award, Zap, Star, Dumbbell, Crown, Check, ChevronRight, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { MilestoneBadge } from "@/hooks/useGamification";
import { springs } from "@/lib/motion";

const iconMap = {
  Flame, Calendar, Utensils, Trophy, Scale, TrendingUp, Award, Zap, Star, Dumbbell, Crown,
} as const;

interface MilestoneBadgesProps {
  badges: MilestoneBadge[];
  loading: boolean;
  onTap?: () => void;
}

function BadgeSkeleton() {
  return (
    <div className="rounded-xs p-3 text-center card-surface">
      <div className="w-10 h-10 rounded-full mx-auto shimmer-skeleton" />
      <div className="h-3 w-16 mx-auto mt-2 rounded shimmer-skeleton" />
      <div className="h-1 w-full mt-2 rounded-full shimmer-skeleton" />
    </div>
  );
}

// Two-column grid — no horizontal scroll, no truncated labels. The 4 most
// recent badges sit in a tidy 2×2 layout. "See all →" routes through the
// achievement sheet (via the header tap) to view the full set.
const GRID_CLASS = "grid grid-cols-2 gap-2";
const MAX_VISIBLE = 4;

/* Sparkle burst — 8 Sparkles fly outward from the badge center at evenly
   distributed angles over ~600ms. Pre-computed once at module scope so
   every burst shares the same particle pattern (cheap re-render). */
const BURST_PARTICLES = Array.from({ length: 8 }, (_, i) => {
  const angle = (i / 8) * Math.PI * 2;
  const radius = 32;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    /* Slight per-particle delay (0–80ms) so the burst feels organic
       rather than mechanically simultaneous. */
    delay: (i % 4) * 0.02,
  };
});

/* Per-badge card. Lives as its own component so each one can track
   "did this badge JUST unlock?" with its own useRef + state without
   the parent re-rendering all four when only one transitions. */
function BadgeCard({
  badge,
  onTap,
}: {
  badge: MilestoneBadge;
  onTap?: () => void;
}) {
  const Icon = iconMap[badge.icon];
  const BadgeWrapper = onTap ? "button" : "div";

  /* Track previous unlocked state. When it flips false → true mid-mount
     (the user unlocked the badge during this session), fire a 600ms
     sparkle burst. We DON'T burst on the initial mount where it's
     already unlocked — that's just "user opened the app", not an
     achievement moment. */
  const prevUnlockedRef = useRef(badge.unlocked);
  const [burstKey, setBurstKey] = useState<number | null>(null);

  useEffect(() => {
    if (!prevUnlockedRef.current && badge.unlocked) {
      setBurstKey(Date.now());
      const t = window.setTimeout(() => setBurstKey(null), 700);
      return () => window.clearTimeout(t);
    }
    prevUnlockedRef.current = badge.unlocked;
  }, [badge.unlocked]);

  return (
    <BadgeWrapper
      {...(onTap ? { onClick: onTap, type: "button" as const } : {})}
      className="relative rounded-xs p-3 text-center card-surface active:scale-[0.98] transition-transform"
    >
      <div
        className={`relative w-10 h-10 rounded-full mx-auto flex items-center justify-center ${
          badge.unlocked ? "bg-primary/20" : "bg-muted/20"
        }`}
        style={
          badge.unlocked
            ? { boxShadow: "0 0 12px hsl(var(--primary) / 0.3)" }
            : undefined
        }
      >
        {badge.unlocked ? (
          <Icon className="h-5 w-5 text-primary" />
        ) : (
          <Icon className="h-5 w-5 text-muted-foreground" />
        )}
        {/* Burst overlay anchored at the icon center. Keyed by timestamp
            so a re-burst (rare, but possible if state oscillates) gets a
            fresh mount and re-runs the animation cleanly. */}
        <AnimatePresence>
          {burstKey !== null && <SparkleBurst key={burstKey} />}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-center gap-1 mt-2 min-w-0">
        <span className="text-xs font-semibold truncate">{badge.title}</span>
        {badge.unlocked && (
          <Check className="h-3 w-3 text-green-500 flex-shrink-0" />
        )}
      </div>

      {!badge.unlocked && (
        <div className="h-1 rounded-full bg-muted mt-2 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${badge.progress * 100}%` }}
            transition={springs.gentle}
          />
        </div>
      )}
    </BadgeWrapper>
  );
}

function SparkleBurst() {
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      {BURST_PARTICLES.map((p, i) => (
        <motion.span
          key={i}
          className="absolute"
          initial={{ x: 0, y: 0, opacity: 1, scale: 0.4 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 1.2 }}
          transition={{ duration: 0.6, delay: p.delay, ease: "easeOut" }}
        >
          <Sparkles
            className={
              i % 2 === 0
                ? "h-3 w-3 text-brand-wizard-lilac"
                : "h-3 w-3 text-brand-dream-cyan"
            }
            strokeWidth={1.6}
            fill="currentColor"
          />
        </motion.span>
      ))}
    </div>
  );
}

export const MilestoneBadges = memo(function MilestoneBadges({ badges, loading, onTap }: MilestoneBadgesProps) {
  if (!loading && badges.length === 0) return null;
  if (loading) {
    return (
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
          Achievements
        </div>
        <div className={GRID_CLASS}>
          {Array.from({ length: 4 }).map((_, i) => (
            <BadgeSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const visible = badges.slice(0, MAX_VISIBLE);
  const remaining = Math.max(0, badges.length - MAX_VISIBLE);
  const handleHeaderTap = onTap;
  const handleBadgeTap = onTap;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        {handleHeaderTap ? (
          <button
            type="button"
            onClick={handleHeaderTap}
            className="flex items-center gap-1 text-left touch-target"
          >
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Achievements
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ) : (
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Achievements
          </div>
        )}
        {remaining > 0 && handleHeaderTap && (
          <button
            type="button"
            onClick={handleHeaderTap}
            className="text-micro font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            +{remaining} more
          </button>
        )}
      </div>
      <div className={GRID_CLASS}>
        {visible.map((badge) => (
          <BadgeCard key={badge.id} badge={badge} onTap={handleBadgeTap} />
        ))}
      </div>
    </div>
  );
});
