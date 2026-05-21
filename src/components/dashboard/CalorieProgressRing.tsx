import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AnimatedRing, AnimatedNumber } from "@/components/motion";

interface CalorieProgressRingProps {
  consumed: number;
  target: number;
}

export const CalorieProgressRing = memo(function CalorieProgressRing({ consumed, target }: CalorieProgressRingProps) {
  const percentage = target > 0 ? Math.min((consumed / target) * 100, 100) : 0;
  const progressFraction = percentage / 100;

  const getStatusColor = () => {
    if (consumed < target * 0.8) return "hsl(var(--chart-1))";
    if (consumed <= target * 1.1) return "hsl(var(--success))";
    return "hsl(var(--destructive))";
  };

  const getStatusText = () => {
    if (consumed < target * 0.8) return "Under Target";
    if (consumed <= target * 1.1) return "On Track";
    return "Over Target";
  };

  const statusColor = getStatusColor();

  return (
    <Card className="card-surface rounded-xs border border-border overflow-hidden h-full">
      <CardContent className="p-6 pb-28 relative h-full flex flex-col justify-between">
        <div className="flex flex-col pr-28">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Calorie Progress</div>
          <div className="text-4xl font-bold display-number mb-1">
            <AnimatedNumber value={consumed} />
          </div>
          <p className="text-xs text-muted-foreground">of {target} kcal</p>
          <p className="text-xs font-medium mt-2" style={{ color: statusColor }}>
            {getStatusText()}
          </p>
        </div>

        <div className="absolute bottom-6 right-6 w-24 h-24 max-w-[96px] max-h-[96px] md:w-36 md:h-36 md:max-w-none md:max-h-none lg:w-48 lg:h-48 p-1">
          <AnimatedRing
            progress={progressFraction}
            size={100}
            strokeWidth={8}
            gradientColors={[statusColor, statusColor]}
            id="calorie-ring"
          />

          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-xl md:text-2xl lg:text-3xl font-bold display-number">
              <AnimatedNumber value={percentage} format={(n) => `${Math.round(n)}%`} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
