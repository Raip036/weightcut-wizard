import { Progress } from "@/components/ui/progress";

interface CalorieBudgetIndicatorProps {
  dailyTarget: number;
  consumed: number;
  safetyStatus: "green" | "yellow" | "red";
  safetyMessage: string;
}

export function CalorieBudgetIndicator({
  dailyTarget,
  consumed,
}: CalorieBudgetIndicatorProps) {
  const percentage = (consumed / dailyTarget) * 100;
  const remaining = dailyTarget - consumed;

  const getProgressColor = () => {
    if (percentage > 100) return "bg-destructive";
    if (percentage > 90) return "bg-func-warning-yellow";
    return "bg-primary";
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="font-medium">
          {consumed} / {dailyTarget} kcal
        </span>
        <span className={remaining >= 0 ? "text-muted-foreground" : "text-destructive"}>
          {remaining >= 0 ? `${remaining} remaining` : `${Math.abs(remaining)} over`}
        </span>
      </div>
      <Progress
        value={Math.min(percentage, 100)}
        indicatorClassName={getProgressColor()}
      />
    </div>
  );
}
