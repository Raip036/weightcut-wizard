import { memo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { DayProjection } from "@/utils/fightWeekEngine";

interface ProjectionChartProps {
  timeline: DayProjection[];
  targetWeight: number;
}

export const ProjectionChart = memo(function ProjectionChart({ timeline, targetWeight }: ProjectionChartProps) {
  const data = timeline.map(d => ({
    label: d.label.replace(" Days Out", "d").replace(" Day Out", "d"),
    weight: d.projectedWeight,
  }));

  // Y-axis domain: target - 1 to max + 1
  const weights = timeline.map(d => d.projectedWeight);
  const yMin = Math.floor(Math.min(...weights, targetWeight) - 0.5);
  const yMax = Math.ceil(Math.max(...weights) + 0.5);

  return (
    <div className="card-surface rounded-xs border border-border/50 p-5 space-y-3">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
        Projected Weight Curve
      </h3>
      <div className="h-[160px] w-full -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="weightGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis
              domain={[yMin, yMax]}
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}`}
              width={32}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "12px",
                color: "hsl(var(--foreground))",
              }}
              labelStyle={{ color: "hsl(var(--muted-foreground))" }}
              formatter={(value: number) => [`${value.toFixed(1)} kg`, "Weight"]}
            />
            <ReferenceLine
              y={targetWeight}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
            <Area
              type="monotone"
              dataKey="weight"
              stroke="hsl(var(--primary))"
              strokeWidth={2.5}
              fill="url(#weightGradient)"
              dot={false}
              activeDot={{ r: 5, fill: "hsl(var(--primary))", strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
