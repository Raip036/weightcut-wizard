import type { FoodContribution } from "@/types/dietAnalysis";

const SECTION_LABEL =
  "text-[10px] uppercase tracking-widest text-muted-foreground font-semibold";

/** "Where it came from": each logged food with the nutrients it supplied. */
export function FoodNutrientMap({ contributions }: { contributions: FoodContribution[] }) {
  const rows = contributions.filter((c) => c.food && c.nutrients.length > 0);
  if (rows.length === 0) return null;
  return (
    <div>
      <p className={`${SECTION_LABEL} mb-2`}>Where it came from</p>
      <div className="space-y-1.5">
        {rows.map((c, i) => (
          <div key={`${c.food}-${i}`} className="rounded-xl bg-muted/15 px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[13px] font-semibold text-foreground truncate">
                {c.food}
              </span>
              {c.mealType ? (
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
                  {c.mealType}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1">
              {c.nutrients.map((n, j) => (
                <span
                  key={`${n.name}-${j}`}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium"
                >
                  {n.name}
                  {n.amount ? ` ${n.amount}` : ""}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
