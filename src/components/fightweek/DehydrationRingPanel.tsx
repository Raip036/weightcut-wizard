import { RecoveryRing } from "@/components/fightcamp/RecoveryRing";
import { CheckCircle } from "lucide-react";
import type { SafetyZone } from "@/utils/fightWeekEngine";

interface DehydrationRingPanelProps {
  dehydrationPercentBW: number;
  dehydrationNeeded: number;
  dehydrationSafety: SafetyZone;
  saunaSessions: number;
}

const ZONE_CONFIG: Record<SafetyZone, { color: string; glow: string; label: string }> = {
  green: { color: "#22c55e", glow: "#22c55e", label: "Safe Zone" },
  orange: { color: "#f59e0b", glow: "#f59e0b", label: "Caution Zone" },
  red: { color: "#ef4444", glow: "#ef4444", label: "Danger Zone" },
};

export function DehydrationRingPanel({
  dehydrationPercentBW,
  dehydrationNeeded,
  dehydrationSafety,
  saunaSessions,
}: DehydrationRingPanelProps) {
  const config = ZONE_CONFIG[dehydrationSafety];

  // No dehydration needed — show success message
  if (dehydrationNeeded <= 0) {
    return (
      <div className="card-surface rounded-xs border border-border/50 p-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-func-recovery-green/20 flex items-center justify-center">
            <CheckCircle className="h-5 w-5 text-func-recovery-green" />
          </div>
          <div>
            <p className="font-semibold text-func-recovery-green">No Dehydration Needed</p>
            <p className="text-xs text-muted-foreground">
              Achievable entirely through diet manipulation
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card-surface rounded-xs border border-border/50 p-5 space-y-4">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
        Dehydration Required
      </h3>

      <div className="flex items-center gap-6">
        <RecoveryRing
          value={dehydrationPercentBW}
          max={8}
          color={config.color}
          glowColor={config.glow}
          label="Dehydration"
          displayValue={`${dehydrationPercentBW.toFixed(1)}%`}
          sublabel={config.label}
          size={120}
          strokeWidth={12}
        />

        <div className="flex-1 space-y-3">
          <div className="bg-muted/50 p-3 rounded-xs border border-border/50">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
              Water Weight to Lose
            </span>
            <span className="text-xl font-bold">
              {dehydrationNeeded.toFixed(1)}
              <span className="text-sm text-muted-foreground font-normal ml-0.5">kg</span>
            </span>
          </div>

          {saunaSessions > 0 && (
            <div className="bg-muted/50 p-3 rounded-xs border border-border/50">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
                Est. Sauna Sessions
              </span>
              <span className="text-xl font-bold">
                {saunaSessions}
                <span className="text-sm text-muted-foreground font-normal ml-0.5">
                  × 40min
                </span>
              </span>
            </div>
          )}
        </div>
      </div>

      {dehydrationSafety === "red" && (
        <div className="bg-func-danger-red/10 border border-func-danger-red/20 rounded-xs p-3">
          <p className="text-sm text-func-danger-red font-medium">
            Dehydration exceeds 4% BW — significant performance risk.
            Consider moving up a weight class or extending timeline.
          </p>
        </div>
      )}
    </div>
  );
}
