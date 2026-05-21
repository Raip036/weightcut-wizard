import { memo } from "react";
import { Waves, Leaf } from "lucide-react";
import { sanitizeAIText } from "@/lib/sanitizeAIText";

export interface SodiumStrategy {
  restrictionMg: number;
  rationale: string;
}

export interface FibreStrategy {
  restrictionG: number;
  startDaysOut: number;
  rationale: string;
}

interface ManipulationCardProps {
  sodium: SodiumStrategy;
  fibre: FibreStrategy;
}

export const ManipulationCard = memo(function ManipulationCard({ sodium, fibre }: ManipulationCardProps) {
  return (
    <div className="card-surface rounded-xs border border-border/50 p-4">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Sodium and Fibre</h3>

      <div className="grid grid-cols-2 gap-3">
        {/* Sodium */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <div className="h-6 w-6 rounded-md bg-func-hydration-cyan/15 flex items-center justify-center">
              <Waves className="h-3 w-3 text-func-hydration-cyan" />
            </div>
            <span className="text-[13px] font-semibold">Sodium</span>
          </div>
          <div>
            <span className="text-lg font-bold tabular-nums">{sodium.restrictionMg}</span>
            <span className="text-[10px] text-muted-foreground ml-1">mg/day</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{sanitizeAIText(sodium.rationale)}</p>
        </div>

        {/* Fibre */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <div className="h-6 w-6 rounded-md bg-func-recovery-green/15 flex items-center justify-center">
              <Leaf className="h-3 w-3 text-func-recovery-green" />
            </div>
            <span className="text-[13px] font-semibold">Fibre</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold tabular-nums">{fibre.restrictionG}</span>
            <span className="text-[10px] text-muted-foreground">g/day</span>
            <span className="text-[10px] text-muted-foreground/70 ml-1">from D-{fibre.startDaysOut}</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{sanitizeAIText(fibre.rationale)}</p>
        </div>
      </div>
    </div>
  );
});
