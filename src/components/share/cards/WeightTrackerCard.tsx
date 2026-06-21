import { forwardRef, useMemo } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";
import { StatBlock } from "../templates/StatBlock";
import { MiniChart } from "../templates/MiniChart";
import { usePremium } from "@/hooks/usePremium";

interface WeightLog {
  id: string;
  date: string;
  weight_kg: number;
}

interface WeightTrackerCardProps {
  weightLogs: WeightLog[];
  goalWeight?: number;
  timeFilter: string;
  aspect?: AspectRatio;
}

const TIME_LABELS: Record<string, string> = {
  "1W": "Past Week",
  "1M": "Past Month",
  "ALL": "All Time",
};

export const WeightTrackerCard = forwardRef<HTMLDivElement, WeightTrackerCardProps>(
  ({ weightLogs, goalWeight, timeFilter, aspect = "square" }, ref) => {
    const { isPremium } = usePremium();
    const s = aspect === "story";

    const stats = useMemo(() => {
      if (weightLogs.length === 0) return null;
      const sorted = [...weightLogs].sort((a, b) => a.date.localeCompare(b.date));
      const first = sorted[0].weight_kg;
      const last = sorted[sorted.length - 1].weight_kg;
      const netChange = last - first;
      const weeks = Math.max(
        1,
        (new Date(sorted[sorted.length - 1].date).getTime() - new Date(sorted[0].date).getTime()) /
          (7 * 24 * 60 * 60 * 1000)
      );
      const avgWeekly = netChange / weeks;
      return { first, last, netChange, avgWeekly };
    }, [weightLogs]);

    if (!stats) return null;

    const chartData = weightLogs
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((l) => ({ value: l.weight_kg }));

    const changeColor = stats.netChange <= 0 ? "#22c55e" : "#ef4444";
    const changePrefix = stats.netChange <= 0 ? "" : "+";

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPremium}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: s ? 40 : 24 }}>
          <div>
            <div
              style={{
                fontSize: s ? 18 : 14,
                fontWeight: 700,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: "hsl(var(--primary))",
                marginBottom: s ? 8 : 4,
              }}
            >
              WEIGHT JOURNEY
            </div>
            <div style={{ fontSize: s ? 20 : 16, color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>
              {TIME_LABELS[timeFilter] ?? timeFilter}
            </div>
          </div>
        </div>

        {/* Hero net change */}
        <div style={{ textAlign: "center", marginBottom: s ? 48 : 28 }}>
          <div
            style={{
              fontSize: s ? 112 : 72,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1,
              color: changeColor,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {changePrefix}{stats.netChange.toFixed(1)}
            <span style={{ fontSize: s ? 40 : 28, color: "rgba(255,255,255,0.4)", marginLeft: 4 }}>kg</span>
          </div>
          <div style={{ fontSize: s ? 18 : 14, color: "rgba(255,255,255,0.45)", marginTop: s ? 14 : 8, fontWeight: 600, letterSpacing: "0.1em" }}>
            NET CHANGE
          </div>
        </div>

        {/* Chart: prominent centrepiece */}
        {chartData.length >= 2 && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: s ? 48 : 24,
              background: "rgba(255,255,255,0.03)",
              borderRadius: s ? 24 : 20,
              padding: s ? "20px 8px" : "16px 8px",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <MiniChart
              data={chartData}
              type="area"
              color="hsl(var(--primary))"
              fillColor="hsl(var(--primary) / 0.15)"
              referenceLine={goalWeight}
              referenceColor="#22c55e"
              height={s ? 400 : 280}
              width={960}
            />
          </div>
        )}

        {/* Stat blocks */}
        <div style={{ display: "grid", gridTemplateColumns: s ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: s ? 16 : 12 }}>
          <StatBlock label="Start" value={stats.first.toFixed(1)} unit="kg" size={s ? "large" : "default"} />
          <StatBlock label="Current" value={stats.last.toFixed(1)} unit="kg" size={s ? "large" : "default"} />
          {goalWeight && <StatBlock label="Goal" value={goalWeight.toFixed(1)} unit="kg" color="#22c55e" size={s ? "large" : "default"} />}
          <StatBlock
            label="Avg/Week"
            value={`${stats.avgWeekly <= 0 ? "" : "+"}${stats.avgWeekly.toFixed(2)}`}
            unit="kg"
            color={stats.avgWeekly <= 0 ? "#22c55e" : "#f59e0b"}
            size={s ? "large" : "default"}
          />
        </div>
      </CardShell>
    );
  }
);

WeightTrackerCard.displayName = "WeightTrackerCard";
