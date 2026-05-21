import { memo } from "react";
import type { WeeklyConsistency } from "@/hooks/useGamification";
import { AnimatedNumber } from "@/components/motion";

interface ConsistencyRingProps extends WeeklyConsistency {}

export const ConsistencyRing = memo(function ConsistencyRing({
  percentage,
  daysComplete,
  totalDays,
  dailyBreakdown,
}: ConsistencyRingProps) {
  const getRingColor = () => {
    if (percentage >= 70) return "hsl(var(--success))";
    if (percentage >= 40) return "hsl(var(--warning))";
    return "hsl(var(--muted-foreground))";
  };

  const color = getRingColor();
  const progressDeg = (percentage / 100) * 360;

  return (
    <div className="card-surface rounded-xs border border-border p-3.5">
      <div className="flex items-center gap-3">
        {/* Ring — CSS conic-gradient */}
        <div className="relative w-16 h-16 flex-shrink-0">
          <div
            className="w-full h-full rounded-full"
            style={{
              background: `conic-gradient(${color} ${progressDeg}deg, hsl(var(--muted) / 0.3) ${progressDeg}deg)`,
              mask: "radial-gradient(farthest-side, transparent calc(100% - 5px), #fff calc(100% - 5px))",
              WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 5px), #fff calc(100% - 5px))",
            }}
          />

          {/* Center percentage */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-base font-bold display-number">
              <AnimatedNumber value={percentage} format={(n) => `${Math.round(n)}%`} />
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 min-w-0">
          <div className="text-[40px] leading-none font-bold display-number">
            <AnimatedNumber value={daysComplete} />
            <span className="text-lg font-normal text-muted-foreground">
              /{totalDays}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">days complete</p>
        </div>
      </div>

      {/* Day dots */}
      <div className="flex items-center justify-between mt-2 px-1">
        {dailyBreakdown.map((day) => (
          <div key={day.date} className="flex flex-col items-center gap-1">
            <div
              className={`w-3.5 h-3.5 rounded-full transition-colors ${
                day.complete
                  ? "bg-func-recovery-green"
                  : "bg-muted-foreground/20"
              }`}
            />
            <span className="text-[10px] text-muted-foreground">
              {day.dayLabel}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});
