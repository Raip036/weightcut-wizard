import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { gradeMeta } from "@/lib/foodHealthScore";

interface DailyFoodQualityBarProps {
  /** Average of the day's meal health scores (0-100). */
  score: number;
  /** How many scored meals fed the average. */
  mealCount: number;
  /** When provided, the bar becomes tappable (opens the grading explainer). */
  onPress?: () => void;
}

/**
 * Daily food-quality summary on the Nutrition page: the average whole-food
 * grade across today's scored meals, shown as a title + grade letter + score +
 * progress bar. Rendered in the wizard brand blue. Minimal, no background.
 * Updates as more meals log.
 */
export function DailyFoodQualityBar({ score, onPress }: DailyFoodQualityBarProps) {
  const meta = gradeMeta(score);
  const [fill, setFill] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setFill(score), 60);
    return () => clearTimeout(t);
  }, [score]);

  const Wrapper: React.ElementType = onPress ? "button" : "div";

  return (
    <Wrapper
      {...(onPress ? { type: "button", onClick: onPress } : {})}
      className={`block w-full px-1 text-left ${onPress ? "card-press" : ""}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
          Today's food quality
        </p>
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold leading-none text-white">
            {meta.grade}
          </span>
          <span className="text-[13px] font-bold tabular-nums">
            <span className="text-primary">{score}</span>
            <span className="ml-0.5 text-[11px] font-medium text-muted-foreground/45">/100</span>
          </span>
          {onPress && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />}
        </div>
      </div>

      <div
        className="relative h-2 w-full overflow-hidden rounded-full ring-1 ring-inset ring-border/40"
        style={{ backgroundColor: "hsl(var(--muted) / 0.6)" }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{
            width: `${fill}%`,
            background: "linear-gradient(90deg, hsl(var(--primary) / 0.85), hsl(var(--primary)))",
          }}
        />
      </div>
    </Wrapper>
  );
}
