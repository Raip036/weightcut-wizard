// MOCKUP - meal health grade lab. Delete after sign-off.
import { useEffect, useState } from "react";
import { gradeMeta } from "./foodHealthScore";

interface MealHealthGradeProps {
  score: number;
  /** Optional worst-item name to make the nudge actionable. */
  worstItem?: string | null;
}

/**
 * The glanceable verdict for the whole plate, shown above the meal title.
 * A letter badge + progress bar + one persuasive, non-judgmental line.
 */
export default function MealHealthGrade({ score, worstItem }: MealHealthGradeProps) {
  const meta = gradeMeta(score);
  const [fill, setFill] = useState(0);

  // Animate the bar from 0 to score% on mount.
  useEffect(() => {
    const t = setTimeout(() => setFill(score), 60);
    return () => clearTimeout(t);
  }, [score]);

  const caption =
    worstItem && (meta.grade === "D" || meta.grade === "E")
      ? `${meta.caption.replace(/\.$/, "")}. The ${worstItem.toLowerCase()} is pulling this down.`
      : meta.caption;

  return (
    <div className="mt-3 mb-1 space-y-2">
      <div className="flex items-center justify-between">
        <p className="section-header">MEAL GRADE</p>
        <p className="display-number text-[15px]">
          <span style={{ color: meta.color }}>{score}</span>
          <span className="text-[12px] font-medium text-muted-foreground/45 ml-0.5">/100</span>
        </p>
      </div>

      <div className="flex items-center gap-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-[14px] font-bold"
          style={{
            backgroundColor: meta.color,
            color: meta.grade === "E" ? "#fff" : "hsl(0 0% 8%)",
          }}
        >
          {meta.grade}
        </span>

        <div
          className="relative h-2.5 flex-1 overflow-hidden rounded-full ring-1 ring-inset ring-border/40"
          style={{ backgroundColor: "hsl(var(--muted) / 0.6)" }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]"
            style={{
              width: `${fill}%`,
              background: `linear-gradient(90deg, ${meta.color}d9, ${meta.color})`,
            }}
          />
        </div>
      </div>

      <p className="pl-0.5 text-[12px] leading-snug text-muted-foreground/85">
        <span style={{ color: meta.color }}>&bull;</span> {caption}
      </p>
    </div>
  );
}
