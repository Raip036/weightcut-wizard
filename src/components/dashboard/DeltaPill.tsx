/**
 * DeltaPill — the single source of truth for "ahead / behind plan" color
 * semantics across the Camp Status cards.
 *
 * In a weight CUT, being OVER (heavier than) the target/plan is bad, so the
 * ramp runs emerald (on) → amber (caution) → orange (over) → rose (critical),
 * matching `CutPaceForecast`'s `TIER_ACCENT` left-edge ramp. A directional
 * arrow (↑ = over = bad) makes good/bad pre-attentive, and a 12%-tinted
 * background gives the colored number contrast on the near-black cards without
 * reading as an error state.
 */

export interface DeltaVerdict {
  /** text-color class for the value / line. */
  text: string;
  /** fill-color class for SVG dots. */
  fill: string;
  /** tinted background class for the pill. */
  bg: string;
  /** directional glyph: ↑ over, ↓ under, → on. */
  arrow: string;
}

/**
 * Map a signed delta (positive = over target/plan = bad in a cut) to the
 * unified ramp. Thresholds mirror `tierFromDelta` in CutPaceForecast so the
 * left edge, the pill, and the chart all agree.
 */
export function deltaVerdict(kg: number): DeltaVerdict {
  const abs = Math.abs(kg);
  if (abs <= 0.5) {
    return { text: "text-emerald-400", fill: "fill-emerald-400", bg: "bg-emerald-400/12", arrow: "→" };
  }
  if (kg < 0) {
    // Under plan — cutting too fast is its own risk, so caution-amber.
    return { text: "text-amber-400", fill: "fill-amber-400", bg: "bg-amber-400/12", arrow: "↓" };
  }
  if (abs <= 1.5) {
    return { text: "text-amber-400", fill: "fill-amber-400", bg: "bg-amber-400/12", arrow: "↑" };
  }
  if (abs <= 2.5) {
    return { text: "text-orange-400", fill: "fill-orange-400", bg: "bg-orange-400/12", arrow: "↑" };
  }
  return { text: "text-rose-500", fill: "fill-rose-500", bg: "bg-rose-500/12", arrow: "↑" };
}

interface DeltaPillProps {
  /** Signed delta in kg. Positive = over the target/plan. */
  value: number;
  /** What the delta is measured against — "target" or "plan". */
  noun: string;
}

export function DeltaPill({ value, noun }: DeltaPillProps) {
  const v = deltaVerdict(value);
  const onPlan = Math.abs(value) <= 0.5;
  const label = onPlan
    ? `On ${noun}`
    : `${Math.abs(value).toFixed(1)} kg ${value > 0 ? "over" : "under"} ${noun}`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold leading-none tabular-nums ${v.bg} ${v.text}`}
    >
      <span aria-hidden="true" className="text-[11px] leading-none">
        {v.arrow}
      </span>
      {label}
    </span>
  );
}
