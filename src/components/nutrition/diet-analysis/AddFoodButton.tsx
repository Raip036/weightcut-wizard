import { Plus } from "lucide-react";
import { cleanFoodName } from "@/lib/dietAnalysis";

/** Small "+ Add" pill that seeds the food search with a suggested food. */
export function AddFoodButton({
  food,
  onAddFood,
}: {
  food: string;
  onAddFood?: (food: string) => void;
}) {
  if (!onAddFood) return null;
  return (
    <button
      type="button"
      onClick={() => onAddFood(cleanFoodName(food))}
      className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-primary/15 text-primary text-[11px] font-bold active:scale-[0.96] active:bg-primary/25 transition-all"
      aria-label={`Add ${cleanFoodName(food)} to your meals`}
    >
      <Plus className="h-3 w-3" strokeWidth={3} />
      Add
    </button>
  );
}
