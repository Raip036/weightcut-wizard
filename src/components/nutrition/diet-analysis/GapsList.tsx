import { clean } from "@/lib/dietAnalysis";
import type { NutrientGap } from "@/types/dietAnalysis";

const SECTION_LABEL =
  "text-[10px] uppercase tracking-widest text-muted-foreground font-semibold";

export function GapsList({ gaps }: { gaps: NutrientGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <div>
      <p className={`${SECTION_LABEL} mb-2`}>Gaps to close</p>
      <div className="space-y-1.5">
        {gaps.map((gap) => {
          return (
            <div
              key={gap.nutrient}
              className="rounded-xl bg-muted/15 ring-1 ring-border/40 px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full flex-shrink-0 bg-primary" />
                <span className="text-[13px] font-semibold text-foreground flex-1">
                  {gap.nutrient}
                </span>
                <span className="text-[11px] tabular-nums font-semibold text-primary">
                  {gap.percentRDA}%
                </span>
              </div>
              {gap.reason && (
                <p className="text-[12px] text-foreground/75 leading-relaxed mt-0.5 ml-4">
                  {clean(gap.reason)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
