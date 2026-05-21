import { Utensils, Loader2, RotateCcw, Plus } from "lucide-react";
import type { Meal } from "@/pages/nutrition/types";

interface EmptyMealsBannerProps {
  visible: boolean;
  previousDayMealCount: number;
  copyingPreviousDay: boolean;
  lastMeal: Meal | null;
  onQuickAdd: () => void;
  onCopyPreviousDay: () => void;
  onRepeatLast: () => void;
}

export function EmptyMealsBanner({
  visible,
  previousDayMealCount,
  copyingPreviousDay,
  lastMeal,
  onQuickAdd,
  onCopyPreviousDay,
  onRepeatLast,
}: EmptyMealsBannerProps) {
  if (!visible) return null;

  const hasSecondary = previousDayMealCount > 0 || !!lastMeal;

  return (
    <div className="card-surface rounded-xs border border-border/50 px-3.5 py-2.5">
      <div className="flex items-center gap-3">
        <Utensils className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium leading-tight truncate">Nothing logged yet</p>
          <p className="text-[11px] text-muted-foreground/70 leading-tight truncate">
            Tap a meal below or Quick Add
          </p>
        </div>
        <button
          onClick={onQuickAdd}
          className="h-8 px-3 rounded-full bg-primary text-primary-foreground text-[12px] font-semibold inline-flex items-center gap-1 active:scale-[0.97] transition-transform flex-shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          Quick Add
        </button>
      </div>

      {hasSecondary && (
        <div className="flex items-center gap-3 pt-2 mt-2 border-t border-border/30">
          {previousDayMealCount > 0 && (
            <button
              onClick={onCopyPreviousDay}
              disabled={copyingPreviousDay}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground active:text-foreground transition-colors disabled:opacity-50"
            >
              {copyingPreviousDay && <Loader2 className="h-3 w-3 animate-spin" />}
              Copy yesterday
            </button>
          )}
          {previousDayMealCount > 0 && lastMeal && (
            <span className="text-muted-foreground/30 text-[10px]">·</span>
          )}
          {lastMeal && (
            <button
              onClick={onRepeatLast}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground active:text-foreground transition-colors max-w-[140px]"
            >
              <RotateCcw className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">Repeat last</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
