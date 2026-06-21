import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/ui/Icon";

interface CampProgressPanelProps {
  /** Camp creation time (ms): start of the progression axis. */
  campStartMs: number;
  /** Fight date (ms): end of the progression axis. */
  fightMs: number;
  /** Days remaining until weigh-in. Drives the phase stepper. */
  daysLeft: number;
  /** Elapsed fraction of the camp, 0-1. Positions the "today" marker. */
  pct: number;
  /** Target / goal weight in kg (converted to the display unit here). */
  goalWeightKg: number;
  /** Display unit, mirrored from the rest of the app. */
  unit: "kg" | "lb";
  /** Current phase pill colour class, e.g. "text-primary" / "text-red-400". */
  phaseText: string;
}

const PHASES = ["Build", "Peak", "Fight Week"] as const;

function phaseIndexFor(daysLeft: number): number {
  if (daysLeft <= 7) return 2;
  if (daysLeft <= 14) return 1;
  return 0;
}

const toDisplay = (kg: number, unit: "kg" | "lb") =>
  unit === "kg" ? kg : kg * 2.20462;

/**
 * Camp progression panel: a phase stepper (Build → Peak → Fight Week) plus a
 * weight-vs-plan trajectory mini-chart. Gives the Camp page real "where am I
 * in this camp" context instead of a wall of nav tiles. Self-contained: pulls
 * its own weight history and renders nothing chart-side until there are ≥ 2
 * logs inside the camp window.
 */
export function CampProgressPanel({
  campStartMs,
  fightMs,
  daysLeft,
  pct,
  goalWeightKg,
  unit,
  phaseText,
}: CampProgressPanelProps) {
  const logs = useQuery(api.weight_logs.listForUser, { limit: 365 });

  const currentPhase = phaseIndexFor(daysLeft);
  const span = Math.max(1, fightMs - campStartMs);

  const chart = useMemo(() => {
    if (!logs) return null;
    // Actual weights inside the camp window, oldest → newest (query is asc).
    const inWindow = logs
      .map((l) => ({ ms: Date.parse(l.date), kg: l.weight_kg }))
      .filter((p) => !isNaN(p.ms) && p.ms >= campStartMs && p.ms <= fightMs + 864e5);
    if (inWindow.length < 2) return { ready: false as const };

    const actual = inWindow.map((p) => ({
      x: Math.max(0, Math.min(1, (p.ms - campStartMs) / span)),
      w: toDisplay(p.kg, unit),
    }));
    const startW = actual[0].w;
    const goalW = toDisplay(goalWeightKg, unit);
    const currentW = actual[actual.length - 1].w;
    const targetTodayW = startW + (goalW - startW) * Math.max(0, Math.min(1, pct));
    // Cutting: lower is better. On pace if we're at/under today's target line.
    const onPace = currentW <= targetTodayW + 0.1;
    const delta = currentW - targetTodayW;

    return {
      ready: true as const,
      actual,
      startW,
      goalW,
      currentW,
      onPace,
      delta,
    };
  }, [logs, campStartMs, fightMs, span, goalWeightKg, unit, pct]);

  // ── SVG geometry ─────────────────────────────────────────────────────
  const W = 100;
  const H = 44;
  const PAD_X = 2;
  const PAD_Y = 5;

  const svg = useMemo(() => {
    if (!chart || !chart.ready) return null;
    const ys = [
      ...chart.actual.map((p) => p.w),
      chart.startW,
      chart.goalW,
    ];
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    const range = max - min || 1;
    const mapX = (x: number) => PAD_X + x * (W - PAD_X * 2);
    const mapY = (w: number) =>
      PAD_Y + (1 - (w - min) / range) * (H - PAD_Y * 2);

    const actualPts = chart.actual
      .map((p) => `${mapX(p.x).toFixed(2)},${mapY(p.w).toFixed(2)}`)
      .join(" ");
    const targetPts = `${mapX(0).toFixed(2)},${mapY(chart.startW).toFixed(2)} ${mapX(1).toFixed(2)},${mapY(chart.goalW).toFixed(2)}`;
    const todayX = mapX(Math.max(0, Math.min(1, pct)));
    return { actualPts, targetPts, todayX };
  }, [chart, pct]);

  return (
    <div className="rounded-2xl card-surface border border-primary/15 p-4">
      {/* ── Phase stepper ─────────────────────────────────────────────── */}
      {/* Dots sit in equal-width columns so their centres land at evenly
          spaced fractions (1/6, 1/2, 5/6 for three phases) regardless of how
          wide each label is. The connector segments are drawn as an absolute
          overlay so each spans exactly one column-width, guaranteeing the
          Build→Peak and Peak→Fight Week lines are identical lengths. */}
      <div className={`relative ${phaseText}`}>
        {/* Connector overlay: behind the dots, aligned to the dot-row centre. */}
        <div className="pointer-events-none absolute inset-x-0 top-[6px] flex">
          {/* Lead-in spacer reaches the first dot's centre (50/N %). */}
          <div style={{ flexBasis: `${50 / PHASES.length}%` }} className="shrink-0" />
          {PHASES.slice(0, -1).map((_, i) => (
            <div
              key={i}
              style={{ flexBasis: `${100 / PHASES.length}%` }}
              className="shrink-0 px-1.5"
            >
              <div className="h-0.5 w-full rounded-full overflow-hidden bg-muted-foreground/15">
                <div
                  className="h-full bg-current rounded-full transition-all duration-500"
                  style={{ width: i < currentPhase ? "100%" : "0%" }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Dots + labels: one equal column per phase. */}
        <div
          className="relative grid"
          style={{ gridTemplateColumns: `repeat(${PHASES.length}, minmax(0, 1fr))` }}
        >
          {PHASES.map((label, i) => {
            const done = i < currentPhase;
            const active = i === currentPhase;
            return (
              <div key={label} className="flex flex-col items-center gap-1">
                {/* Fixed-height wrapper keeps every dot's centre on the same
                    line so the connector overlay aligns regardless of dot size. */}
                <span className="flex h-3.5 items-center">
                  <span
                    className={`rounded-full transition-colors ${
                      active
                        ? "h-3.5 w-3.5 bg-current"
                        : done
                          ? "h-2.5 w-2.5 bg-current"
                          : "h-2.5 w-2.5 bg-muted-foreground/30"
                    }`}
                  />
                </span>
                <span
                  className={`text-[10px] font-semibold tracking-tight whitespace-nowrap ${
                    active
                      ? "text-foreground"
                      : done
                        ? "text-foreground/70"
                        : "text-muted-foreground/50"
                  }`}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Weight-vs-plan trajectory ─────────────────────────────────── */}
      <div className="mt-4 pt-3 border-t border-border/40">
        <div className="flex items-center justify-between mb-2">
          <span className="text-micro font-medium uppercase tracking-[0.1em] text-muted-foreground/80">
            Weight vs plan
          </span>
          {chart?.ready && (
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-semibold ${
                chart.onPace ? "text-func-recovery-green" : "text-func-warning-yellow"
              }`}
            >
              <Icon
                name={chart.onPace ? "checkmarkCircle" : "alertCircleOutline"}
                size={11}
              />
              {chart.onPace ? "On pace" : `${chart.delta > 0 ? "+" : ""}${chart.delta.toFixed(1)}${unit}`}
            </span>
          )}
        </div>

        {chart?.ready && svg ? (
          <>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              width="100%"
              height="56"
              aria-hidden="true"
            >
              {/* Today marker */}
              <line
                x1={svg.todayX}
                y1={0}
                x2={svg.todayX}
                y2={H}
                stroke="hsl(var(--foreground))"
                strokeOpacity={0.15}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              {/* Plan target line: dashed, muted */}
              <polyline
                points={svg.targetPts}
                fill="none"
                stroke="hsl(var(--muted-foreground))"
                strokeOpacity={0.5}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
              />
              {/* Actual weight line: solid primary */}
              <polyline
                points={svg.actualPts}
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="flex items-center justify-between mt-2 text-[11px] tabular-nums">
              <span className="text-muted-foreground">
                Now <span className="text-foreground font-semibold">{chart.currentW.toFixed(1)}{unit}</span>
              </span>
              <span className="text-muted-foreground inline-flex items-center">
                <span className="inline-block w-3 mr-1 border-t border-dashed border-muted-foreground/60 align-middle" />
                Target <span className="text-foreground font-semibold ml-1">{chart.goalW.toFixed(1)}{unit}</span>
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-3 text-center">
            <Icon name="trendingDownOutline" size={18} className="text-muted-foreground/40 mb-1" />
            <p className="text-note text-muted-foreground">
              Log your weight to see your trajectory
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
