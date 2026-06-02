/**
 * HealthTilesPanel — Recovery page tiles for connected users.
 *
 * Shown on the Recovery page when `profile.healthDataTier !== "tier_0"`.
 * Reads the last N days of `daily_health_summary` via
 * `api.health.listDailySummary` and surfaces four tiles:
 *   - HRV vs. 14-day baseline
 *   - Resting HR vs. 14-day baseline
 *   - Sleep duration + quality (deep + REM)
 *   - Wrist temperature deviation
 *
 * Each tile shows: current value, "+X% from baseline" delta, and a
 * 7-day sparkline.
 *
 * Edge case (spec §10.4): "Watch connected, no data yet" — first sync
 * returned empty. We surface a friendly "Syncing — first scores
 * tomorrow morning" state instead of a broken empty grid.
 */

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { motion } from "motion/react";
import {
  Activity,
  HeartPulse,
  Moon,
  Thermometer,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton-loader";
import { cn } from "@/lib/utils";
import { api } from "@/../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import ErrorBoundary from "@/components/ErrorBoundary";

// ─── Types — local view-models only ────────────────────────────────────

interface DailySummary {
  date: string;                    // YYYY-MM-DD
  hrvAvgMs?: number | null;
  restingHrBpm?: number | null;
  sleepMinutes?: number | null;
  sleepDeepMinutes?: number | null;
  sleepRemMinutes?: number | null;
  sleepEfficiencyPct?: number | null;
  wristTempDeltaC?: number | null;
  // any other fields are ignored by this view
}

interface TileSpec {
  key: string;
  label: string;
  icon: JSX.Element;
  value: string | null;
  delta: { pct: number; positiveIsGood: boolean } | null;
  spark: number[];
  emptyHint: string;
}

interface HealthTilesPanelProps {
  /** Optional override for days of history to fetch. Default: 14. */
  days?: number;
  className?: string;
}

export function HealthTilesPanel({
  days = 14,
  className,
}: HealthTilesPanelProps): JSX.Element {
  // Wrap inner content so a Convex / render error here surfaces a small
  // local fallback instead of crashing the Recovery page.
  return (
    <ErrorBoundary fallback={<HealthTilesErrorFallback className={className} />}>
      <HealthTilesPanelInner days={days} className={className} />
    </ErrorBoundary>
  );
}

function HealthTilesPanelInner({
  days = 14,
  className,
}: HealthTilesPanelProps): JSX.Element {
  const { userId } = useUser();
  // Skip the query until auth has resolved. Backend also returns null on
  // unauth so we cover both cases below.
  const raw = useQuery(
    api.health.listDailySummary,
    userId ? { days } : "skip",
  ) as DailySummary[] | null | undefined;

  // Sort oldest → newest so the sparkline reads left-to-right.
  const summaries = useMemo<DailySummary[]>(() => {
    if (!raw) return [];
    return [...raw].sort((a, b) => a.date.localeCompare(b.date));
  }, [raw]);

  // Loading: still resolving the query AND we have auth. (If userId is
  // missing the query is skipped, which also returns undefined — but we
  // shouldn't show a perpetual skeleton in that case, so fall through to
  // the empty state.)
  if (raw === undefined && userId) {
    return <LoadingState className={className} />;
  }

  // Empty / unauth / explicit null from server: treat as "no data yet".
  // The parent page only renders this panel for tier_1+ users, so this
  // typically means first sync is still pending.
  if (!raw || summaries.length === 0) {
    return <EmptySyncingState className={className} />;
  }

  const tiles = buildTiles(summaries);
  const populated = tiles.filter((t) => t.value !== null);

  // Edge case: rows exist but every field is null (rare — possible if the
  // user only has step counts which we don't tile). Treat as syncing.
  if (populated.length === 0) {
    return <EmptySyncingState className={className} />;
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map((tile) => (
          <Tile key={tile.key} spec={tile} />
        ))}
      </div>
    </div>
  );
}

function HealthTilesErrorFallback({
  className,
}: {
  className?: string;
}): JSX.Element {
  return (
    <Card
      className={cn(
        "rounded-xs card-surface p-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xs border border-border/50 bg-background/60">
          <HeartPulse
            className="h-4 w-4 text-func-danger-red"
            strokeWidth={2.2}
            aria-hidden
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold tracking-tight">
            Couldn't load health data
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
            Pull to refresh — your tiles will reload once we reconnect.
          </p>
        </div>
      </div>
    </Card>
  );
}

// ─── Tile renderer ─────────────────────────────────────────────────────

function Tile({ spec }: { spec: TileSpec }): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      <Card className="rounded-xs card-surface p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            {spec.icon}
            <span className="text-[10.5px] font-bold uppercase tracking-wider">
              {spec.label}
            </span>
          </div>
          {spec.delta && (
            <DeltaPill
              pct={spec.delta.pct}
              positiveIsGood={spec.delta.positiveIsGood}
            />
          )}
        </div>

        <p className="display-number text-[26px] leading-none tabular-nums text-foreground">
          {spec.value ?? "—"}
        </p>

        {spec.value === null ? (
          <p className="text-[10.5px] text-muted-foreground leading-snug">
            {spec.emptyHint}
          </p>
        ) : (
          <Sparkline data={spec.spark} />
        )}
      </Card>
    </motion.div>
  );
}

function DeltaPill({
  pct,
  positiveIsGood,
}: {
  pct: number;
  positiveIsGood: boolean;
}): JSX.Element {
  const isGood = positiveIsGood ? pct >= 0 : pct <= 0;
  const cls = isGood
    ? "bg-func-recovery-green/15 text-func-recovery-green"
    : "bg-func-warning-yellow/15 text-func-warning-yellow";
  const sign = pct > 0 ? "+" : "";
  return (
    <span
      className={cn(
        "inline-flex h-4 items-center rounded-full px-1.5 text-[9.5px] font-bold tabular-nums",
        cls,
      )}
    >
      {sign}
      {pct.toFixed(0)}%
    </span>
  );
}

function Sparkline({ data }: { data: number[] }): JSX.Element {
  if (data.length < 2) {
    return <div className="h-6" aria-hidden />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 100 - ((v - min) / range) * 100;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="h-6 w-full text-primary/70"
      aria-hidden
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function buildTiles(summaries: DailySummary[]): TileSpec[] {
  // Latest row = "current value". Spark uses last 7 days. Baseline uses
  // the full window (up to 14d) so deltas read against a stable mean.
  const latest = summaries[summaries.length - 1];
  const spark = summaries.slice(-7);

  return [
    buildHrvTile(latest, spark, summaries),
    buildRhrTile(latest, spark, summaries),
    buildSleepTile(latest, spark),
    buildTempTile(latest, spark),
  ];
}

function buildHrvTile(
  latest: DailySummary,
  spark: DailySummary[],
  baseline: DailySummary[],
): TileSpec {
  const value = latest.hrvAvgMs ?? null;
  const baselineMean = mean(baseline.map((d) => d.hrvAvgMs ?? null));
  return {
    key: "hrv",
    label: "HRV",
    icon: <HeartPulse className="h-3.5 w-3.5 text-func-danger-red" />,
    value: value != null ? `${Math.round(value)} ms` : null,
    delta: makeDelta(value, baselineMean, true),
    spark: spark.map((d) => d.hrvAvgMs ?? 0).filter(Boolean),
    emptyHint: "No HRV samples in the last 14 days.",
  };
}

function buildRhrTile(
  latest: DailySummary,
  spark: DailySummary[],
  baseline: DailySummary[],
): TileSpec {
  const value = latest.restingHrBpm ?? null;
  const baselineMean = mean(baseline.map((d) => d.restingHrBpm ?? null));
  return {
    key: "rhr",
    label: "Resting HR",
    icon: <Activity className="h-3.5 w-3.5 text-func-danger-red" />,
    value: value != null ? `${Math.round(value)} bpm` : null,
    // Lower RHR is better, so positiveIsGood = false.
    delta: makeDelta(value, baselineMean, false),
    spark: spark.map((d) => d.restingHrBpm ?? 0).filter(Boolean),
    emptyHint: "No resting HR yet.",
  };
}

function buildSleepTile(
  latest: DailySummary,
  spark: DailySummary[],
): TileSpec {
  const mins = latest.sleepMinutes ?? null;
  // Quality = (deep + REM) / total — shown as a sub-label only.
  const deep = latest.sleepDeepMinutes ?? null;
  const rem = latest.sleepRemMinutes ?? null;
  const qualityPct =
    mins && (deep != null || rem != null)
      ? Math.round(((deep ?? 0) + (rem ?? 0)) / mins * 100)
      : null;
  const value =
    mins != null
      ? `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`
      : null;
  return {
    key: "sleep",
    label: qualityPct != null ? `Sleep · ${qualityPct}% deep+REM` : "Sleep",
    icon: <Moon className="h-3.5 w-3.5 text-indigo-300" />,
    value,
    // No baseline pill — sleep range is too noisy for a daily delta.
    delta: null,
    spark: spark.map((d) => d.sleepMinutes ?? 0).filter(Boolean),
    emptyHint: "No sleep data yet.",
  };
}

function buildTempTile(
  latest: DailySummary,
  spark: DailySummary[],
): TileSpec {
  const delta = latest.wristTempDeltaC ?? null;
  const value =
    delta != null
      ? `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}°C`
      : null;
  return {
    key: "temp",
    label: "Wrist temp",
    icon: <Thermometer className="h-3.5 w-3.5 text-func-carbs-orange" />,
    value,
    // wristTempDelta is already a deviation — render its magnitude.
    delta:
      delta != null
        ? {
            pct: Math.round(Math.abs(delta) * 100),
            // Larger magnitude = worse (potential illness flag).
            positiveIsGood: false,
          }
        : null,
    spark: spark.map((d) => d.wristTempDeltaC ?? 0),
    emptyHint: "Needs a compatible Apple Watch.",
  };
}

function mean(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (filtered.length === 0) return null;
  return filtered.reduce((a, b) => a + b, 0) / filtered.length;
}

function makeDelta(
  value: number | null,
  baseline: number | null,
  positiveIsGood: boolean,
): { pct: number; positiveIsGood: boolean } | null {
  if (value == null || baseline == null || baseline === 0) return null;
  const pct = ((value - baseline) / baseline) * 100;
  if (!Number.isFinite(pct)) return null;
  return { pct, positiveIsGood };
}

// ─── State views ───────────────────────────────────────────────────────

function LoadingState({ className }: { className?: string }): JSX.Element {
  return (
    <div className={cn("grid grid-cols-2 gap-2.5", className)}>
      {Array.from({ length: 4 }).map((_, i) => (
        <Card
          key={i}
          className="rounded-xs card-surface p-3 space-y-2"
        >
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-6 w-full" />
        </Card>
      ))}
    </div>
  );
}

function EmptySyncingState({
  className,
}: {
  className?: string;
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: "easeOut" }}
      className={className}
    >
      <Card className="rounded-xs card-surface p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xs border border-border/50 bg-background/60">
            <HeartPulse
              className="h-4 w-4 text-func-danger-red"
              strokeWidth={2.2}
              aria-hidden
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold tracking-tight">
              Syncing your Health data
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
              Your first recovery scores will land tomorrow morning. Keep
              wearing your watch overnight for HRV.
            </p>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
