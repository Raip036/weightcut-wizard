import { ChevronDown, ChevronUp } from "lucide-react";
import { useState, memo } from "react";
import type { EnhancedReadinessBreakdown } from "@/utils/performanceEngine";

interface ReadinessBreakdownCardProps {
  breakdown: EnhancedReadinessBreakdown;
  totalCheckInDays?: number;
}

interface BarProps {
  label: string;
  value: number;
  color: string;
}

function ScoreBar({ label, value, color }: BarProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-20 shrink-0 text-right">{label}</span>
      <div className="flex-1 h-2 bg-accent/30 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] font-bold tabular-nums w-7 text-right text-foreground/70">{value}</span>
    </div>
  );
}

function getBarColor(value: number): string {
  if (value >= 80) return '#22c55e';
  if (value >= 55) return 'hsl(var(--primary))';
  if (value >= 35) return '#f59e0b';
  return '#ef4444';
}

export const ReadinessBreakdownCard = memo(function ReadinessBreakdownCard({ breakdown, totalCheckInDays }: ReadinessBreakdownCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const tier = breakdown.tier;

  // Build bar list based on tier
  const bars: { label: string; value: number }[] = [];

  if (tier === 3) {
    if (breakdown.wellnessScore != null) bars.push({ label: 'Wellness', value: breakdown.wellnessScore });
    if (breakdown.priorRecoveryScore != null) bars.push({ label: 'Prior Recovery', value: breakdown.priorRecoveryScore });
    bars.push({ label: 'Load Balance', value: breakdown.loadBalanceScore });
    bars.push({ label: 'Sleep', value: breakdown.sleepScore });
    bars.push({ label: 'Soreness', value: breakdown.sorenessScore });
    if (breakdown.deficitImpactScore != null) bars.push({ label: 'Deficit Impact', value: breakdown.deficitImpactScore });
    if (breakdown.stabilityScore != null) bars.push({ label: 'Stability', value: breakdown.stabilityScore });
    if (breakdown.hydrationScore != null) bars.push({ label: 'Hydration', value: breakdown.hydrationScore });
    bars.push({ label: 'Recovery', value: breakdown.recoveryScore });
  } else if (tier === 2) {
    if (breakdown.wellnessScore != null) bars.push({ label: 'Wellness', value: breakdown.wellnessScore });
    bars.push({ label: 'Sleep', value: breakdown.sleepScore });
    bars.push({ label: 'Soreness', value: breakdown.sorenessScore });
    bars.push({ label: 'Load Balance', value: breakdown.loadBalanceScore });
    bars.push({ label: 'Recovery', value: breakdown.recoveryScore });
    bars.push({ label: 'Consistency', value: breakdown.consistencyScore });
  } else {
    bars.push({ label: 'Sleep', value: breakdown.sleepScore });
    bars.push({ label: 'Soreness', value: breakdown.sorenessScore });
    bars.push({ label: 'Load Balance', value: breakdown.loadBalanceScore });
    bars.push({ label: 'Recovery', value: breakdown.recoveryScore });
    bars.push({ label: 'Consistency', value: breakdown.consistencyScore });
  }

  return (
    <div className="card-surface rounded-xs border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-foreground">Readiness Breakdown</span>
          {tier > 1 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-semibold">
              Tier {tier}
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-2">
          {bars.map((bar) => (
            <ScoreBar
              key={bar.label}
              label={bar.label}
              value={bar.value}
              color={getBarColor(bar.value)}
            />
          ))}

          {/* Progress banner for users without full baseline */}
          {tier < 3 && totalCheckInDays != null && (
            <div className="mt-3 text-center py-2 px-3 rounded-xs bg-primary/10 border border-primary/20">
              <p className="text-[10px] text-primary">
                Check in daily to unlock personal baselines — {totalCheckInDays}/14 days
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
