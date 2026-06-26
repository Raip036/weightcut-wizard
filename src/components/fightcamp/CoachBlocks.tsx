// CoachBlocks — Fight Camp Coach redesign, Phase 1.
//
// Renders a `CoachBlock[]` (structured coach payload) into native UI cards
// instead of a markdown blob. `renderBlock` switches on `block.type` with a
// no-op `default` so older iOS/Capacitor builds skip unknown future block
// types rather than crash. Visual language reuses PhaseCoachCard (sparkline,
// display-number) and CampCompassCard (divide-y row lists).
import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import * as ionIcons from "ionicons/icons";
import type { CoachBlock, LogAction } from "@/../convex/_shared/aiSchemas";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";

// `stat_card.icon` is a free-form string from the LLM payload — narrow it to a
// real ionicon key before handing it to <Icon>, otherwise `getSvg` would call
// `.replace` on `undefined` and throw. Returns null when the name is unknown so
// the caller can simply skip the glyph.
function safeIconName(name: string | undefined): IonIconName | null {
  if (!name) return null;
  return Object.prototype.hasOwnProperty.call(ionIcons, name)
    ? (name as IonIconName)
    : null;
}

interface CoachBlocksProps {
  blocks: CoachBlock[];
  /** Fired by `action` blocks and checklist "Log" affordances. */
  onAction?: (action: LogAction) => void;
}

const SECTION_LABEL =
  "text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70";

// ── Number count-up ─────────────────────────────────────────────────────
// Self-contained rAF tween from 0 → target. `decimals` keeps the display in
// step with the source formatting (e.g. delta_kg renders 1 decimal place).
// When `enabled` is false (reduced motion) it returns the final value on the
// very first render — no animation, no flash of 0.
function useCountUp(target: number, durationMs: number, enabled: boolean, decimals = 0): number {
  const [value, setValue] = useState(() => (enabled ? 0 : target));
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !Number.isFinite(target)) {
      setValue(Number.isFinite(target) ? target : 0);
      return;
    }
    const factor = 10 ** decimals;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic — fast then settle, matches the card entrance curve.
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(target * eased * factor) / factor);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [target, durationMs, enabled, decimals]);

  return value;
}

// Splits a metric value string into a leading number + trailing suffix so we
// can count up the numeric part while preserving units (e.g. "1.5 kg/wk" →
// { num: 1.5, prefix: "", suffix: " kg/wk", decimals: 1 }). Returns null when
// there's no leading number to animate — caller renders the raw string.
function parseLeadingNumber(
  raw: string,
): { num: number; prefix: string; suffix: string; decimals: number } | null {
  const match = raw.match(/^(\s*[+\-−]?)(\d+(?:\.\d+)?)(.*)$/s);
  if (!match) return null;
  const [, prefix, numStr, suffix] = match;
  // A real minus glyph (−) reads as negative for the tween's magnitude.
  const negative = /[-−]/.test(prefix);
  const magnitude = Number.parseFloat(numStr);
  if (!Number.isFinite(magnitude)) return null;
  const dot = numStr.indexOf(".");
  const decimals = dot === -1 ? 0 : numStr.length - dot - 1;
  return {
    num: negative ? -magnitude : magnitude,
    prefix,
    suffix,
    decimals,
  };
}

// Renders a metric_row value, counting up the leading number when motion is
// allowed and a number is present; otherwise renders the value verbatim.
function AnimatedMetricValue({
  value,
  enabled,
}: {
  value: string;
  enabled: boolean;
}) {
  const parsed = useMemo(() => parseLeadingNumber(value), [value]);
  const target = parsed?.num ?? 0;
  const decimals = parsed?.decimals ?? 0;
  const animated = useCountUp(Math.abs(target), 560, enabled && parsed != null, decimals);

  if (!parsed) return <>{value}</>;
  // `parsed.prefix` already carries the original sign glyph (+/−/-) and any
  // leading whitespace; we keep it static and only tween the magnitude.
  return (
    <>
      {parsed.prefix}
      {animated.toFixed(decimals)}
      {parsed.suffix}
    </>
  );
}

// ── Shared tone mapping ─────────────────────────────────────────────────
// metric_row uses good/warn/bad; callout uses info/warn/danger. We keep the
// palette on existing func tokens — no invented colors.
function metricToneClass(tone?: "good" | "warn" | "bad"): string {
  switch (tone) {
    case "good":
      return "text-func-recovery-green";
    case "warn":
      return "text-func-warning-yellow";
    case "bad":
      return "text-func-danger-red";
    default:
      return "text-foreground";
  }
}

// stat_card / score_ring carry an explicit `neutral` tone (the generic
// primitives default to neutral rather than implicit foreground). Same token
// palette as metricToneClass — neutral just maps to plain foreground.
function statToneClass(tone?: "good" | "warn" | "bad" | "neutral"): string {
  switch (tone) {
    case "good":
      return "text-func-recovery-green";
    case "warn":
      return "text-func-warning-yellow";
    case "bad":
      return "text-func-danger-red";
    default:
      // "neutral" | undefined
      return "text-foreground";
  }
}

// ── weight_target ───────────────────────────────────────────────────────
// Hero callout: large display-number delta, days-out, on/off-track tone.
function WeightTargetBlock({
  block,
  animate,
}: {
  block: Extract<CoachBlock, { type: "weight_target" }>;
  animate: boolean;
}) {
  const { delta_kg, days_out, on_track, note } = block;
  // delta < 0 means "below target" (still to lose if positive cut). We render
  // the magnitude with an explicit sign and a true minus glyph for typography.
  const sign = delta_kg < 0 ? "−" : "+";
  // Count the magnitude up from 0; the sign + "kg" suffix stay static.
  const animatedMagnitude = useCountUp(Math.abs(delta_kg), 620, animate, 1);
  const animatedDaysOut = useCountUp(days_out, 620, animate, 0);
  const magnitude = animatedMagnitude.toFixed(1);
  const toneClass = on_track ? "text-func-recovery-green" : "text-func-warning-yellow";
  const borderClass = on_track ? "border-func-recovery-green/25" : "border-func-warning-yellow/25";

  return (
    <div
      className={`card-surface rounded-2xl border ${borderClass} p-4`}
      role="group"
      aria-label={`Weight target: ${sign}${magnitude} kilograms, ${days_out} days out, ${on_track ? "on track" : "off track"}`}
    >
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={SECTION_LABEL}>weight to go</div>
          <p
            className={`display-number mt-1 text-[34px] leading-none font-bold tabular-nums ${toneClass} ${animate ? "score-pulse" : ""}`}
          >
            {sign}
            {magnitude}
            <span className="text-[16px] font-semibold ml-1 text-muted-foreground">
              kg
            </span>
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
            days out
          </p>
          <p className="text-[20px] font-semibold tabular-nums text-foreground/90 leading-tight">
            {animatedDaysOut}
          </p>
        </div>
      </div>
      <p className={`mt-2 text-[11px] font-semibold uppercase tracking-[0.1em] ${toneClass}`}>
        {on_track ? "On track" : "Off track"}
      </p>
      {note && (
        <p className="mt-1.5 text-[12.5px] leading-snug text-foreground/85">
          {note}
        </p>
      )}
    </div>
  );
}

// ── checklist ───────────────────────────────────────────────────────────
// Tappable rows with a real role="checkbox" + aria-checked. If an item has a
// logKey, a small inline "Log" affordance emits the matching LogAction.
function logActionForKey(
  logKey: "weight" | "fluid" | "carbs" | "sweat",
): LogAction | null {
  // Only weight + fluid have dedicated optimistic log flows in Phase 1.
  switch (logKey) {
    case "weight":
      return { kind: "log_weight" };
    case "fluid":
      return { kind: "log_fluid" };
    default:
      // carbs / sweat have no log_* action variant yet — no affordance.
      return null;
  }
}

function ChecklistBlock({
  block,
  onAction,
}: {
  block: Extract<CoachBlock, { type: "checklist" }>;
  onAction?: (action: LogAction) => void;
}) {
  // Local-only checked state, seeded from the server's `done` hint.
  const [checked, setChecked] = useState<boolean[]>(() =>
    block.items.map((it) => Boolean(it.done)),
  );

  const toggle = (i: number) => {
    triggerHapticSelection();
    setChecked((prev) => {
      const next = prev.slice();
      next[i] = !next[i];
      return next;
    });
  };

  return (
    <div className="card-surface rounded-2xl border border-border/40 p-3.5">
      <div className={`${SECTION_LABEL} mb-1`}>{block.title}</div>
      <ul className="divide-y divide-border/40 -mx-1">
        {block.items.map((item, i) => {
          const isChecked = checked[i];
          const logAction = item.logKey ? logActionForKey(item.logKey) : null;
          return (
            <li key={i} className="flex items-center gap-2.5 px-1">
              <button
                type="button"
                role="checkbox"
                aria-checked={isChecked}
                onClick={() => toggle(i)}
                className="flex flex-1 items-center gap-2.5 min-h-[44px] text-left active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xs"
              >
                <span
                  aria-hidden
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                    isChecked
                      ? "border-func-recovery-green bg-func-recovery-green/15 text-func-recovery-green"
                      : "border-border/70 text-transparent"
                  }`}
                >
                  <Icon name="checkmarkOutline" size={13} />
                </span>
                <span
                  className={`flex-1 text-[13px] leading-snug ${
                    isChecked
                      ? "text-muted-foreground line-through"
                      : "text-foreground/90"
                  }`}
                >
                  {item.label}
                </span>
              </button>
              {logAction && onAction && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    onAction(logAction);
                  }}
                  className="shrink-0 min-h-[44px] px-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xs"
                  aria-label={`Log ${item.logKey}`}
                >
                  <Icon name="addOutline" size={13} />
                  Log
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── timeline ────────────────────────────────────────────────────────────
// Vertical rail: when → label → optional value. CampCompass row aesthetic.
function TimelineBlock({
  block,
}: {
  block: Extract<CoachBlock, { type: "timeline" }>;
}) {
  return (
    <div className="card-surface rounded-2xl border border-border/40 p-3.5">
      <div className={`${SECTION_LABEL} mb-2`}>{block.title}</div>
      <ol className="relative ml-1">
        {/* the rail */}
        <span
          aria-hidden
          className="absolute left-[3px] top-1.5 bottom-1.5 w-px bg-border/50"
        />
        {block.steps.map((step, i) => (
          <li key={i} className="relative flex items-start gap-3 py-2 pl-4">
            <span
              aria-hidden
              className="absolute left-0 top-[11px] h-[7px] w-[7px] rounded-full bg-primary/70 ring-2 ring-background"
            />
            <span className="shrink-0 w-[64px] text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80 tabular-nums pt-0.5">
              {step.when}
            </span>
            <span className="flex-1 text-[13px] leading-snug text-foreground/90">
              {step.label}
            </span>
            {step.value && (
              <span className="shrink-0 text-[12px] font-semibold tabular-nums text-foreground/80 pt-0.5">
                {step.value}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── metric_row ──────────────────────────────────────────────────────────
// 1–4 compact metric tiles with tone coloring.
function MetricRowBlock({
  block,
  animate,
}: {
  block: Extract<CoachBlock, { type: "metric_row" }>;
  animate: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {block.metrics.map((m, i) => (
        <div
          key={i}
          className="card-surface rounded-xs border border-border/40 px-3 py-2.5"
        >
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">
            {m.label}
          </p>
          <p
            className={`mt-0.5 text-[17px] font-semibold tabular-nums leading-tight ${metricToneClass(m.tone)}`}
          >
            <AnimatedMetricValue value={String(m.value)} enabled={animate} />
          </p>
        </div>
      ))}
    </div>
  );
}

// ── action ──────────────────────────────────────────────────────────────
// High-emphasis card: label + description + a button firing onAction.
const ACTION_ICON: Record<LogAction["kind"], IonIconName> = {
  log_weight: "scaleOutline",
  log_fluid: "waterOutline",
  open_plan: "listOutline",
  open_rehydration: "flashOutline",
};

const ACTION_CTA: Record<LogAction["kind"], string> = {
  log_weight: "Log weight",
  log_fluid: "Log fluid",
  open_plan: "Open plan",
  open_rehydration: "Open rehydration",
};

function ActionBlock({
  block,
  onAction,
}: {
  block: Extract<CoachBlock, { type: "action" }>;
  onAction?: (action: LogAction) => void;
}) {
  const kind = block.action.kind;
  return (
    <div className="card-surface rounded-2xl border border-primary/25 bg-primary/[0.04] p-4">
      <p className="text-[14px] font-semibold leading-snug text-foreground">
        {block.label}
      </p>
      {block.description && (
        <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
          {block.description}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          triggerHapticSelection();
          onAction?.(block.action);
        }}
        className="mt-3 w-full min-h-[44px] rounded-xs bg-primary text-primary-foreground px-4 py-2.5 text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Icon name={ACTION_ICON[kind]} size={15} />
        {ACTION_CTA[kind]}
      </button>
    </div>
  );
}

// ── chart ───────────────────────────────────────────────────────────────
// Inline SVG sparkline of `series`, optional `targetLine`. Mirrors the
// PhaseCoachCard sparkline approach (normalize to a fixed viewBox, draw a
// rounded polyline + a dashed target line).
interface SparklineData {
  path: string;
  targetY: number | null;
  lastPx: { x: number; y: number };
  w: number;
  h: number;
  summary: string;
}

function buildSparkline(
  series: { x: string; y: number }[],
  targetLine: number | undefined,
  unitLabel: string,
): SparklineData | null {
  const points = series.filter((p) => Number.isFinite(p.y));
  if (points.length < 2) return null;

  const ys = points.map((p) => p.y);
  const candidates = targetLine != null ? [...ys, targetLine] : ys;
  const yMax = Math.max(...candidates);
  const yMin = Math.min(...candidates);
  const yPad = Math.max(0.3, (yMax - yMin) * 0.12);
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;

  const w = 320;
  const h = 64;
  const padX = 4;
  const padY = 6;
  const n = points.length;
  const sx = (i: number) => padX + (i / (n - 1)) * (w - padX * 2);
  const sy = (y: number) =>
    padY + ((yHi - y) / (yHi - yLo || 1)) * (h - padY * 2);

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`)
    .join("");

  const last = points[n - 1];
  const summary = `Trend from ${ys[0]} to ${last.y} ${unitLabel}${
    targetLine != null ? `, target ${targetLine} ${unitLabel}` : ""
  }`;

  return {
    path,
    targetY: targetLine != null ? sy(targetLine) : null,
    lastPx: { x: sx(n - 1), y: sy(last.y) },
    w,
    h,
    summary,
  };
}

// Per-kind unit label for the chart sparkline. Drives both the aria summary
// and the trend-from/to readout — keep it data-driven so new kinds (training
// load, calories, sleep, HRV) read sensibly instead of defaulting to "kg".
const CHART_UNIT_LABEL: Record<
  Extract<CoachBlock, { type: "chart" }>["kind"],
  string
> = {
  weight_trend: "kg",
  fluid: "ml",
  training_load: "hrs",
  calories: "kcal",
  sleep: "h",
  hrv: "ms",
};

function ChartBlock({
  block,
}: {
  block: Extract<CoachBlock, { type: "chart" }>;
}) {
  // Fall back to an empty unit (rather than "kg") for any future kind not yet
  // mapped, so the renderer never mislabels an unknown series.
  const unitLabel = CHART_UNIT_LABEL[block.kind] ?? "";
  const chart = useMemo(
    () => buildSparkline(block.series, block.targetLine, unitLabel),
    [block.series, block.targetLine, unitLabel],
  );

  return (
    <div className="card-surface rounded-2xl border border-border/40 p-3.5">
      <div className={`${SECTION_LABEL} mb-2`}>{block.title}</div>
      {chart ? (
        <svg
          viewBox={`0 0 ${chart.w} ${chart.h}`}
          preserveAspectRatio="none"
          className="w-full h-16"
          role="img"
          aria-label={chart.summary}
        >
          {chart.targetY != null && (
            <line
              x1={0}
              x2={chart.w}
              y1={chart.targetY}
              y2={chart.targetY}
              className="stroke-foreground/30"
              strokeWidth={1.25}
              strokeDasharray="3 3"
            />
          )}
          <path
            d={chart.path}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            className="text-primary"
          />
          <circle
            cx={chart.lastPx.x}
            cy={chart.lastPx.y}
            r={3.5}
            className="fill-primary"
          />
        </svg>
      ) : (
        <p className="text-[12px] text-muted-foreground">Not enough data yet.</p>
      )}
    </div>
  );
}

// ── callout ─────────────────────────────────────────────────────────────
// Tone card. `danger` is the loudest (func-danger-red border + accent).
const CALLOUT_TONE: Record<
  "info" | "warn" | "danger",
  { border: string; icon: IonIconName; iconClass: string; bg: string }
> = {
  info: {
    border: "border-border/50",
    icon: "informationCircleOutline",
    iconClass: "text-primary",
    bg: "",
  },
  warn: {
    // Plain card like the rest; only the icon carries the warning color.
    border: "border-border/40",
    icon: "alertCircleOutline",
    iconClass: "text-func-warning-yellow",
    bg: "",
  },
  danger: {
    border: "border-func-danger-red/60",
    icon: "warningOutline",
    iconClass: "text-func-danger-red",
    bg: "bg-func-danger-red/[0.06]",
  },
};

function CalloutBlock({
  block,
}: {
  block: Extract<CoachBlock, { type: "callout" }>;
}) {
  const tone = CALLOUT_TONE[block.tone];
  const isDanger = block.tone === "danger";
  return (
    <div
      role={isDanger ? "alert" : "note"}
      className={`card-surface rounded-2xl border ${tone.border} ${tone.bg} p-3.5 flex items-start gap-2.5`}
    >
      <Icon
        name={tone.icon}
        size={16}
        className={`mt-0.5 ${tone.iconClass}`}
      />
      <p
        className={`flex-1 text-[13px] leading-snug ${
          isDanger ? "text-foreground font-medium" : "text-foreground/90"
        }`}
      >
        {block.text}
      </p>
    </div>
  );
}

// ── stat_card ───────────────────────────────────────────────────────────
// Compact tile: uppercase muted title, big display-number value + unit,
// optional subtitle, tone-colored value. `icon` is best-effort — rendered only
// when it resolves to a real ionicon, otherwise quietly skipped.
function StatCardBlock({
  block,
  animate,
}: {
  block: Extract<CoachBlock, { type: "stat_card" }>;
  animate: boolean;
}) {
  const toneClass = statToneClass(block.tone);
  const iconName = safeIconName(block.icon);
  // Reuse the metric_row count-up: tween the leading number of `value`, keep
  // the unit static alongside. Falls back to the raw string when there's no
  // animatable number (or motion is reduced).
  return (
    <div
      className="card-surface rounded-2xl border border-border/40 p-4"
      role="group"
      aria-label={`${block.title}: ${block.value}${block.unit ? ` ${block.unit}` : ""}`}
    >
      <div className="flex items-center gap-1.5">
        {iconName && (
          <Icon name={iconName} size={13} className={toneClass} />
        )}
        <div className={`${SECTION_LABEL} truncate`}>{block.title}</div>
      </div>
      <p
        className={`display-number mt-1.5 text-[28px] leading-none font-bold tabular-nums ${toneClass}`}
      >
        <AnimatedMetricValue value={String(block.value)} enabled={animate} />
        {block.unit && (
          <span className="text-[14px] font-semibold ml-1 text-muted-foreground">
            {block.unit}
          </span>
        )}
      </p>
      {block.subtitle && (
        <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">
          {block.subtitle}
        </p>
      )}
    </div>
  );
}

// ── list ────────────────────────────────────────────────────────────────
// Titled divide-y row list (CampCompass "Next 7 days" aesthetic). Each row:
// label (+ small muted meta beneath) on the left, value on the right.
function ListBlock({
  block,
}: {
  block: Extract<CoachBlock, { type: "list" }>;
}) {
  return (
    <div className="card-surface rounded-2xl border border-border/40 p-3.5">
      <div className={`${SECTION_LABEL} mb-1.5`}>{block.title}</div>
      <ul className="divide-y divide-border/40 rounded-md border border-border/30 overflow-hidden">
        {block.items.map((item, i) => (
          <li
            key={i}
            className="flex items-start justify-between gap-3 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug text-foreground/90">
                {item.label}
              </p>
              {item.meta && (
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {item.meta}
                </p>
              )}
            </div>
            {item.value && (
              <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground/90 pt-px">
                {item.value}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── score_ring ──────────────────────────────────────────────────────────
// Compact readiness ring (0–100) that mimics the FightFormRing aesthetic
// (rotated -90° SVG track + colored score arc, display-number score in the
// center) at a chat-bubble-friendly size. We MIMIC rather than reuse
// FightFormRing: that component is bound to camp/calibration domain props
// (label/state/phase/particles) and a much larger 220px hero footprint, so a
// purpose-built compact SVG keeps this domain-agnostic and lightweight.
function scoreArcToneClass(score: number): string {
  // Same green→yellow→orange→red ladder FightFormRing uses for its label
  // strokes, expressed on the func tokens available here.
  if (score >= 75) return "text-func-recovery-green";
  if (score >= 55) return "text-func-warning-yellow";
  if (score >= 35) return "text-func-carbs-orange";
  return "text-func-danger-red";
}

function ScoreRingBlock({
  block,
  animate,
}: {
  block: Extract<CoachBlock, { type: "score_ring" }>;
  animate: boolean;
}) {
  // Clamp into the 0–100 readiness domain the ring renders.
  const score = Math.max(0, Math.min(100, Math.round(block.score)));
  const animatedScore = useCountUp(score, 700, animate, 0);
  const toneClass = scoreArcToneClass(score);

  // Compact ring geometry — small enough to sit inside a chat bubble width.
  const size = 96;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // Drive the arc length from the live (animated) value so the fill grows in
  // step with the count-up when motion is allowed.
  const progress = Math.max(0, Math.min(1, animatedScore / 100));
  const dash = circumference * progress;

  return (
    <div
      className="card-surface rounded-2xl border border-border/40 p-4"
      role="group"
      aria-label={`${block.label}: ${score} out of 100${block.status ? `, ${block.status}` : ""}`}
    >
      <div className={`${SECTION_LABEL} mb-3`}>{block.label}</div>
      <div className="flex items-center gap-4">
        <div
          className="relative shrink-0"
          style={{ width: size, height: size }}
        >
          <svg width={size} height={size} className="-rotate-90 block">
            {/* Track */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="hsl(var(--muted))"
              strokeWidth={stroke}
              fill="none"
            />
            {/* Score arc */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              stroke="currentColor"
              strokeDasharray={`${dash} ${circumference}`}
              className={toneClass}
            />
          </svg>
          {/* Center readout — sits upright over the rotated SVG. */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className={`display-number text-[26px] leading-none font-bold tabular-nums ${toneClass}`}
            >
              {animatedScore}
            </span>
            {block.status && (
              <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground text-center px-1 leading-tight">
                {block.status}
              </span>
            )}
          </div>
        </div>

        {block.sublabels && block.sublabels.length > 0 && (
          <div className="min-w-0 flex-1 grid grid-cols-2 gap-x-3 gap-y-2">
            {block.sublabels.map((s, i) => (
              <div key={i} className="min-w-0">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">
                  {s.label}
                </p>
                <p
                  className={`text-[14px] font-semibold tabular-nums leading-tight ${metricToneClass(s.tone)}`}
                >
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── dispatcher ──────────────────────────────────────────────────────────
// Forward-compatible switch: a no-op `default` means unknown future block
// types are skipped, never thrown, on older builds.
function renderBlock(
  block: CoachBlock,
  animate: boolean,
  onAction?: (action: LogAction) => void,
) {
  switch (block.type) {
    case "weight_target":
      return <WeightTargetBlock block={block} animate={animate} />;
    case "checklist":
      return <ChecklistBlock block={block} onAction={onAction} />;
    case "timeline":
      return <TimelineBlock block={block} />;
    case "metric_row":
      return <MetricRowBlock block={block} animate={animate} />;
    case "action":
      return <ActionBlock block={block} onAction={onAction} />;
    case "chart":
      return <ChartBlock block={block} />;
    case "callout":
      return <CalloutBlock block={block} />;
    case "stat_card":
      return <StatCardBlock block={block} animate={animate} />;
    case "list":
      return <ListBlock block={block} />;
    case "score_ring":
      return <ScoreRingBlock block={block} animate={animate} />;
    default:
      // Unknown block type from a newer server — skip silently.
      return null;
  }
}

export function CoachBlocks({ blocks, onAction }: CoachBlocksProps) {
  const prefersReduced = useReducedMotion();
  const animate = !prefersReduced;

  if (!blocks || blocks.length === 0) return null;

  // Block-stagger entrance via the shared `dashboard-enter-stagger` utility:
  // each direct child fades + lifts in with a ~60ms cascade so the response
  // "assembles" itself. The utility's own `prefers-reduced-motion` media query
  // zeroes the animation, and we additionally suppress count-up via `animate`.
  return (
    <div className={`space-y-2.5${animate ? " dashboard-enter-stagger" : ""}`}>
      {blocks.map((block, i) => {
        const rendered = renderBlock(block, animate, onAction);
        if (rendered === null) return null;
        // Plain wrapper so each block is a direct child the CSS stagger targets.
        return <div key={i}>{rendered}</div>;
      })}
    </div>
  );
}
