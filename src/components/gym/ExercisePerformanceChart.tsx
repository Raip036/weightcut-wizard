import { memo, useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { GymSet } from "@/pages/gym/types";

type TimeFilter = "1W" | "1M" | "3M" | "ALL";
type ChartType = "weight" | "volume" | "1rm";

interface ExercisePerformanceChartProps {
  sets: GymSet[];
  loading?: boolean;
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card-surface rounded-xs border border-border px-3 py-2 shadow-xl text-xs">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} className="display-number text-sm">
          {p.value.toFixed(1)} <span className="text-muted-foreground font-normal">{p.name}</span>
        </p>
      ))}
    </div>
  );
}

export const ExercisePerformanceChart = memo(function ExercisePerformanceChart({ sets, loading }: ExercisePerformanceChartProps) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("3M");
  const [chartType, setChartType] = useState<ChartType>("weight");

  if (loading) {
    return <div className="h-52 rounded-xs shimmer-skeleton" />;
  }

  if (sets.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-sm text-muted-foreground rounded-xs bg-muted/20">
        No data yet
      </div>
    );
  }

  const now = Date.now();
  const filterMs: Record<TimeFilter, number> = {
    "1W": 7 * 24 * 60 * 60 * 1000,
    "1M": 30 * 24 * 60 * 60 * 1000,
    "3M": 90 * 24 * 60 * 60 * 1000,
    "ALL": Infinity,
  };

  const filteredSets = sets
    .filter(s => now - new Date(s.created_at).getTime() < filterMs[timeFilter])
    .reverse();

  // Group by date, take best per date
  const dateMap = new Map<string, { weight: number; volume: number; reps: number; estimated1rm: number }>();
  for (const s of filteredSets) {
    const date = s.created_at.split("T")[0];
    const existing = dateMap.get(date);
    const vol = (s.weight_kg ?? 0) * s.reps;
    const e1rm = s.reps === 1 ? (s.weight_kg ?? 0) : (s.weight_kg ?? 0) * (1 + s.reps / 30);
    if (!existing) {
      dateMap.set(date, { weight: s.weight_kg ?? 0, volume: vol, reps: s.reps, estimated1rm: e1rm });
    } else {
      if ((s.weight_kg ?? 0) > existing.weight) existing.weight = s.weight_kg ?? 0;
      existing.volume = Math.max(existing.volume, vol);
      existing.estimated1rm = Math.max(existing.estimated1rm, e1rm);
    }
  }

  const data = Array.from(dateMap.entries()).map(([date, vals]) => ({
    date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    ...vals,
  }));

  // Trend calculation
  const dataKey = chartType === "weight" ? "weight" : chartType === "volume" ? "volume" : "estimated1rm";
  const unitLabel = "kg";
  const chartLabel = chartType === "weight" ? "Weight" : chartType === "volume" ? "Volume" : "Est. 1RM";

  let trendPct = 0;
  if (data.length >= 2) {
    const first = data[0][dataKey];
    const last = data[data.length - 1][dataKey];
    if (first > 0) trendPct = ((last - first) / first) * 100;
  }

  const filters: TimeFilter[] = ["1W", "1M", "3M", "ALL"];
  const chartTypes: { key: ChartType; label: string }[] = [
    { key: "weight", label: "Weight" },
    { key: "volume", label: "Volume" },
    { key: "1rm", label: "1RM" },
  ];

  const isAreaChart = chartType === "weight" || chartType === "1rm";

  return (
    <div className="space-y-3">
      {/* Trend indicator */}
      {data.length >= 2 && (
        <div className="flex items-center gap-1.5">
          {trendPct > 0 ? (
            <TrendingUp className="h-3.5 w-3.5 text-green-400" />
          ) : trendPct < 0 ? (
            <TrendingDown className="h-3.5 w-3.5 text-red-400" />
          ) : (
            <Minus className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className={`text-xs font-semibold tabular-nums ${
            trendPct > 0 ? "text-green-400" : trendPct < 0 ? "text-red-400" : "text-muted-foreground"
          }`}>
            {trendPct > 0 ? "+" : ""}{trendPct.toFixed(1)}%
          </span>
          <span className="text-[10px] text-muted-foreground">
            {chartLabel} trend
          </span>
        </div>
      )}

      {/* Filter + chart type pills */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
        <div className="flex items-center gap-1 flex-wrap">
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setTimeFilter(f)}
              className={`px-2.5 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-200 ${
                timeFilter === f
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-0" />
        <div className="flex bg-muted/30 rounded-full p-0.5 shrink-0">
          {chartTypes.map(ct => (
            <button
              key={ct.key}
              onClick={() => setChartType(ct.key)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all duration-200 ${
                chartType === ct.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              {ct.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          {isAreaChart ? (
            <AreaChart data={data}>
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.15} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                width={40}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke="hsl(var(--primary))"
                strokeWidth={2.5}
                fill="url(#chartGradient)"
                dot={{ r: 4, fill: "hsl(var(--primary))", stroke: "hsl(var(--background))", strokeWidth: 2 }}
                activeDot={{ r: 6, fill: "hsl(var(--primary))", stroke: "hsl(var(--background))", strokeWidth: 2 }}
                name={`${chartLabel} (${unitLabel})`}
                animationDuration={0}
              />
            </AreaChart>
          ) : (
            <BarChart data={data}>
              <defs>
                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.15} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                width={40}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar
                dataKey="volume"
                fill="url(#barGradient)"
                radius={[6, 6, 0, 0]}
                name={`Volume (${unitLabel})`}
                animationDuration={0}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
});
