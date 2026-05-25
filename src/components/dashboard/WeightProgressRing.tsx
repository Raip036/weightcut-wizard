import { memo } from "react";
import { AnimatedNumber } from "@/components/motion";

interface WeightProgressRingProps {
  currentWeight: number;
  startingWeight: number;
  goalWeight: number;
}

export const WeightProgressRing = memo(function WeightProgressRing({ currentWeight, startingWeight, goalWeight }: WeightProgressRingProps) {
  const totalToLose = startingWeight - goalWeight;
  const weightLost = startingWeight - currentWeight;
  const weightRemaining = currentWeight - goalWeight;
  const progressPercentage = totalToLose > 0 ? (weightLost / totalToLose) * 100 : 0;
  const displayProgress = Math.min(Math.max(progressPercentage, 0), 100);

  return (
    <div className="card-surface card-glow rounded-2xl p-3.5">
      {/* Header */}
      <div className="mb-2.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-foreground">Weight Progress</span>
      </div>

      {/* Progress bar */}
      <div className="relative h-2.5 w-full rounded-full bg-muted/50 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-700 ease-out"
          style={{ width: `${displayProgress}%` }}
        />
      </div>

      {/* Stats row — grid keeps the percentage centered and contained on narrow screens */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mt-2.5">
        <div className="flex items-baseline gap-1 min-w-0 justify-self-start">
          <span className="text-sm font-bold display-number text-primary whitespace-nowrap tabular-nums tracking-tight">
            <AnimatedNumber value={weightLost} format={(n) => n.toFixed(1)} />
          </span>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">kg lost</span>
        </div>
        <span className="text-sm font-bold display-number bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent whitespace-nowrap justify-self-center px-1 tabular-nums tracking-tight">
          <AnimatedNumber value={displayProgress} format={(n) => `${Math.round(n)}%`} />
        </span>
        <div className="flex items-baseline gap-1 min-w-0 justify-self-end">
          <span className="text-sm font-bold display-number text-secondary whitespace-nowrap tabular-nums tracking-tight">
            <AnimatedNumber value={Math.max(0, weightRemaining)} format={(n) => n.toFixed(1)} />
          </span>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">kg to go</span>
        </div>
      </div>

      {/* Current / Target — one-line tabular row. `kg` only on the
          target so the line stays compact on narrow widgets; `nowrap`
          stops the trailing unit from wrapping off the card. */}
      <div className="text-[9px] text-muted-foreground/60 text-center mt-1.5 whitespace-nowrap tabular-nums">
        {currentWeight.toFixed(1)} → {goalWeight.toFixed(1)} kg
      </div>
    </div>
  );
});
