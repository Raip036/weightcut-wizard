import { memo } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { BalanceMetric } from "@/utils/performanceEngine";

interface BalanceMetricsCardProps {
  balanceMetrics: BalanceMetric[];
}

function getDirectionIcon(direction: BalanceMetric['direction']) {
  switch (direction) {
    case 'improving': return TrendingUp;
    case 'declining': return TrendingDown;
    case 'stable': return Minus;
  }
}

function getDirectionColor(direction: BalanceMetric['direction'], severity: BalanceMetric['severity']) {
  if (severity === 'alert') {
    return direction === 'improving' ? 'text-func-recovery-green' : 'text-func-danger-red';
  }
  if (severity === 'warning') {
    return direction === 'improving' ? 'text-func-recovery-green/70' : 'text-func-warning-yellow';
  }
  return 'text-muted-foreground';
}

function getBarPosition(recent: number, baseline: number, z: number): { left: number; width: number; barLeft: number } {
  // Normalize to show where recent sits relative to baseline
  // Center the baseline at 50%, recent deviates
  const center = 50;
  const offset = Math.max(-40, Math.min(40, z * 15));
  const barLeft = center + Math.min(offset, 0);
  const width = Math.abs(offset);

  return { left: center, width: Math.max(2, width), barLeft };
}

export const BalanceMetricsCard = memo(function BalanceMetricsCard({ balanceMetrics }: BalanceMetricsCardProps) {
  if (balanceMetrics.length === 0) return null;

  return (
    <div className="card-surface rounded-xs p-4 border border-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-bold text-foreground">Balance Metrics</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/40 text-muted-foreground font-medium">
          14d vs 60d
        </span>
      </div>

      <div className="space-y-2.5">
        {balanceMetrics.map((metric) => {
          const Icon = getDirectionIcon(metric.direction);
          const colorClass = getDirectionColor(metric.direction, metric.severity);
          const { left, width, barLeft } = getBarPosition(metric.recent14d, metric.baseline60d, metric.zScore);

          // For negative metrics, flip the visual interpretation
          const isNegativeMetric = ['Soreness', 'Fatigue', 'Stress'].includes(metric.metric);
          const barColor = isNegativeMetric
            ? (metric.zScore > 0 ? '#ef4444' : metric.zScore < 0 ? '#22c55e' : '#6b7280')
            : (metric.zScore > 0 ? '#22c55e' : metric.zScore < 0 ? '#ef4444' : '#6b7280');

          return (
            <div key={metric.metric} className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 w-24 shrink-0">
                <Icon className={`h-3 w-3 ${colorClass}`} />
                <span className="text-[10px] text-foreground/70 truncate">{metric.metric}</span>
              </div>

              {/* Balance bar */}
              <div className="flex-1 relative h-3 bg-accent/20 rounded-full overflow-hidden">
                {/* Center line (baseline) */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-foreground/20"
                  style={{ left: '50%' }}
                />
                {/* Deviation bar */}
                <div
                  className="absolute top-0.5 bottom-0.5 rounded-full transition-all duration-500"
                  style={{
                    left: `${barLeft}%`,
                    width: `${width}%`,
                    backgroundColor: barColor,
                    opacity: 0.7,
                  }}
                />
              </div>

              <span className={`text-[9px] font-bold tabular-nums w-10 text-right ${colorClass}`}>
                {metric.zScore >= 0 ? '+' : ''}{metric.zScore.toFixed(1)} SD
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between mt-2 px-1">
        <span className="text-[8px] text-muted-foreground/50">Below baseline</span>
        <span className="text-[8px] text-muted-foreground/50">Above baseline</span>
      </div>
    </div>
  );
});
