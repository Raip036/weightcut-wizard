import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
} from "recharts";
import { Moon, Plus, Minus } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";

type Timeframe = "1W" | "1M" | "3M";

interface SleepRow {
  date: string;
  hours: number;
}

const TIMEFRAME_DAYS: Record<Timeframe, number> = { "1W": 7, "1M": 30, "3M": 90 };

function startDateFor(tf: Timeframe): string {
  const d = new Date();
  d.setDate(d.getDate() - TIMEFRAME_DAYS[tf]);
  return d.toISOString().slice(0, 10);
}

function formatDay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.getDate().toString();
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xs bg-[hsl(0_0%_8%)] border border-border/50 px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-0.5">{label}</p>
      <p className="font-semibold text-foreground">{payload[0].value.toFixed(1)}h</p>
    </div>
  );
};

function todayISO() {
  // Local date — must match what the dashboard's TodayStrip queries so a
  // sleep log made just after midnight local lights up today's Sleep pill
  // rather than getting buried under yesterday's UTC date.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Sleep() {
  const { userId } = useUser();
  const { toast } = useToast();

  const [timeframe, setTimeframe] = useState<Timeframe>("1M");
  // Convex query — reactive, no manual cache or loading state needed.
  const rawLogs = useQuery(api.sleep_logs.listForUser, userId ? { limit: 90 } : "skip");
  const allData: SleepRow[] = useMemo(
    () => (rawLogs ?? []).map(r => ({ date: r.date, hours: Number(r.hours) })).sort((a, b) => a.date.localeCompare(b.date)),
    [rawLogs],
  );
  const loading = rawLogs === undefined;

  // Sleep logger state — upsert keyed on (userId, date), so re-logging today
  // just overwrites the existing row.
  const logSleepMut = useMutation(api.sleep_logs.logSleep);
  const [logDate, setLogDate] = useState<string>(todayISO);
  const [logHours, setLogHours] = useState<number>(8);
  const [saving, setSaving] = useState(false);

  // Pre-fill hours from any existing log for the selected date so the user
  // sees what's currently saved and can adjust from there.
  useEffect(() => {
    const existing = allData.find((r) => r.date === logDate);
    if (existing) setLogHours(existing.hours);
  }, [logDate, allData]);

  const handleSave = async () => {
    if (!userId || saving) return;
    if (!Number.isFinite(logHours) || logHours <= 0 || logHours > 24) {
      toast({ description: "Hours must be between 0 and 24", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await logSleepMut({ date: logDate, hours: logHours });
      triggerHaptic(ImpactStyle.Light);
      toast({ description: `Logged ${logHours.toFixed(1)}h for ${logDate}` });
    } catch {
      toast({ description: "Couldn't save sleep. Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const adjust = (delta: number) => {
    setLogHours((prev) => {
      const next = Math.round((prev + delta) * 2) / 2; // 0.5 increments
      return Math.max(0, Math.min(24, next));
    });
  };
  // Touch unused vars to keep the timeframe signature compatible with the buttons below.
  void startDateFor;
  // No-op effect placeholder kept to preserve existing dependency graph reads.
  useEffect(() => {
    // sleep-logged events are no longer needed — Convex queries are reactive.
  }, [userId]);

  const filtered = useMemo(() => {
    const cutoff = startDateFor(timeframe);
    return allData.filter((r) => r.date >= cutoff);
  }, [allData, timeframe]);

  const stats = useMemo(() => {
    if (!filtered.length) return { avg: 0, best: 0, worst: 0 };
    const vals = filtered.map((r) => r.hours);
    const sum = vals.reduce((a, b) => a + b, 0);
    return {
      avg: sum / vals.length,
      best: Math.max(...vals),
      worst: Math.min(...vals),
    };
  }, [filtered]);

  const chartData = useMemo(
    () => filtered.map((r) => ({ date: formatDay(r.date), hours: r.hours })),
    [filtered]
  );

  if (loading && !allData.length) {
    return (
      <div className="animate-page-in space-y-3 px-5 py-3 sm:p-5 md:p-6 max-w-7xl mx-auto pb-16 md:pb-6">
        <div className="h-6 w-24 rounded bg-muted/30 animate-pulse" />
        <div className="card-surface rounded-xs h-[220px] animate-pulse" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card-surface rounded-xs h-16 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-page-in space-y-3 px-5 py-3 sm:p-5 md:p-6 max-w-7xl mx-auto pb-16 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Moon className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold">Sleep</h1>
        </div>
        <div className="flex gap-1 p-0.5 rounded-xs bg-muted/30">
          {(["1W", "1M", "3M"] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                timeframe === tf
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="card-surface rounded-xs p-3">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <ReferenceArea
              y1={7}
              y2={8}
              fill="hsl(217 91% 58%)"
              fillOpacity={0.05}
              stroke="none"
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[0, "auto"]}
              tick={{ fontSize: 10, fill: "hsl(0 0% 45%)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="hours"
              stroke="hsl(217 91% 58%)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "hsl(217 91% 58%)" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Log sleep — upsert by (userId, date) so re-saving for the same day overwrites */}
      <div className="card-surface rounded-xs border border-border/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Log Sleep</p>
          <input
            type="date"
            value={logDate}
            max={todayISO()}
            onChange={(e) => setLogDate(e.target.value)}
            className="text-xs bg-muted/30 border border-border/40 rounded-xs px-2 py-1 text-foreground"
          />
        </div>
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => adjust(-0.5)}
            disabled={logHours <= 0}
            className="h-10 w-10 rounded-full bg-muted/40 active:bg-muted/60 flex items-center justify-center disabled:opacity-40"
            aria-label="Decrease hours"
          >
            <Minus className="h-4 w-4" />
          </button>
          <div className="flex items-baseline gap-1 tabular-nums">
            <span className="display-number text-3xl font-bold">{logHours.toFixed(1)}</span>
            <span className="text-sm text-muted-foreground">hrs</span>
          </div>
          <button
            type="button"
            onClick={() => adjust(0.5)}
            disabled={logHours >= 24}
            className="h-10 w-10 rounded-full bg-muted/40 active:bg-muted/60 flex items-center justify-center disabled:opacity-40"
            aria-label="Increase hours"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !userId}
          className="w-full h-10 rounded-xs text-sm font-semibold text-white bg-gradient-to-r from-primary to-primary/80 active:scale-[0.98] transition-transform disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {([
          { label: "Average", value: stats.avg },
          { label: "Best", value: stats.best },
          { label: "Worst", value: stats.worst },
        ] as const).map((s) => (
          <div key={s.label} className="card-surface rounded-xs p-3 text-center">
            <p className="text-lg font-bold display-number">{s.value.toFixed(1)}h</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
