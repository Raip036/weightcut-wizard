import { useEffect, useState } from "react";
import { gradeMeta } from "@/lib/foodHealthScore";

interface DailyFoodQualityBarProps {
  /** Average of the day's meal health scores (0-100). */
  score: number;
  /** How many scored meals fed the average. */
  mealCount: number;
}

/**
 * Daily food-quality summary on the Nutrition page: the average whole-food
 * grade across today's scored meals, shown as a title + score + progress bar.
 * Minimal, no background, no badge, no caption. Updates as more meals log.
 */
export function DailyFoodQualityBar({ score }: DailyFoodQualityBarProps) {
  const meta = gradeMeta(score);
  const [fill, setFill] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setFill(score), 60);
    return () => clearTimeout(t);
  }, [score]);

  return (
    <div className="px-1">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
          Today's food quality
        </p>
        <p className="text-[13px] font-bold tabular-nums">
          <span style={{ color: meta.color }}>{score}</span>
          <span className="ml-0.5 text-[11px] font-medium text-muted-foreground/45">/100</span>
        </p>
      </div>

      <div
        className="relative h-2 w-full overflow-hidden rounded-full ring-1 ring-inset ring-border/40"
        style={{ backgroundColor: "hsl(var(--muted) / 0.6)" }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{ width: `${fill}%`, background: `linear-gradient(90deg, ${meta.color}d9, ${meta.color})` }}
        />
      </div>
    </div>
  );
}
