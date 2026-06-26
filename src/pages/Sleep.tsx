import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { Icon } from "@/components/ui/Icon";
import { SleepBarChart } from "@/components/SleepBarChart";

type Timeframe = "1W" | "1M" | "3M";

interface SleepRow {
  date: string;
  hours: number;
}

const TIMEFRAME_DAYS: Record<Timeframe, number> = { "1W": 7, "1M": 30, "3M": 90 };
const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  "1W": "This week",
  "1M": "This month",
  "3M": "Last 3 months",
};
const SLEEP_GOAL = 8; // nightly hours target, drives % / debt / baseline

const EYEBROW =
  "text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-semibold";

function startDateFor(tf: Timeframe): string {
  const d = new Date();
  d.setDate(d.getDate() - TIMEFRAME_DAYS[tf]);
  return d.toISOString().slice(0, 10);
}

function formatDay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.getDate().toString();
}

function formatPretty(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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

  const filtered = useMemo(() => {
    const cutoff = startDateFor(timeframe);
    return allData.filter((r) => r.date >= cutoff);
  }, [allData, timeframe]);

  const stats = useMemo(() => {
    if (!filtered.length) return { avg: 0, best: 0, worst: 0, debt: 0 };
    const vals = filtered.map((r) => r.hours);
    const sum = vals.reduce((a, b) => a + b, 0);
    // Sleep debt = total hours below the nightly goal across the range.
    const debt = filtered.reduce((acc, r) => acc + Math.max(0, SLEEP_GOAL - r.hours), 0);
    return {
      avg: sum / vals.length,
      best: Math.max(...vals),
      worst: Math.min(...vals),
      debt,
    };
  }, [filtered]);

  // Most recent night anywhere in the dataset — the hero focuses on it
  // regardless of the selected range so "last night" is always meaningful.
  const lastNight = allData.length ? allData[allData.length - 1] : null;
  const lastPct = lastNight ? Math.round((lastNight.hours / SLEEP_GOAL) * 100) : 0;
  const lastGood = lastNight ? lastNight.hours >= SLEEP_GOAL - 1 : false;

  const chartData = useMemo(
    () => filtered.map((r) => ({ label: formatDay(r.date), hours: r.hours })),
    [filtered]
  );

  const hasData = allData.length > 0;

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading && !allData.length) {
    return (
      <div className="animate-page-in space-y-5 px-5 py-3 sm:p-5 md:p-6 max-w-xl mx-auto pb-16 md:pb-6">
        <div className="h-7 w-24 rounded bg-muted/30 animate-pulse" />
        <div className="card-surface rounded-2xl h-[120px] animate-pulse" />
        <div className="card-surface rounded-2xl h-[150px] animate-pulse" />
        <div className="grid grid-cols-3 gap-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="surface-inset rounded-2xl h-[68px] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-page-in space-y-5 px-5 py-3 sm:p-5 md:p-6 max-w-xl mx-auto pb-16 md:pb-6">
      {/* Header + timeframe control */}
      <div className="flex items-end justify-between pt-1">
        <header>
          <p className={EYEBROW}>{TIMEFRAME_LABEL[timeframe]}</p>
          <h1 className="text-[26px] font-bold leading-tight font-display">Sleep</h1>
        </header>
        <div className="flex gap-1 p-1 rounded-full surface-inset">
          {(["1W", "1M", "3M"] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1 text-[11px] font-semibold rounded-full transition-colors ${
                timeframe === tf
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground/70"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {hasData ? (
        <>
          {/* Hero — last night vs 8h goal */}
          {lastNight && (
            <div className="px-1 text-center">
              <p className={`${EYEBROW} text-center`}>Last night</p>
              <div className="mt-2 flex items-baseline justify-center gap-2">
                <span
                  className={`display-number text-[72px] font-bold leading-none tabular-nums ${
                    lastGood ? "text-func-recovery-green" : "text-func-warning-yellow"
                  }`}
                >
                  {lastNight.hours.toFixed(1)}
                </span>
                <span className="text-[20px] text-muted-foreground">hrs</span>
              </div>
              <p className="mt-2 text-[14px] font-semibold leading-snug">
                <span className={lastGood ? "text-func-recovery-green" : "text-func-warning-yellow"}>
                  {lastPct}%
                </span>{" "}
                <span className="text-muted-foreground">of your {SLEEP_GOAL}h goal</span>
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground/80 leading-snug">
                {lastGood
                  ? "Solid recovery window - keep the streak going tonight."
                  : `${Math.max(0, SLEEP_GOAL - lastNight.hours).toFixed(1)}h short of goal. Aim for an earlier wind-down.`}
              </p>
            </div>
          )}

          {/* Log action — moved HIGH for fast logging */}
          <SleepLogger
            logDate={logDate}
            logHours={logHours}
            saving={saving}
            disabled={!userId}
            maxDate={todayISO()}
            onDateChange={setLogDate}
            onAdjust={adjust}
            onSave={handleSave}
          />

          {/* Weekly bars + 8h baseline (real data) */}
          <div className="px-1">
            <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-primary mb-2">
              Nightly hours
            </p>
            <SleepBarChart data={chartData} goal={SLEEP_GOAL} />
          </div>

          {/* Surface-inset stat tiles */}
          <div className="grid grid-cols-3 gap-2.5">
            <StatInset over="Avg" value={stats.avg} status={stats.avg >= SLEEP_GOAL - 1 ? "good" : undefined} />
            <StatInset over="Best" value={stats.best} status="good" />
            <StatInset over="Debt" value={stats.debt} status={stats.debt > 0 ? "warn" : "good"} />
          </div>
        </>
      ) : (
        <>
          {/* Empty state */}
          <div className="card-surface rounded-2xl p-6 flex flex-col items-center text-center gap-2.5">
            <div className="h-12 w-12 rounded-full surface-inset flex items-center justify-center text-primary">
              <Icon name="moonOutline" size={22} />
            </div>
            <p className="text-[15px] font-semibold">Log your first night</p>
            <p className="text-[12px] text-muted-foreground/80 leading-snug max-w-[15rem]">
              Track sleep to see your trend, average, and debt against an {SLEEP_GOAL}-hour goal.
            </p>
          </div>

          {/* Logger still prominent so the user can act immediately */}
          <SleepLogger
            logDate={logDate}
            logHours={logHours}
            saving={saving}
            disabled={!userId}
            maxDate={todayISO()}
            onDateChange={setLogDate}
            onAdjust={adjust}
            onSave={handleSave}
          />
        </>
      )}
    </div>
  );
}

// ── Logger card ──────────────────────────────────────────────────────────
// Prominent, easy-to-tap. Date is a themed surface-inset pill backed by a
// transparent native <input type="date"> overlay so the real value still
// feeds the mutation while looking native to the app.
function SleepLogger({
  logDate,
  logHours,
  saving,
  disabled,
  maxDate,
  onDateChange,
  onAdjust,
  onSave,
}: {
  logDate: string;
  logHours: number;
  saving: boolean;
  disabled: boolean;
  maxDate: string;
  onDateChange: (v: string) => void;
  onAdjust: (delta: number) => void;
  onSave: () => void;
}) {
  return (
    <div className="card-surface rounded-2xl p-4 space-y-3.5">
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-semibold">Log sleep</p>
        <label className="relative flex items-center gap-1.5 surface-inset rounded-full px-3 py-1.5 text-[11px] text-foreground/90 cursor-pointer active:opacity-80 transition-opacity">
          <Icon name="calendarOutline" size={12} />
          <span className="tabular-nums">{formatPretty(logDate)}</span>
          <Icon name="chevronDownOutline" size={11} />
          {/* Real native date input — invisible, sits over the pill, drives state. */}
          <input
            type="date"
            value={logDate}
            max={maxDate}
            onChange={(e) => onDateChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Sleep log date"
          />
        </label>
      </div>

      <div className="flex items-center justify-center gap-5">
        <button
          type="button"
          onClick={() => onAdjust(-0.5)}
          disabled={logHours <= 0}
          className="h-11 w-11 rounded-full surface-inset flex items-center justify-center text-foreground/80 active:opacity-70 disabled:opacity-40 transition-opacity"
          aria-label="Decrease hours"
        >
          <Icon name="removeOutline" size={18} />
        </button>
        <div className="flex items-baseline gap-1 tabular-nums">
          <span className="display-number text-[40px] font-bold leading-none">{logHours.toFixed(1)}</span>
          <span className="text-[13px] text-muted-foreground">hrs</span>
        </div>
        <button
          type="button"
          onClick={() => onAdjust(0.5)}
          disabled={logHours >= 24}
          className="h-11 w-11 rounded-full surface-inset flex items-center justify-center text-foreground/80 active:opacity-70 disabled:opacity-40 transition-opacity"
          aria-label="Increase hours"
        >
          <Icon name="addOutline" size={18} />
        </button>
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={saving || disabled}
        className="w-full h-11 rounded-full text-[14px] font-semibold text-primary-foreground bg-primary active:scale-[0.98] transition-transform disabled:opacity-60"
      >
        {saving ? "Saving…" : "Log sleep"}
      </button>
    </div>
  );
}

// ── Surface-inset stat tile ────────────────────────────────────────────────
function StatInset({
  over,
  value,
  status,
}: {
  over: string;
  value: number;
  status?: "good" | "warn";
}) {
  const color =
    status === "good"
      ? "text-func-recovery-green"
      : status === "warn"
        ? "text-func-warning-yellow"
        : "text-foreground";
  return (
    <div className="surface-inset rounded-2xl p-3">
      <p className={EYEBROW}>{over}</p>
      <p className="mt-1 flex items-baseline gap-0.5">
        <span className={`text-[20px] font-bold display-number tabular-nums ${color}`}>
          {value.toFixed(1)}
        </span>
        <span className="text-[11px] text-muted-foreground/70">h</span>
      </p>
    </div>
  );
}
