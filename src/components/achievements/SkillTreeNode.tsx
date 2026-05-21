import { memo } from "react";
import { motion } from "motion/react";
import { Check, Flame, Calendar, Utensils, Trophy, Scale, TrendingUp, Award, Zap, Star, Dumbbell, Crown } from "lucide-react";
import type { AchievementNode } from "@/hooks/useGamification";

const iconMap = {
  Flame, Calendar, Utensils, Trophy, Scale, TrendingUp, Award, Zap, Star, Dumbbell, Crown,
} as const;

interface SkillTreeNodeProps {
  achievement: AchievementNode;
  globalIndex: number;
}

export const SkillTreeNode = memo(function SkillTreeNode({ achievement, globalIndex }: SkillTreeNodeProps) {
  const Icon = iconMap[achievement.icon];
  const unlocked = achievement.unlocked;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: globalIndex * 0.05, ease: [0.32, 0.72, 0, 1] }}
      className={`flex items-center gap-3 rounded-xs border p-3 ${
        unlocked
          ? "border-func-recovery-green/30 bg-func-recovery-green/5"
          : "border-border/50 opacity-60"
      }`}
    >
      {/* Icon circle */}
      <div
        className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center relative ${
          unlocked ? "bg-func-recovery-green/20" : "bg-muted/20"
        }`}
      >
        <Icon className={`h-5 w-5 ${unlocked ? "text-func-recovery-green" : "text-muted-foreground"}`} />
        {unlocked && (
          <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-func-recovery-green flex items-center justify-center">
            <Check className="h-2.5 w-2.5 text-black" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${unlocked ? "text-foreground" : "text-muted-foreground"}`}>
          {achievement.title}
        </p>
        <p className="text-xs text-muted-foreground truncate">{achievement.description}</p>
        {!unlocked && (
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-func-recovery-green/50 transition-all duration-500"
                style={{ width: `${achievement.progress * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground font-medium tabular-nums">
              {achievement.currentValue}/{achievement.targetValue}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
});
