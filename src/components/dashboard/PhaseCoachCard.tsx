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
  // escalates, no separate orange / red so the card stays on-theme.
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

interface ChartData {
  actualPath: string;
  /** Actual line closed down to the baseline, for the area-fill gradient. */
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

// ---- Deterministic fueling nudge (no AI) -----------------------------------
// Translates drift-vs-plan into a concrete daily calorie adjustment.
//   driftKg > 0  →  heavier than plan (behind)  →  trim calories
//   driftKg < 0  →  lighter than plan (ahead)   →  room to add calories
// Magnitude spreads the correction across the days left to weigh-in, then
// clamps to a safe daily band and rounds to the nearest 50 kcal. Bodyweight
// enters naturally — heavier athletes drift in larger kg, so N scales with it.
const KCAL_PER_KG = 7700; // codebase constant: ~7700 kcal ≈ 1 kg
const ON_PLAN_TOLERANCE_KG = 0.3; // within this band = on plan, no nudge
const MIN_KCAL_NUDGE = 100;
const MAX_KCAL_NUDGE = 350; // safety ceiling on a single-day swing

function computeFuelAdvice(
  driftKg: number | null,
  daysUntilFight: number | null,
): string | null {
  if (driftKg == null || Math.abs(driftKg) <= ON_PLAN_TOLERANCE_KG) return null;

  const days = Math.max(1, daysUntilFight ?? 7);
  const raw = (Math.abs(driftKg) * KCAL_PER_KG) / days;
  const clamped = Math.min(MAX_KCAL_NUDGE, Math.max(MIN_KCAL_NUDGE, raw));
  const kcal = Math.round(clamped / 50) * 50;
  const absKg = Math.abs(driftKg).toFixed(1);

  if (driftKg > 0) {
    return `You're ${absKg} kg over plan — trim about ${kcal} kcal a day to ease back on track before weigh-in.`;
  }
  return `You're ${absKg} kg ahead of plan — you've got room to add about ${kcal} kcal a day to fuel your training.`;
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

  const fuelAdvice = useMemo(
    () => computeFuelAdvice(chart ? chart.driftKg : null, daysUntilFight),
    [chart, daysUntilFight],
  );

  // One verdict drives every drift-colored element (line, area fill, today
  // dot, pill) via the unified ramp, so the whole chart speaks one language.
  const verdict = chart ? deltaVerdict(chart.driftKg) : null;

  // Current weight hero, today's authoritative weight, else the last log.
  const currentDisplay =
    currentWeight ??
    (weightLogs && weightLogs.length > 0
      ? parseFloat(String(weightLogs[weightLogs.length - 1].weight_kg))
      : null);

  return (
    <button
      type="button"
      onClick={() => {
        triggerHapticSelection();
        navigate("/fight-camps");
      }}
      className="w-full card-surface rounded-2xl p-4 text-left active:scale-[0.99] transition-transform"
    >
      {/* Header row: phase eyebrow ↔ weigh-in countdown on one line. The single
          accent on this card stays the drift verdict (chart + pill). */}
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {meta.label}
        </p>
        {daysUntilFight != null && daysUntilFight > 0 && (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {daysUntilFight} {daysUntilFight === 1 ? "day" : "days"} to weigh-in
          </span>
        )}
      </div>

      {/* Hero row: current weight (the number the eye lands on) + target
          caption trailing, so the old top-right target block folds away. */}
      <div className="mt-2 flex min-w-0 items-baseline gap-2">
        <span className="display-number font-bold tabular-nums text-foreground text-[34px] leading-none">
          {currentDisplay != null ? currentDisplay.toFixed(1) : "-"}
        </span>
        <span className="text-[13px] text-muted-foreground font-light">kg now</span>
        {typeof targetWeight === "number" && targetWeight > 0 && (
          <span className="ml-0.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60 font-semibold">
            target {targetWeight.toFixed(1)}
          </span>
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
          {/* Drift pill, bottom-right — same slot as the forecast card above so
              the two cards' deltas read as an aligned pair. */}
          <div className="mt-3 flex justify-end">
            <DeltaPill value={chart.driftKg} noun="plan" />
          </div>
        </div>
      ) : null}

      {/* Deterministic fueling nudge. Hidden when on-plan or no drift data, so
          the card stays quiet rather than inventing advice. */}
      {fuelAdvice && (
        <p className="mt-3 pt-3 border-t border-border/40 text-[12.5px] leading-snug text-foreground/90">
          {fuelAdvice}
        </p>
      )}

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
