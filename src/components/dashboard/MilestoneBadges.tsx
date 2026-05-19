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
    <div className="w-28 flex-shrink-0 rounded-2xl border border-border p-3 text-center card-surface">
      <div className="w-10 h-10 rounded-full mx-auto shimmer-skeleton" />
      <div className="h-3 w-16 mx-auto mt-2 rounded shimmer-skeleton" />
      <div className="h-1 w-full mt-2 rounded-full shimmer-skeleton" />
    </div>
  );
}

// iOS-friendly horizontal scroll: -webkit-overflow-scrolling for momentum,
// touch-action: pan-x so the gesture is recognised as horizontal pan and
// not eaten by a parent button or the page's vertical scroll.
const SCROLL_TRACK_CLASS =
  "flex gap-3 overflow-x-auto pb-1 scrollbar-hide snap-x scroll-smooth " +
  "[-webkit-overflow-scrolling:touch] [touch-action:pan-x] " +
  "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export const MilestoneBadges = memo(function MilestoneBadges({ badges, loading, onTap }: MilestoneBadgesProps) {
  if (!loading && badges.length === 0) return null;
  if (loading) {
    return (
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          Achievements
        </div>
        <div className={SCROLL_TRACK_CLASS}>
          {Array.from({ length: 4 }).map((_, i) => (
            <BadgeSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  // NOTE: tap target is the header row only. The scroll track sits OUTSIDE
  // any button so horizontal swipes aren't intercepted on iOS — wrapping the
  // whole component in <button> swallows the gesture before the inner
  // overflow-x container can scroll. Individual badges are also tap targets
  // for users who land directly on a badge.
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
      </div>
      <div className={SCROLL_TRACK_CLASS}>
        {badges.map((badge) => {
          const Icon = iconMap[badge.icon];
          const BadgeWrapper = handleBadgeTap ? "button" : "div";
          return (
            <BadgeWrapper
              key={badge.id}
              {...(handleBadgeTap
                ? { onClick: handleBadgeTap, type: "button" as const }
                : {})}
              className="w-28 flex-shrink-0 snap-start rounded-2xl border border-border p-3 text-center card-surface active:scale-[0.98] transition-transform"
            >
              {/* Icon circle */}
              <div
                className={`w-10 h-10 rounded-full mx-auto flex items-center justify-center ${
                  badge.unlocked
                    ? "bg-primary/20"
                    : "bg-muted/20"
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

              {/* Title + checkmark */}
              <div className="flex items-center justify-center gap-1 mt-2">
                <span className="text-xs font-semibold truncate">
                  {badge.title}
                </span>
                {badge.unlocked && (
                  <Check className="h-3 w-3 text-green-500 flex-shrink-0" />
                )}
              </div>

              {/* Progress bar */}
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
