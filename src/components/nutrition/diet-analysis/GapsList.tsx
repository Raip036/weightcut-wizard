import { status, clean } from "@/lib/dietAnalysis";
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
          const c = status(gap.percentRDA).color;
          return (
            <div
              key={gap.nutrient}
              className="rounded-xl bg-amber-500/[0.06] ring-1 ring-amber-500/15 px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: c }}
                />
                <span className="text-[13px] font-semibold text-foreground flex-1">
                  {gap.nutrient}
                </span>
                <span className="text-[11px] tabular-nums font-semibold" style={{ color: c }}>
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
