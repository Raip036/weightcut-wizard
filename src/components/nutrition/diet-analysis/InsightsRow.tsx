import { Zap, Heart } from "lucide-react";
import { clean } from "@/lib/dietAnalysis";
import type { KeyInsight } from "@/types/dietAnalysis";

const SECTION_LABEL =
  "text-[10px] uppercase tracking-widest text-muted-foreground font-semibold";

export function InsightsRow({ insights }: { insights: KeyInsight[] }) {
  const rows = insights.filter((i) => i.text);
  if (rows.length === 0) return null;
  return (
    <div>
      <p className={`${SECTION_LABEL} mb-2`}>What this means</p>
      <div className="space-y-1.5">
        {rows.map((insight, i) => {
          const perf = insight.focus === "performance";
          const Icon = perf ? Zap : Heart;
          const tint = perf ? "rgb(245 158 11)" : "rgb(16 185 129)";
          return (
            <div key={i} className="flex items-start gap-2 rounded-xl bg-muted/15 px-3 py-2.5">
              <div
                className="h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ backgroundColor: tint.replace("rgb", "rgba").replace(")", " / 0.15)") }}
              >
                <Icon className="h-3 w-3" style={{ color: tint }} />
              </div>
              <p className="text-[12.5px] text-foreground/85 leading-snug flex-1">
                {clean(insight.text)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
