import { gradeMeta } from "@/lib/foodHealthScore";

interface FoodHealthRatingProps {
  score: number;
}

/**
 * Subtle per-food health hint: a small color dot carries the signal, the tag
 * sits quietly in muted text so it reads as a soft caption, not a badge. The
 * loud verdict lives in the meal grade up top; rows stay calm.
 */
export function FoodHealthRating({ score }: FoodHealthRatingProps) {
  const meta = gradeMeta(score);
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5">
      <span
        className="h-[5px] w-[5px] rounded-full"
        style={{ backgroundColor: meta.color, opacity: 0.9 }}
        aria-hidden
      />
      <span className="text-[10.5px] font-normal tracking-tight text-muted-foreground/70">
        {meta.tag}
      </span>
    </span>
  );
}
