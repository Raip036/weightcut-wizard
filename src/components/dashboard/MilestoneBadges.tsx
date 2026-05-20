import { memo } from "react";
import { Flame, Calendar, Utensils, Trophy, Scale, TrendingUp, Award, Zap, Star, Dumbbell, Crown, Check, ChevronRight } from "lucide-react";
import { motion } from "motion/react";
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

export const MilestoneBadges = memo(function MilestoneBadges({ badges, loading, onTap }: MilestoneBadgesProps) {
  if (!loading && badges.length === 0) return null;
  if (loading) {
    return (
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
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
      <div className="flex items-center justify-between mb-3">
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
            className="text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            +{remaining} more
          </button>
        )}
      </div>
      <div className={GRID_CLASS}>
        {visible.map((badge) => {
          const Icon = iconMap[badge.icon];
          const BadgeWrapper = handleBadgeTap ? "button" : "div";
          return (
            <BadgeWrapper
              key={badge.id}
              {...(handleBadgeTap
                ? { onClick: handleBadgeTap, type: "button" as const }
                : {})}
              className="rounded-xs p-3 text-center card-surface active:scale-[0.98] transition-transform"
            >
              <div
                className={`w-10 h-10 rounded-full mx-auto flex items-center justify-center ${
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
              </div>

              <div className="flex items-center justify-center gap-1 mt-2 min-w-0">
                <span className="text-xs font-semibold truncate">
                  {badge.title}
                </span>
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
        })}
      </div>
    </div>
  );
});
