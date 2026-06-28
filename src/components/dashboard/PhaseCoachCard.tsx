import { useId, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";
import { resolvePlanWeek, planStartIso, isoShift, resolveTotalWeeks } from "@/scoring/planWeek";
import { DeltaPill, deltaVerdict } from "./DeltaPill";
import { loadPlan, type PlanData } from "./CutPaceForecast";

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
  /** Cut plan (week-by-week targets). Preferred over the localStorage copy so
   *  this card reads the SAME plan as the sibling CutPaceForecast widget and
   *  the two can never disagree when the DB plan and localStorage diverge. */
  plan?: PlanData | null;
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
  /** Plan-line right endpoint (the weigh-in target), for the end marker. */
  targetPx: { x: number; y: number };
  /** Camp-start weight (first log), labelled at the chart's left edge. */
  startKg: number;
  /** Weigh-in target weight, labelled at the chart's right edge. */
  targetKg: number;
  w: number;
  h: number;
}

/** Linear-interpolate ascending `(ts,kg)` plan points at `t`; clamps at the ends. */
export function interpolatePlan(points: { ts: number; kg: number }[], t: number): number {
  if (points.length === 0) return 0;
  if (t <= points[0].ts) return points[0].kg;
  const last = points[points.length - 1];
  if (t >= last.ts) return last.kg;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (t >= a.ts && t <= b.ts) {
      const frac = b.ts === a.ts ? 0 : (t - a.ts) / (b.ts - a.ts);
      return a.kg + (b.kg - a.kg) * frac;
    }
  }
  return last.kg;
}

/**
 * Calm trend series: a centered, triangular-weighted moving average over the raw
 * weigh-ins. Daily weight is dominated by water / glycogen swing; the camp story
 * is the TREND, so smoothing the DATA (not just the path) is what turns the
 * jagged, compressed-looking spark into a clean descending curve. Endpoints are
 * anchored to the real first/last reading so the "start" label and the line
 * start stay truthful.
 */
function smoothSeries(pts: { ts: number; kg: number }[], radius = 2): { ts: number; kg: number }[] {
  if (pts.length <= 2) return pts;
  const weights = [1, 2, 3, 2, 1]; // centered, triangular (radius 2)
  const out = pts.map((p, i) => {
    let sum = 0;
    let wsum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= pts.length) continue;
      const w = weights[k + radius];
      sum += pts[j].kg * w;
      wsum += w;
    }
    return { ts: p.ts, kg: sum / wsum };
  });
  out[0] = { ts: pts[0].ts, kg: pts[0].kg }; // anchor the start reading
  return out;
}

/**
 * Monotone cubic (Fritsch–Carlson) smooth path through pixel points. Never
 * overshoots the data, so a noisy weight series reads as a calm curve without
 * inventing dips. Used for the actual line only; the plan line stays a straight
 * polyline between weekly targets (it IS piecewise-linear and the tests assert
 * its M/L command shape).
 */
export function smoothPath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  if (n === 2) return `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)} L${pts[1].x.toFixed(2)},${pts[1].y.toFixed(2)}`;

  const dx: number[] = [];
  const dy: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
    slope[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / slope[i];
      const b = m[i + 1] / slope[i];
      const hyp = a * a + b * b;
      if (hyp > 9) {
        const tau = 3 / Math.sqrt(hyp);
        m[i] = tau * a * slope[i];
        m[i + 1] = tau * b * slope[i];
      }
    }
  }
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const x1 = pts[i].x + dx[i] / 3;
    const y1 = pts[i].y + (m[i] * dx[i]) / 3;
    const x2 = pts[i + 1].x - dx[i] / 3;
    const y2 = pts[i + 1].y - (m[i + 1] * dx[i]) / 3;
    d += ` C${x1.toFixed(2)},${y1.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
  }
  return d;
}

// ── Gradient-glow palette, one two-tone ramp per drift verdict ───────────────
// Mirrors `deltaVerdict`'s thresholds so the chart hue stays in lockstep with
// the pill: on-plan emerald→teal, warming through amber / orange to rose as the
// athlete drifts over plan. Every state keeps the same premium glow.
type GlowKey = "on" | "amber" | "orange" | "rose";

const GLOW_PALETTE: Record<GlowKey, { from: string; to: string; core: string }> = {
  on: { from: "hsl(152 69% 55%)", to: "hsl(173 70% 52%)", core: "hsl(152 69% 55%)" },
  amber: { from: "hsl(43 96% 58%)", to: "hsl(33 95% 54%)", core: "hsl(43 96% 56%)" },
  orange: { from: "hsl(28 96% 60%)", to: "hsl(16 92% 56%)", core: "hsl(25 95% 58%)" },
  rose: { from: "hsl(350 90% 64%)", to: "hsl(2 84% 58%)", core: "hsl(350 89% 60%)" },
};

/** Map a signed drift (kg, + = over plan) to a glow ramp key. Thresholds match
 *  `deltaVerdict` exactly so the chart and the pill never disagree. */
function glowKey(kg: number): GlowKey {
  const abs = Math.abs(kg);
  if (abs <= 0.5) return "on";
  if (kg < 0) return "amber"; // under plan (cutting too fast) is its own caution
  if (abs <= 1.5) return "amber";
  if (abs <= 2.5) return "orange";
  return "rose";
}

export function buildChart(
  weightLogs: WeightPoint[] | undefined,
  currentWeight: number | null | undefined,
  targetWeight: number | null | undefined,
  targetDateISO: string | null | undefined,
  plan: PlanData | null,
): ChartData | null {
  if (!weightLogs || weightLogs.length === 0) return null;
  const points = weightLogs
    .map((l) => ({ ts: Date.parse(l.date), kg: parseFloat(String(l.weight_kg)) }))
    .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.kg))
    .sort((a, b) => a.ts - b.ts);
  if (points.length < 2) return null;

  const startTs = points[0].ts;
  const startKg = points[0].kg;
  const todayTs = Date.now();
  const actualToday = currentWeight ?? points[points.length - 1].kg;

  // ── Build the plan line from the cut plan when usable, else fall back to a
  //    straight line to the profile target. ──────────────────────────────────
  let planPoints: { ts: number; kg: number }[] | null = null;
  let targetKg: number | null = null;
  let targetTs: number | null = null;

  const fightDateIso = plan?.targetDate ?? targetDateISO ?? null;
  const totalWeeks = resolveTotalWeeks(plan?.weeklyPlan, plan?.totalWeeks);
  if (plan && Array.isArray(plan.weeklyPlan) && plan.weeklyPlan.length > 0 && fightDateIso && totalWeeks > 0) {
    const nonDehydration = plan.weeklyPlan.filter((w) => (w as { phase?: string }).phase !== "fight_week");
    if (nonDehydration.length > 0) {
      const planStart = planStartIso(fightDateIso, totalWeeks);
      const planStartTs = Date.parse(planStart + "T00:00:00Z");
      const startWeight = points[0]?.kg ?? (plan as { currentWeight?: number }).currentWeight
        ?? nonDehydration[nonDehydration.length - 1].targetWeight;
      const pts: { ts: number; kg: number }[] = [{ ts: planStartTs, kg: startWeight }];
      for (const row of [...nonDehydration].sort((a, b) => a.week - b.week)) {
        const weekEndTs = Date.parse(isoShift(planStart, row.week * 7 - 1) + "T00:00:00Z");
        if (Number.isFinite(weekEndTs) && Number.isFinite(row.targetWeight)) {
          pts.push({ ts: weekEndTs, kg: row.targetWeight });
        }
      }
      if (Number.isFinite(planStartTs) && pts.length >= 2) {
        planPoints = pts;
        // Endpoint label + marker both read the LAST plan vertex, so they can
        // never refer to different rows even if a row was skipped as non-finite.
        targetKg = pts[pts.length - 1].kg;
        targetTs = pts[pts.length - 1].ts;
      }
    }
  }

  // Fallback: legacy straight line to the profile target.
  if (planPoints == null) {
    if (!targetWeight || !targetDateISO) return null;
    const tTs = Date.parse(targetDateISO);
    if (!Number.isFinite(tTs) || tTs <= startTs) return null;
    planPoints = [{ ts: startTs, kg: startKg }, { ts: tTs, kg: targetWeight }];
    targetKg = targetWeight;
    targetTs = tTs;
  }

  const planToday = interpolatePlan(planPoints, todayTs);
  const driftKg = actualToday - planToday;

  const allKg = [...points.map((p) => p.kg), startKg, ...planPoints.map((p) => p.kg), actualToday];
  const yMax = Math.max(...allKg);
  const yMin = Math.min(...allKg);
  const yPad = Math.max(0.3, (yMax - yMin) * 0.12);
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;

  const xLo = Math.min(startTs, planPoints[0].ts);
  const xHi = Math.max(targetTs, todayTs, points[points.length - 1].ts);
  if (!(xHi > xLo)) return null;

  // Taller viewBox with an aspect ratio close to the rendered box: the old
  // 320×64 box stretched into a ~2.3× taller element (preserveAspectRatio
  // "none"), which vertically squashed every wiggle and made the line look
  // cramped. A 320×140 box renders ~1:1 vertically, so the curve breathes.
  const w = 320;
  const h = 140;
  const padX = 6;
  const padY = 14;
  const sx = (t: number) => padX + ((t - xLo) / (xHi - xLo)) * (w - padX * 2);
  const sy = (kg: number) => padY + ((yHi - kg) / (yHi - yLo)) * (h - padY * 2);

  // Actual line: smooth the DATA (calm trend), then draw a monotone spline so
  // the line reads premium rather than jagged. The authoritative current weight
  // is folded into the series BEFORE smoothing (so the curve approaches the
  // today dot gradually rather than spiking to it), then both endpoints are
  // anchored to the real first reading / today's weight so the curve starts and
  // ends exactly where the "start" / "now" labels say.
  const rawSeries = points.map((p) => ({ ts: p.ts, kg: p.kg }));
  const lastRaw = rawSeries[rawSeries.length - 1];
  if (todayTs > lastRaw.ts) {
    rawSeries.push({ ts: todayTs, kg: actualToday });
  } else {
    rawSeries[rawSeries.length - 1] = { ts: lastRaw.ts, kg: actualToday };
  }
  const actualLine = smoothSeries(rawSeries);
  const endTs = rawSeries[rawSeries.length - 1].ts;
  actualLine[actualLine.length - 1] = { ts: endTs, kg: actualToday }; // anchor "now"
  const actualPxPts = actualLine.map((p) => ({ x: sx(p.ts), y: sy(p.kg) }));
  const actualPath = smoothPath(actualPxPts);

  // Plan / projection: straight polyline between weekly targets (it IS
  // piecewise-linear; tests assert this M/L shape).
  const planPath = planPoints
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.ts).toFixed(1)},${sy(p.kg).toFixed(1)}`)
    .join(" ");

  // Close the smooth actual line down to the baseline for the area-fill gradient.
  const firstX = actualPxPts[0].x;
  const lastX = actualPxPts[actualPxPts.length - 1].x;
  const areaPath = `${actualPath} L${lastX.toFixed(1)},${h} L${firstX.toFixed(1)},${h} Z`;

  return {
    actualPath,
    areaPath,
    planPath,
    driftKg,
    todayPx: { x: sx(todayTs), y: sy(actualToday) },
    targetPx: { x: sx(targetTs), y: sy(targetKg) },
    startKg,
    targetKg,
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

  if (driftKg > 0) {
    return `Trim about ${kcal} kcal a day to ease back on track.`;
  }
  return `Room to add about ${kcal} kcal a day to fuel training.`;
}

export function PhaseCoachCard({
  phase,
  daysUntilFight,
  signal,
  weightLogs,
  currentWeight,
  targetWeight,
  targetDateISO,
  plan,
}: PhaseCoachCardProps) {
  const navigate = useNavigate();
  const meta = phase ? PHASE_META[phase] : PHASE_META.build;
  // Stable, unique id base for the chart's gradient/filter defs so multiple
  // cards on a page never collide on `url(#...)` references.
  const gid = useId().replace(/:/g, "");

  // Resolve the cut plan once and share it between the chart polyline and the
  // weekly-target drift number (DRY — both read the same authoritative plan).
  // Prefer the passed `plan` (matches CutPaceForecast's `planProp ?? loadPlan()`
  // precedence) so the two cards never read different plan sources.
  const cutPlan = useMemo(() => plan ?? loadPlan(), [plan, targetDateISO]);

  const chart = useMemo(
    () => buildChart(weightLogs, currentWeight, targetWeight, targetDateISO, cutPlan),
    [weightLogs, currentWeight, targetWeight, targetDateISO, cutPlan],
  );

  // Current weight hero, today's authoritative weight, else the last log.
  const currentDisplay =
    currentWeight ??
    (weightLogs && weightLogs.length > 0
      ? parseFloat(String(weightLogs[weightLogs.length - 1].weight_kg))
      : null);

  // THIS WEEK's plan target — resolved from the cut plan via the shared
  // `resolvePlanWeek` (the SAME source the Camp Status "This week's target"
  // widget uses). Using it for the drift number keeps this card from
  // disagreeing with that widget (the old chart drift was a naive straight
  // line to the weigh-in weight, which over-stated how far "over plan" you are).
  const weeklyTargetKg = useMemo(() => {
    if (!cutPlan) return null;
    const resolved = resolvePlanWeek({
      asOfDate: new Date().toISOString().slice(0, 10),
      fightDate: cutPlan.targetDate ?? targetDateISO,
      weeklyPlan: cutPlan.weeklyPlan,
      totalWeeks: cutPlan.totalWeeks,
    });
    return resolved?.targetWeight ?? null;
  }, [cutPlan, targetDateISO]);

  // Authoritative drift: deviation from THIS WEEK's plan target. Falls back to
  // the chart's linear drift only when the weekly target can't be resolved.
  const effectiveDrift =
    weeklyTargetKg != null && currentDisplay != null
      ? currentDisplay - weeklyTargetKg
      : chart
        ? chart.driftKg
        : null;

  const fuelAdvice = useMemo(
    () => computeFuelAdvice(effectiveDrift, daysUntilFight),
    [effectiveDrift, daysUntilFight],
  );

  // One verdict drives every drift-colored element (line, area fill, today
  // dot, pill) via the unified ramp, so the whole chart speaks one language.
  const verdict = effectiveDrift != null ? deltaVerdict(effectiveDrift) : null;
  // The matching two-tone gradient-glow ramp for the chart (emerald → amber →
  // orange → rose as you drift over plan), kept in lockstep with `verdict`.
  const glow = GLOW_PALETTE[glowKey(effectiveDrift ?? chart?.driftKg ?? 0)];

  return (
    <button
      type="button"
      onClick={() => {
        triggerHapticSelection();
        navigate("/fight-camps");
      }}
      className="w-full rounded-2xl p-4 text-left active:scale-[0.99] transition-transform"
    >
      {/* Phase eyebrow. The weigh-in countdown is inferable from the weekly
          card above, so it's intentionally omitted here; the single accent on
          this card stays the drift verdict (chart + pill). */}
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {meta.label}
        </p>
      </div>

      {chart && verdict ? (
        <>
          {/* Big chart hero. This card's whole job is the camp-long trajectory,
              so the chart IS the centerpiece (no large current-weight number
              competing with the weekly card above). The smooth actual line
              carries a two-tone gradient-glow keyed to the drift verdict
              (emerald on plan → amber/orange/rose over plan); the dashed plan
              line + hollow target marker stay muted as the projection. */}
          <div className="mt-3">
            <svg
              viewBox={`0 0 ${chart.w} ${chart.h}`}
              preserveAspectRatio="none"
              className="w-full h-[140px]"
            >
              <defs>
                <linearGradient id={`${gid}-stroke`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={glow.from} />
                  <stop offset="100%" stopColor={glow.to} />
                </linearGradient>
                <linearGradient id={`${gid}-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={glow.core} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={glow.core} stopOpacity={0} />
                </linearGradient>
                <filter id={`${gid}-blur`} x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3.5" />
                </filter>
              </defs>

              {/* Soft area fill under the actual line */}
              <path d={chart.areaPath} fill={`url(#${gid}-fill)`} stroke="none" />

              {/* Plan / projection: muted dashed guide to the weigh-in target */}
              <path
                d={chart.planPath}
                className="stroke-foreground/25"
                strokeWidth={1.25}
                strokeDasharray="3 3"
                strokeLinecap="round"
                fill="none"
              />

              {/* Actual line — blurred glow underlay */}
              <path
                d={chart.actualPath}
                fill="none"
                stroke={`url(#${gid}-stroke)`}
                strokeWidth={5}
                strokeLinecap="round"
                strokeLinejoin="round"
                filter={`url(#${gid}-blur)`}
                opacity={0.5}
              />
              {/* Actual line — crisp on top */}
              <path
                d={chart.actualPath}
                fill="none"
                stroke={`url(#${gid}-stroke)`}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Weigh-in target marker (hollow) at the plan line's endpoint. */}
              <circle cx={chart.targetPx.x} cy={chart.targetPx.y} r={4} fill="none" stroke={glow.to} strokeWidth={1.5} />
              {/* "You are here" dot: soft glow + card-colored halo + bright core. */}
              <circle cx={chart.todayPx.x} cy={chart.todayPx.y} r={10} fill={glow.core} opacity={0.25} />
              <circle cx={chart.todayPx.x} cy={chart.todayPx.y} r={6} className="fill-[hsl(var(--card))]" />
              <circle cx={chart.todayPx.x} cy={chart.todayPx.y} r={4} fill={glow.core} />
            </svg>
            {/* Endpoint labels anchor the chart: where the camp started ↔ the
                weigh-in target it's converging on. */}
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/70 tabular-nums">
              <span>start {chart.startKg.toFixed(1)}</span>
              <span>target {chart.targetKg.toFixed(1)}</span>
            </div>
          </div>

          {/* Single delta line: the drift verdict pill + your current weight,
              replacing the old big-number hero and the separate pill row. */}
          <div className="mt-3 flex items-center justify-between gap-2">
            <DeltaPill value={effectiveDrift ?? chart.driftKg} noun="plan" />
            {currentDisplay != null && (
              <span className="text-[12px] text-muted-foreground tabular-nums">
                {currentDisplay.toFixed(1)} kg now
              </span>
            )}
          </div>
        </>
      ) : (
        /* Fallback when there isn't enough data to draw the trajectory: keep
           the plain current-weight readout so the card still says something. */
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
      )}

      {/* Deterministic fueling nudge, trimmed to one short line. Hidden when
          on-plan or no drift data, so the card stays quiet rather than
          inventing advice. */}
      {fuelAdvice && (
        <p className="mt-3 pt-3 border-t border-border/40 text-[12px] leading-snug text-foreground/90">
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
