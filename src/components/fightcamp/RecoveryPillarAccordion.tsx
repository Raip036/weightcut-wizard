import { useState, lazy, Suspense } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import type { AllMetrics } from "@/utils/performanceEngine";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { MiniSparkline } from "./_MiniSparkline";
import { WeeklyLoadPlan } from "./WeeklyLoadPlan";

// Lazy-load StrainChart so the recharts bundle (~100KB) defers until the
// Load pillar is actually expanded.
const StrainChart = lazy(() => import("./StrainChart").then(m => ({ default: m.StrainChart })));

// ── Types ──────────────────────────────────────────────────────────────

export type PillarKey = "recovery" | "body" | "load";

interface RecoveryPillarAccordionProps {
  metrics: AllMetrics;
  sleepLogs: { date: string; hours: number }[];
  /** Optional controlled-open key. When provided, parent owns expansion state. */
  open?: PillarKey | null;
  /** Called when the user toggles a pillar. Required if `open` is provided. */
  onOpenChange?: (next: PillarKey | null) => void;
  /** Optional ref map so parent can scroll a specific pillar into view. */
  pillarRefs?: React.MutableRefObject<Partial<Record<PillarKey, HTMLDivElement | null>>>;
}

interface PillarMeta {
  key: PillarKey;
  label: string;
  iconName: IonIconName;
  iconTone: string;
  reason: string; // copy used when the pillar is "Building…"
}

// ── Inline helpers (copied from RecoveryDashboard.tsx, will be ─────────
// consolidated in T12). Map a normalized 0-1 fraction to a Tailwind
// text-color class. When the metric is inverted (low = bad), pass
// `invert: true` so high values come back green and low values come back red.
function tierColor(value: number, max: number, invert = false): string {
  const raw = Math.max(0, Math.min(1, value / (max || 1)));
  const pct = invert ? 1 - raw : raw;
  if (pct >= 0.75) return "text-rose-400";
  if (pct >= 0.5) return "text-amber-400";
  if (pct >= 0.25) return "text-emerald-400";
  return "text-emerald-500/60";
}

function tierBg(value: number, max: number, invert = false): string {
  const raw = Math.max(0, Math.min(1, value / (max || 1)));
  const pct = invert ? 1 - raw : raw;
  if (pct >= 0.75) return "bg-rose-400";
  if (pct >= 0.5) return "bg-amber-400";
  if (pct >= 0.25) return "bg-emerald-400";
  return "bg-emerald-500/60";
}

// For pillar sub-scores, higher is better (100 = great, 0 = bad).
// Use the inverted ramp so >=75 reads green, mid reads amber, low reads red.
function pillarScoreColor(score: number): string {
  return tierColor(score, 100, true);
}

// ── Inline copy of SleepSparkline (copied from RecoveryDashboard.tsx) ───
// Kept local (PillarSleepSparkline) so this component stays self-contained
// while the dashboard is being rewritten in T12. The task spec asks for a
// `_PillarSleepSparkline` private name; we use the PascalCase form because
// JSX treats lowercase-starting tag names as intrinsic DOM elements.
function PillarSleepSparkline({ logs }: { logs: { date: string; hours: number }[] }) {
  if (logs.length === 0) return null;
  const max = Math.max(9, ...logs.map(l => l.hours));
  return (
    <div className="flex items-end gap-1 h-12">
      {logs.map((l) => {
        const pct = Math.max(8, (l.hours / max) * 100);
        const colour =
          l.hours >= 7
            ? "bg-func-recovery-green/60"
            : l.hours >= 6
              ? "bg-func-warning-yellow/60"
              : "bg-func-danger-red/60";
        return (
          <div key={l.date} className="flex-1 flex flex-col items-center gap-1">
            <div
              className={`w-full rounded-sm ${colour}`}
              style={{ height: `${pct}%` }}
              title={`${l.date}: ${l.hours}h`}
            />
            <span className="text-[9px] text-muted-foreground tabular-nums">{l.hours.toFixed(0)}</span>
          </div>
        );
      })}
    </div>
  );
}

// Camp-phase pill copy by phase.
function phaseCopy(phase: AllMetrics["calibration"]["phase"] | undefined): {
  label: string;
  tone: string;
  hint: string;
} {
  switch (phase) {
    case "build":
      return {
        label: "Build phase",
        tone: "text-func-warning-yellow border-func-warning-yellow/30 bg-func-warning-yellow/10",
        hint: "Volume rising, expect more strain",
      };
    case "peak":
      return {
        label: "Peak phase",
        tone: "text-func-danger-red border-func-danger-red/30 bg-func-danger-red/10",
        hint: "Highest load week of camp",
      };
    case "taper":
      return {
        label: "Taper",
        tone: "text-blue-300 border-blue-300/30 bg-blue-300/10",
        hint: "Easing off, recovery is the priority",
      };
    default:
      return {
        label: "Off-camp",
        tone: "text-muted-foreground border-border/40 bg-muted/20",
        hint: "Maintenance training",
      };
  }
}

// Contact-load zone styling matches the rest of the recovery palette.
function contactZoneStyle(zone: AllMetrics["contactRiskZone"]): string {
  switch (zone) {
    case "low":
      return "text-func-recovery-green";
    case "moderate":
      return "text-func-warning-yellow";
    case "high":
      return "text-func-danger-red";
    case "critical":
      return "text-func-danger-red";
    default:
      return "text-muted-foreground";
  }
}

const PILLAR_META: Record<PillarKey, PillarMeta> = {
  recovery: {
    key: "recovery",
    label: "Recovery",
    iconName: "bedOutline",
    iconTone: "text-blue-300 border border-blue-300/30",
    reason: "We need a few nights of sleep data to grade your recovery.",
  },
  body: {
    key: "body",
    label: "Body",
    iconName: "pulseOutline",
    iconTone: "text-primary border border-primary/30",
    reason: "Complete a check-in to unlock your body breakdown.",
  },
  load: {
    key: "load",
    label: "Load",
    iconName: "barChartOutline",
    iconTone: "text-func-recovery-green border border-func-recovery-green/30",
    reason: "We need 14 training days in the last 28 to grade your load.",
  },
};

// ── Component ──────────────────────────────────────────────────────────

export function RecoveryPillarAccordion({
  metrics,
  sleepLogs,
  open: openProp,
  onOpenChange,
  pillarRefs,
}: RecoveryPillarAccordionProps) {
  const [openInternal, setOpenInternal] = useState<PillarKey | null>(null);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openInternal;
  const toggle = (key: PillarKey) => {
    const next: PillarKey | null = open === key ? null : key;
    if (isControlled) onOpenChange?.(next);
    else setOpenInternal(next);
  };

  const { pillars } = metrics;

  // ── Real "still building" countdown for the Load pillar ──
  // loadConfidence is already on AllMetrics, so we can show the true
  // N-of-14 training-day progress rather than generic copy.
  const lc = metrics.loadConfidence;
  const loadBuildingHint =
    lc && typeof lc.trainingDaysIn28d === "number" && typeof lc.required === "number" ? (
      <BuildingCountdown
        done={lc.trainingDaysIn28d}
        required={lc.required}
        label="training days"
        unlockLabel="ACWR unlocks at"
      />
    ) : (
      <p className="text-[11px] text-muted-foreground/80 leading-snug">
        Log ~14 training days to unlock load tracking.
      </p>
    );

  const bodyBuildingHint = (
    <p className="text-[11px] text-muted-foreground/80 leading-snug">
      Do your daily check-in (sleep, soreness, fatigue, stress) to unlock this — it sharpens over
      ~2 weeks as it learns your baseline.
    </p>
  );

  const recoveryBuildingHint = (
    <p className="text-[11px] text-muted-foreground/80 leading-snug">
      Log your sleep each night to keep this accurate.
    </p>
  );

  // ── 7-day sparkline series per pillar ──
  // Recovery → sleep hours; Body → soreness (1-7, inverted); Load → daily load.
  const recovery7d = sleepLogs.slice(-7).map(l => l.hours);
  const sorenessSeries = metrics.recentSessions
    .slice(-7)
    .map(s => Number(s.soreness_level) || 0)
    .filter(v => v > 0);
  const body7d = sorenessSeries.length ? sorenessSeries : [];
  const load7d = metrics.strainHistory.slice(-7).map(d => d.dailyLoad);

  const assignRef = (key: PillarKey) => (el: HTMLDivElement | null) => {
    if (pillarRefs) pillarRefs.current[key] = el;
  };

  return (
    <div className="space-y-2.5">
      <PillarRow
        meta={PILLAR_META.recovery}
        score={pillars.recovery}
        sparklineValues={recovery7d}
        open={open === "recovery"}
        onToggle={() => toggle("recovery")}
        index={0}
        rowRef={assignRef("recovery")}
        buildingHint={recoveryBuildingHint}
      >
        <RecoveryDrilldown metrics={metrics} sleepLogs={sleepLogs} />
      </PillarRow>

      <PillarRow
        meta={PILLAR_META.body}
        score={pillars.body}
        sparklineValues={body7d}
        // Soreness is inverted (high = bad); pass invert so the sparkline
        // colour matches the score interpretation.
        sparklineInvert
        sparklineMax={7}
        open={open === "body"}
        onToggle={() => toggle("body")}
        index={1}
        rowRef={assignRef("body")}
        buildingHint={bodyBuildingHint}
      >
        <BodyDrilldown metrics={metrics} />
      </PillarRow>

      <PillarRow
        meta={PILLAR_META.load}
        score={pillars.load}
        sparklineValues={load7d}
        sparklineMax={Math.max(1, ...load7d, 1)}
        open={open === "load"}
        onToggle={() => toggle("load")}
        index={2}
        rowRef={assignRef("load")}
        buildingHint={loadBuildingHint}
      >
        <LoadDrilldown metrics={metrics} />
      </PillarRow>
    </div>
  );
}

// ── PillarRow ─────────────────────────────────────────────────────────
// Single card. Collapsed: icon + label + score + sparkline + chevron.
// Expanded: drill-down content via AnimatePresence height: "auto".
// Mirrors the motion config of `ExpandableMetricCard` in RecoveryDashboard.

interface PillarRowProps {
  meta: PillarMeta;
  score: number | null;
  sparklineValues: number[];
  sparklineInvert?: boolean;
  sparklineMax?: number;
  open: boolean;
  onToggle: () => void;
  index: number;
  children: React.ReactNode;
  rowRef?: (el: HTMLDivElement | null) => void;
  /** Extra hint shown under the "Building…" empty state (e.g. a real countdown). */
  buildingHint?: React.ReactNode;
}

function PillarRow({
  meta,
  score,
  sparklineValues,
  sparklineInvert,
  sparklineMax,
  open,
  onToggle,
  index,
  children,
  rowRef,
  buildingHint,
}: PillarRowProps) {
  const prefersReduced = useReducedMotion();
  const isBuilding = score === null;
  const scoreColor = isBuilding ? "text-muted-foreground" : pillarScoreColor(score as number);
  const sparkColor = isBuilding
    ? "text-muted-foreground/40"
    : tierColor(
        sparklineValues[sparklineValues.length - 1] ?? 0,
        sparklineMax ?? 100,
        sparklineInvert,
      );
  const showSparkline = sparklineValues.length > 0;

  return (
    <motion.div
      ref={rowRef}
      initial={prefersReduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, type: "spring", damping: 24, stiffness: 260 }}
      className={`card-surface rounded-2xl border border-border/50 overflow-hidden ${isBuilding ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left active:bg-muted/10 transition-colors"
        aria-expanded={open}
        aria-label={`${meta.label} pillar, ${isBuilding ? "building" : `score ${score}`}`}
      >
        <div className="flex items-center gap-3 p-4">
          <div
            className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center ${meta.iconTone}`}
          >
            <Icon name={meta.iconName} size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/70">
              {meta.label}
            </div>
            <div className="mt-0.5 flex items-baseline flex-wrap gap-x-1">
              {isBuilding ? (
                <span
                  className="text-[18px] font-bold tabular-nums text-muted-foreground"
                  title={meta.reason}
                >
                  Building…
                </span>
              ) : (
                <>
                  <span className={`text-[22px] font-bold tabular-nums ${scoreColor}`}>
                    {Math.round(score as number)}
                  </span>
                  <span className="text-muted-foreground text-[12px] ml-1">/ 100</span>
                </>
              )}
            </div>
          </div>
          {showSparkline && (
            <MiniSparkline values={sparklineValues} color={sparkColor} className="ml-2 shrink-0" />
          )}
          <motion.div
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="shrink-0 text-muted-foreground ml-1"
          >
            <Icon name="chevronDownOutline" size={16} />
          </motion.div>
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ height: { duration: 0.25 }, opacity: { duration: 0.2 } }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-border/30">
              {isBuilding ? (
                <BuildingEmptyState reason={meta.reason} hint={buildingHint} />
              ) : (
                children
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function BuildingEmptyState({
  reason,
  hint,
}: {
  reason: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="py-3 text-center">
      <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-muted/30 text-muted-foreground mb-2">
        <Icon name="hourglassOutline" size={18} />
      </div>
      <p className="text-[13px] font-semibold text-foreground">Still learning your baseline</p>
      <p className="mt-1 text-[12px] text-muted-foreground leading-snug max-w-[34ch] mx-auto">
        {reason}
      </p>
      {hint && <div className="mt-2 max-w-[34ch] mx-auto">{hint}</div>}
    </div>
  );
}

// Real progress countdown shown while a pillar is still "Building…".
// Renders an N-of-M line + a thin progress track so the user can see how
// close they are to unlocking the score. Reduced-motion safe (CSS width only,
// no animation) and iOS-safe (no shadow/blur).
function BuildingCountdown({
  done,
  required,
  label,
  unlockLabel,
}: {
  done: number;
  required: number;
  label: string;
  unlockLabel: string;
}) {
  const safeDone = Math.max(0, Math.min(done, required));
  const remaining = Math.max(0, required - safeDone);
  const pct = required > 0 ? Math.round((safeDone / required) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-muted-foreground/80 leading-snug">
        Log your training sessions —{" "}
        <span className="font-semibold text-foreground tabular-nums">
          {safeDone} of {required}
        </span>{" "}
        {label}.{" "}
        <span className="text-muted-foreground/70">
          {unlockLabel} {required}
          {remaining > 0 ? ` (${remaining} to go)` : ""}.
        </span>
      </p>
      <div
        className="h-1.5 w-full rounded-full bg-muted/30 overflow-hidden"
        role="progressbar"
        aria-valuenow={safeDone}
        aria-valuemin={0}
        aria-valuemax={required}
      >
        <div
          className="h-full rounded-full bg-func-recovery-green/70"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Drill-downs ────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xs bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="mt-1 text-[22px] font-bold tabular-nums text-foreground">{value}</div>
      {hint && <div className="mt-1 text-[10px] text-muted-foreground/80 leading-snug">{hint}</div>}
    </div>
  );
}

function RecoveryDrilldown({
  metrics,
  sleepLogs,
}: {
  metrics: AllMetrics;
  sleepLogs: { date: string; hours: number }[];
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Last night"
          value={metrics.latestSleep > 0 ? `${metrics.latestSleep.toFixed(1)}h` : "-"}
        />
        <StatTile
          label="3-night average"
          value={metrics.avgSleepLast3 > 0 ? `${metrics.avgSleepLast3.toFixed(1)}h` : "-"}
        />
      </div>
      {sleepLogs.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">
            Last 7 nights
          </div>
          <PillarSleepSparkline logs={sleepLogs.slice(-7)} />
        </div>
      )}
      <div className="mt-3 text-[12px] text-muted-foreground leading-snug">
        Sleep score blends duration vs. your needs and recent consistency. Aim for 7-9 hours, and
        log your sleep each night to keep this accurate.
      </div>
    </>
  );
}

function BodyDrilldown({ metrics }: { metrics: AllMetrics }) {
  const hooper = metrics.hooperComponents;
  const showDeficitChip = metrics.deficitImpactScore != null && metrics.deficitImpactScore < 50;

  // Map 1-7 Hooper sub-scores into the same "out of 7" tile format. Higher is
  // worse on the source scale; we display the raw number with a colour hint.
  const subColor = (v: number) => tierColor(v, 7);

  // 7d soreness mini-sparkline from recent sessions.
  const sorenessSeries = metrics.recentSessions
    .slice(-7)
    .map(s => Number(s.soreness_level) || 0)
    .filter(v => v > 0);

  return (
    <>
      {hooper ? (
        <div className="grid grid-cols-2 gap-3">
          <StatTile
            label="Sleep quality"
            value={<span className={subColor(hooper.sleep)}>{hooper.sleep.toFixed(0)}</span>}
            hint="1 = great · 7 = poor"
          />
          <StatTile
            label="Stress"
            value={<span className={subColor(hooper.stress)}>{hooper.stress.toFixed(0)}</span>}
            hint="1 = calm · 7 = wired"
          />
          <StatTile
            label="Fatigue"
            value={<span className={subColor(hooper.fatigue)}>{hooper.fatigue.toFixed(0)}</span>}
            hint="1 = fresh · 7 = wiped"
          />
          <StatTile
            label="Soreness"
            value={<span className={subColor(hooper.soreness)}>{hooper.soreness.toFixed(0)}</span>}
            hint="1 = none · 7 = sharp"
          />
        </div>
      ) : (
        <div className="rounded-xs bg-muted/20 p-4 text-center">
          <p className="text-[13px] font-semibold text-foreground">
            Check in to unlock body breakdown
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            A 20-second daily check-in unlocks Hooper sub-scores.
          </p>
        </div>
      )}

      {sorenessSeries.length > 1 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">
            7d soreness trend
          </div>
          <MiniSparkline
            values={sorenessSeries}
            color={tierColor(sorenessSeries[sorenessSeries.length - 1], 7)}
            className="w-full h-6"
          />
        </div>
      )}

      {showDeficitChip && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-func-warning-yellow/10 border border-func-warning-yellow/30 px-3 py-1.5 text-[11px] font-semibold text-func-warning-yellow">
          <Icon name="warningOutline" size={14} />
          <span>Caloric deficit dragging recovery. Eat more or ease off.</span>
        </div>
      )}

      {/* What moves this score */}
      <p className="mt-3 text-[11px] text-muted-foreground/80 leading-snug">
        Driven by your daily check-ins. Log one each day so it tracks how fresh vs fatigued you are.
      </p>
    </>
  );
}

function LoadDrilldown({ metrics }: { metrics: AllMetrics }) {
  const phase = phaseCopy(metrics.calibration.phase);
  const ratio = Number.isFinite(metrics.loadRatio) ? metrics.loadRatio : 0;
  const monotony = metrics.weeklyMonotony;
  const strain = metrics.weeklyStrain;
  const monotonyHigh = monotony > 2;
  const strainHigh = strain > 6000;

  return (
    <>
      {/* EWMA acute / chronic / ACWR */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="EWMA acute" value={metrics.acuteLoad.toFixed(0)} />
        <StatTile label="EWMA chronic" value={metrics.chronicLoad.toFixed(0)} />
        <StatTile label="ACWR" value={ratio.toFixed(2)} />
      </div>

      {/* Camp phase pill */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold border ${phase.tone}`}
        >
          <Icon name="flagOutline" size={12} />
          {phase.label}
        </span>
        <span className="text-[11px] text-muted-foreground">{phase.hint}</span>
      </div>

      {/* Foster metrics row */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <StatTile
          label="Monotony"
          value={monotony.toFixed(2)}
          hint={monotonyHigh ? "Same intensity every day, vary your week" : undefined}
        />
        <StatTile
          label="Weekly strain"
          value={strain.toFixed(0)}
          hint={strainHigh ? "Foster danger zone, deload incoming" : undefined}
        />
      </div>

      {/* Contact load */}
      <div className="mt-3 rounded-xs bg-muted/20 p-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Contact rounds (7d)
          </div>
          <div className="mt-1 text-[22px] font-bold tabular-nums text-foreground">
            {metrics.contactRoundsLast7d}
          </div>
        </div>
        <span
          className={`text-[11px] font-bold uppercase tracking-wider ${contactZoneStyle(metrics.contactRiskZone)}`}
        >
          {metrics.contactRiskZone}
        </span>
      </div>

      {/* StrainChart: lazy-loaded */}
      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">
          7-day strain trend
        </div>
        <Suspense
          fallback={<div className="h-[180px] w-full animate-pulse bg-muted/20 rounded-xs" />}
        >
          <StrainChart strainHistory={metrics.strainHistory} forecast={metrics.forecast} />
        </Suspense>
      </div>

      {/* WeeklyLoadPlan nested inside */}
      <div className="mt-4 pt-3 border-t border-border/30">
        <WeeklyLoadPlan metrics={metrics} />
      </div>

      {/* What moves this score */}
      <p className="mt-3 text-[11px] text-muted-foreground/80 leading-snug">
        Driven by your logged session load (duration × RPE) over the last 4 weeks. Keep logging
        every session.
      </p>
    </>
  );
}
