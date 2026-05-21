import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Trophy } from "lucide-react";
import type { AchievementCategoryGroup } from "@/hooks/useGamification";
import { AchievementSkillTree } from "./AchievementSkillTree";

interface AchievementSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: AchievementCategoryGroup[];
}

export function AchievementSheet({ open, onOpenChange, categories }: AchievementSheetProps) {
  const totalUnlocked = categories.reduce(
    (sum, g) => sum + g.achievements.filter((a) => a.unlocked).length,
    0
  );
  const totalAchievements = categories.reduce(
    (sum, g) => sum + g.achievements.length,
    0
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[90vh] rounded-t-2xl flex flex-col">
        <SheetHeader className="mb-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-func-recovery-green/20 p-2 flex-shrink-0">
              <Trophy className="w-5 h-5 text-func-recovery-green" />
            </div>
            <div>
              <SheetTitle className="text-base">Achievements</SheetTitle>
              <p className="text-xs text-muted-foreground">
                {totalUnlocked}/{totalAchievements} unlocked
              </p>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto scrollbar-hide" style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 6rem)" }}>
          <AchievementSkillTree categories={categories} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
