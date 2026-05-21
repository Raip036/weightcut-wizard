import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

interface WeightTrackerChartDatum {
  date: string;
  weight: number | null;
  projected: number | null;
  fightWeekGoal: number | undefined;
  fightNightGoal: number | undefined;
  logId: string | null;
  fullDate: string;
}

interface WeightTrackerChartProps {
  data: WeightTrackerChartDatum[];
  xTicks: string[];
  fightWeekTarget: number | undefined;
  goalWeight: number | undefined;
  hasFightWeekTarget: boolean;
  showProjected: boolean;
  hasAiAnalysis: boolean;
  onChartClick: (data: any) => void;
}

// Thin wrapper around recharts so the ~100KB charts bundle defers until first
// paint via React.lazy in WeightTracker.tsx.
export default function WeightTrackerChart({
  data,
  xTicks,
  fightWeekTarget,
  goalWeight,
  hasFightWeekTarget,
  showProjected,
  hasAiAnalysis,
  onChartClick,
}: WeightTrackerChartProps) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} onClick={onChartClick} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={9} tickLine={false} axisLine={false} opacity={0.5} ticks={xTicks} />
        <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              const entry: any = payload[0].payload;
              const actualWeight = entry.weight;
              const projectedWeight = entry.projected;
              const isProjectedOnly = !actualWeight && projectedWeight;
              return (
                <div className="bg-card border border-border/50 rounded-xs px-3 py-2 shadow-lg">
                  <p className="text-[10px] text-muted-foreground">{entry.fullDate}</p>
                  {actualWeight && <p className="text-base font-bold text-primary">{actualWeight}kg</p>}
                  {isProjectedOnly && <p className="text-base font-bold text-muted-foreground">{projectedWeight.toFixed(1)}kg <span className="text-[10px] font-normal">projected</span></p>}
                </div>
              );
            }
            return null;
          }}
        />
        <ReferenceLine y={fightWeekTarget ?? goalWeight} stroke="hsl(var(--primary))" strokeDasharray="5 5" strokeOpacity={0.3} />
        {hasFightWeekTarget && (
          <ReferenceLine y={goalWeight} stroke="hsl(var(--destructive))" strokeDasharray="3 3" strokeOpacity={0.25} />
        )}
        <Line type="monotone" dataKey="weight" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: "hsl(var(--primary))", r: 3, stroke: "hsl(var(--background))", strokeWidth: 1.5, cursor: "pointer" }} activeDot={{ r: 5, fill: "hsl(var(--primary))", stroke: "hsl(var(--background))", strokeWidth: 2, cursor: "pointer" }} animationDuration={0} />
        {hasAiAnalysis && showProjected && (
          <Line type="monotone" dataKey="projected" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="6 4" dot={false} connectNulls={false} animationDuration={0} />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
