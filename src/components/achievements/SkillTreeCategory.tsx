import { Flame, Utensils, Scale, Dumbbell } from "lucide-react";
import type { AchievementCategoryGroup } from "@/hooks/useGamification";
import { SkillTreeNode } from "./SkillTreeNode";
import { SkillTreeConnector } from "./SkillTreeConnector";

const categoryIcons = {
  Flame, Utensils, Scale, Dumbbell,
} as const;

interface SkillTreeCategoryProps {
  group: AchievementCategoryGroup;
  globalIndexStart: number;
}

export function SkillTreeCategory({ group, globalIndexStart }: SkillTreeCategoryProps) {
  const Icon = categoryIcons[group.icon as keyof typeof categoryIcons];
  const unlockedCount = group.achievements.filter((a) => a.unlocked).length;

  return (
    <div>
      {/* Category header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-func-recovery-green" />}
          <h3 className="text-sm font-semibold">{group.label}</h3>
        </div>
        <span className="text-xs text-muted-foreground font-medium">
          {unlockedCount}/{group.achievements.length} unlocked
        </span>
      </div>

      {/* Node chain */}
      <div className="flex flex-col">
        {group.achievements.map((achievement, i) => (
          <div key={achievement.id}>
            <SkillTreeNode
              achievement={achievement}
              globalIndex={globalIndexStart + i}
            />
            {i < group.achievements.length - 1 && (
              <SkillTreeConnector
                topUnlocked={achievement.unlocked}
                bottomUnlocked={group.achievements[i + 1].unlocked}
                globalIndex={globalIndexStart + i}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
