import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";
import { DeltaPill, deltaVerdict } from "./DeltaPill";

type Phase = "build" | "peak" | "fightWeek" | null | undefined;

interface WeightPoint {
  date: string;
  weight_kg: string | number;
}

interface PhaseCoachCardProps {
  phase: Phase;
  daysUntilFight: number | null;
  /**
   * Optional one-liner nudge surfaced from the engine ("Sleep dropped 1.1h
   * vs last week"). Rendered as a secondary signal under the main guidance.
   */
  signal?: string | null;
  /** Recent weight logs (last 30 days). Used to render the actual line. */
  weightLogs?: WeightPoint[];
  /** Today's authoritative weight; falls back to the last log. */
  currentWeight?: number | null;
  /** Weigh-in target (kg). Anchors the plan line endpoint. */
  targetWeight?: number | null;
  /** Weigh-in date (ISO). Anchors the plan line endpoint. */
  targetDateISO?: string | null;
}

const PHASE_META: Record<NonNullable<Phase>, {
  label: string;
  icon: IonIconName;
  accent: string;
}> = {
  // Phase accent ramps with intensity within the app's mono + blue/amber
  // palette: blue for the early build phase, warming to amber as the camp
  // escalates — no separate orange / red so the card stays on-theme.
  build: {
    label: "BUILD",
    icon: "barbellOutline",
    accent: "text-primary",
  },
  peak: {
    label: "PEAK",
    icon: "flashOutline",
    accent: "text-amber-400/90",
  },
  fightWeek: {
    label: "FIGHT WEEK",
    icon: "flameOutline",
    accent: "text-amber-400",
  },
};

const DEFAULT_FALLBACK_GUIDANCE: Record<NonNullable<Phase>, string> = {
  build: "Lock in the weekly volume and log streak. Weight should be trending down steadily.",
  peak: "Protect sleep, load peaks here. Deload one session and keep recovery dialed.",
  fightWeek: "Hydration and sodium control take over. Taper training, sharpen technique.",
};

interface ChartData {
  actualPath: string;
  /** Actual line closed down to the baseline — for the area-fill gradient. */
  areaPath: string;
  planPath: string;
  driftKg: number;
  todayPx: { x: number; y: number };
  w: number;
  h: number;
}

function buildChart(
  weightLogs: WeightPoint[] | undefined,
  currentWeight: number | null | undefined,
  targetWeight: number | null | undefined,
  targetDateISO: string | null | undefined,
): ChartData | null {
  if (!weightLogs || weightLogs.length === 0 || !targetWeight || !targetDateISO) {
    return null;
  }
  const points = weightLogs
    .map((l) => ({ ts: Date.parse(l.date), kg: parseFloat(String(l.weight_kg)) }))
    .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.kg))
    .sort((a, b) => a.ts - b.ts);
  if (points.length < 2) return null;

  const targetTs = Date.parse(targetDateISO);
  if (!Number.isFinite(targetTs)) return null;
  const startTs = points[0].ts;
  const startKg = points[0].kg;
  if (targetTs <= startTs) return null;

  const todayTs = Date.now();
  const actualToday = currentWeight ?? points[points.length - 1].kg;

  const planSlope = (targetWeight - startKg) / (targetTs - startTs);
  const planToday = startKg + planSlope * (todayTs - startTs);
  const driftKg = actualToday - planToday;

  const allKg = [...points.map((p) => p.kg), startKg, targetWeight, actualToday];
  const yMax = Math.max(...allKg);
  const yMin = Math.min(...allKg);
  const yPad = Math.max(0.3, (yMax - yMin) * 0.12);
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;

  const xLo = startTs;
  const xHi = Math.max(targetTs, todayTs);

  const w = 320;
  const h = 64;
  const padX = 4;
  const padY = 6;
  const sx = (t: number) => padX + ((t - xLo) / (xHi - xLo)) * (w - padX * 2);
  const sy = (kg: number) =>
    padY + ((yHi - kg) / (yHi - yLo)) * (h - padY * 2);

  const actualPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.ts).toFixed(1)},${sy(p.kg).toFixed(1)}`)
    .join("");
  const planPath = `M${sx(startTs).toFixed(1)},${sy(startKg).toFixed(1)} L${sx(targetTs).toFixed(1)},${sy(targetWeight).toFixed(1)}`;

  // Close the actual line down to the baseline so it can carry a soft
  // area-fill gradient (the single biggest "premium" upgrade for the spark).
  const firstX = sx(points[0].ts);
  const lastX = sx(points[points.length - 1].ts);
  const areaPath = `${actualPath} L${lastX.toFixed(1)},${h} L${firstX.toFixed(1)},${h} Z`;

  return {
    actualPath,
    areaPath,
    planPath,
    driftKg,
    todayPx: { x: sx(todayTs), y: sy(actualToday) },
    w,
    h,
  };
}

function fixSuggestion(driftKg: number | null): string {
  if (driftKg == null) return "Log your weight to see drift vs plan.";
  if (Math.abs(driftKg) < 0.3) return "On pace. Hold the line.";
  if (driftKg > 1.0) return "Cut 150 kcal from breakfast this week.";
  if (driftKg > 0.3) return "Add 1 sauna session this week.";
  if (driftKg < -1.0) return "Cutting too fast. Refeed +500 kcal tomorrow.";
  return "Ahead of plan. Add 50 g carbs to dinner.";
}

export function PhaseCoachCard({
  phase,
  daysUntilFight,
  signal,
  weightLogs,
  currentWeight,
  targetWeight,
  targetDateISO,
}: PhaseCoachCardProps) {
  const navigate = useNavigate();
  const meta = phase ? PHASE_META[phase] : PHASE_META.build;

  const chart = useMemo(
    () => buildChart(weightLogs, currentWeight, targetWeight, targetDateISO),
    [weightLogs, currentWeight, targetWeight, targetDateISO],
  );

  const fix = useMemo(
    () => fixSuggestion(chart ? chart.driftKg : null),
    [chart],
  );

  // One verdict drives every drift-colored element (line, area fill, today
  // dot, pill) via the unified ramp, so the whole chart speaks one language.
  const verdict = chart ? deltaVerdict(chart.driftKg) : null;

  // Current weight hero — today's authoritative weight, else the last log.
  const currentDisplay =
    currentWeight ??
    (weightLogs && weightLogs.length > 0
      ? parseFloat(String(weightLogs[weightLogs.length - 1].weight_kg))
      : null);
  const kgToGo =
    currentDisplay != null && typeof targetWeight === "number" && targetWeight > 0
      ? Math.max(0, currentDisplay - targetWeight)
      : null;

  return (
    <button
      type="button"
      onClick={() => {
        triggerHapticSelection();
        navigate("/fight-camps");
      }}
      className="w-full card-surface rounded-2xl p-3.5 text-left active:scale-[0.99] transition-transform"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* Phase eyebrow — muted, so the single accent on this card is the
              drift verdict (chart + pill), not the phase label. */}
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            {meta.label} phase
          </p>
          {/* Hero — current weight is the one number the eye lands on. */}
          <p className="mt-1.5 flex items-baseline gap-1.5">
            <span className="display-number font-bold tabular-nums text-foreground text-[30px] leading-none">
              {currentDisplay != null ? currentDisplay.toFixed(1) : "—"}
            </span>
            <span className="text-[13px] text-muted-foreground font-light">kg now</span>
          </p>
          {/* Subline — distance + countdown, the two facts that matter. */}
          <p className="mt-1.5 text-[12px] text-muted-foreground">
            {kgToGo != null && (
              <>
                <span className="tabular-nums font-semibold text-foreground/90">
                  {kgToGo.toFixed(1)} kg
                </span>{" "}
                to go
              </>
            )}
            {kgToGo != null && daysUntilFight != null && daysUntilFight > 0 && " · "}
            {daysUntilFight != null && daysUntilFight > 0 && (
              <>
                <span className="tabular-nums font-semibold text-foreground/90">
                  {daysUntilFight}
                </span>{" "}
                {daysUntilFight === 1 ? "day" : "days"} to weigh-in
              </>
            )}
          </p>
        </div>
        {typeof targetWeight === "number" && targetWeight > 0 && (
          <div className="text-right shrink-0">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
              target
            </p>
            <p className="text-[14px] font-semibold tabular-nums text-foreground/90 leading-tight">
              {targetWeight.toFixed(1)} kg
            </p>
          </div>
        )}
      </div>

      {chart && verdict ? (
        <div className="mt-3">
          {/* `color` on the <svg> = the drift verdict, so the actual line,
              the area fill (currentColor stops), and the today dot all inherit
              one hue. The dashed plan line overrides to muted. */}
          <svg
            viewBox={`0 0 ${chart.w} ${chart.h}`}
            preserveAspectRatio="none"
            className={`w-full h-16 ${verdict.text}`}
          >
            <defs>
              <linearGradient id="phaseActualFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={chart.areaPath} fill="url(#phaseActualFill)" stroke="none" />
            <path
              d={chart.planPath}
              className="stroke-foreground/30"
              strokeWidth={1.25}
              strokeDasharray="3 3"
              fill="none"
            />
            <path
              d={chart.actualPath}
              stroke="currentColor"
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            {/* Card-colored halo so the "you are here" dot punches off the line. */}
            <circle cx={chart.todayPx.x} cy={chart.todayPx.y} r={5.5} className="fill-[hsl(var(--card))]" />
            <circle cx={chart.todayPx.x} cy={chart.todayPx.y} r={3.5} fill="currentColor" />
          </svg>
          {/* Legend dropped (dashed-grey = plan, colored = actual is
              self-evident); the single drift pill carries the verdict. */}
          <div className="mt-2 flex justify-end">
            <DeltaPill value={chart.driftKg} noun="plan" />
          </div>
        </div>
      ) : null}

      <p className="mt-2.5 text-[12.5px] leading-snug text-foreground/90">
        {chart ? fix : phase ? DEFAULT_FALLBACK_GUIDANCE[phase] : DEFAULT_FALLBACK_GUIDANCE.build}
      </p>

      {signal && (
        <p className="mt-2 pt-2 border-t border-border/40 text-[11px] text-muted-foreground leading-snug">
          <Icon
            name="alertCircleOutline"
            size={11}
            className="inline mr-1 -mt-0.5 text-amber-400/70"
          />
          {signal}
        </p>
      )}
    </button>
  );
}
