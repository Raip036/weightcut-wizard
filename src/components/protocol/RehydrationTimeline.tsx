// RehydrationTimeline — full hour-by-hour rehydration plan.
//
// Expands a handful of sparse "anchor" hours into a complete H+0 … H+gapHours
// plan (missing hours are linearly interpolated). Layout mirrors the mock's
// "Step 2 · Rehydration plan": a SINGLE `table-fixed` table so the H+ and ml
// columns stay aligned across EVERY row (no per-row flex/grid drift),
// `tabular-nums` on the numeric columns, full-width phase header rows, an
// emerald "MEAL" tag + tint on meal rows, and dimmed overnight rows.
// Pure presentational — no Convex, no business logic.
import { cn } from "@/lib/utils";

// ── Public types ─────────────────────────────────────────────────────

export interface RehydrationAnchor {
  /** Hours after weigh-in, e.g. 0, 3, 8, 16, 24. Sparse input. */
  hourOffset: number;
  /** Fluid volume for this hour in millilitres. */
  liquidsMl: number;
  /** Short title, e.g. "Front-load". */
  label?: string;
  /** Fluid composition copy, e.g. "ORS + electrolytes". */
  liquidsComposition?: string;
  /** Food copy. Presence of this marks the hour as a meal. */
  foodCopy?: string;
  /** Free-form notes / cue. */
  notes?: string;
}

export interface RehydrationTimelineProps {
  /** Sparse anchor hours. Order does not matter. */
  anchors: RehydrationAnchor[];
  /** Weigh-in → fight gap in hours. Rows render H+0 … H+gapHours inclusive. */
  gapHours: number;
  /** Total litres target for the header line. Omit to hide the "L" part. */
  totalLitresTarget?: number;
  className?: string;
}

// Phase a given hour belongs to. Walkout is always the final hour.
type Phase = "front-load" | "refeed" | "overnight" | "top-up" | "walkout";

/** A fully-expanded, render-ready hour row. */
export interface ExpandedHour {
  hourOffset: number;
  /** Fluid in ml. `null` => render an em-dash (walkout with no fluid). */
  liquidsMl: number | null;
  /** Cue text shown in the notes column. */
  cue: string;
  /** Bold lead-in (label) rendered before the cue, when present. */
  lead?: string;
  isMeal: boolean;
  phase: Phase;
}

const DEFAULT_CUE = "Sip steadily — water + electrolytes.";

// ── Helpers ──────────────────────────────────────────────────────────

/** Classify an hour into a rehydration phase. `gapHours` is the walkout. */
function phaseForHour(hour: number, gapHours: number): Phase {
  if (hour >= gapHours) return "walkout";
  if (hour <= 2) return "front-load";
  if (hour <= 8) return "refeed";
  if (hour <= 15) return "overnight";
  return "top-up"; // 16 .. gapHours - 1
}

/** First non-empty trimmed string from the list, or undefined. */
function firstNonEmpty(...vals: Array<string | undefined>): string | undefined {
  for (const v of vals) {
    if (v && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

/** Round to the nearest 50ml — used for interpolated values. */
function roundTo50(ml: number): number {
  return Math.round(ml / 50) * 50;
}

/**
 * Expand sparse anchors into every hour H+0 … H+gapHours inclusive.
 * Anchored hours use their own values (cue = foodCopy ?? notes ?? composition
 * ?? label; isMeal = !!foodCopy). Gaps are linearly interpolated (rounded to
 * 50ml) with a default cue; ends hold the nearest anchor's volume. The walkout
 * hour shows `null` fluid when its anchor is absent or zero.
 * Pure + exported so it can be unit-tested independently of React.
 */
export function expandHours(
  anchors: RehydrationAnchor[],
  gapHours: number,
): ExpandedHour[] {
  const lastHour = Math.max(0, Math.floor(gapHours));

  // Index anchors by hour (later duplicates win — last write).
  const byHour = new Map<number, RehydrationAnchor>();
  for (const a of anchors) {
    byHour.set(Math.round(a.hourOffset), a);
  }

  // Sorted unique anchor offsets that fall within range, for interpolation.
  const sortedOffsets = [...byHour.keys()]
    .filter((h) => h >= 0 && h <= lastHour)
    .sort((x, y) => x - y);

  const interpolate = (hour: number): number => {
    if (sortedOffsets.length === 0) return 0;

    // Find bounding anchors.
    let lower: number | undefined;
    let upper: number | undefined;
    for (const off of sortedOffsets) {
      if (off <= hour) lower = off;
      if (off >= hour && upper === undefined) upper = off;
    }

    if (lower === undefined && upper !== undefined) {
      return byHour.get(upper)!.liquidsMl; // before first anchor
    }
    if (upper === undefined && lower !== undefined) {
      return byHour.get(lower)!.liquidsMl; // after last anchor
    }
    if (lower === undefined || upper === undefined) return 0;
    if (lower === upper) return byHour.get(lower)!.liquidsMl;

    const loMl = byHour.get(lower)!.liquidsMl;
    const hiMl = byHour.get(upper)!.liquidsMl;
    const t = (hour - lower) / (upper - lower);
    return roundTo50(loMl + (hiMl - loMl) * t);
  };

  const rows: ExpandedHour[] = [];
  for (let hour = 0; hour <= lastHour; hour++) {
    const phase = phaseForHour(hour, lastHour);
    const anchor = byHour.get(hour);

    if (anchor) {
      const isMeal = !!(anchor.foodCopy && anchor.foodCopy.trim().length > 0);
      const cue =
        firstNonEmpty(
          anchor.foodCopy,
          anchor.notes,
          anchor.liquidsComposition,
          anchor.label,
        ) ?? DEFAULT_CUE;
      // When we have a food cue, surface the label as the bold lead-in.
      const lead = isMeal ? firstNonEmpty(anchor.label) : undefined;

      const isWalkoutEmpty = phase === "walkout" && (anchor.liquidsMl ?? 0) <= 0;

      rows.push({
        hourOffset: hour,
        liquidsMl: isWalkoutEmpty ? null : anchor.liquidsMl,
        cue,
        lead,
        isMeal,
        phase,
      });
      continue;
    }

    // No anchor — interpolate fluid, default cue. Walkout w/o anchor → null.
    rows.push({
      hourOffset: hour,
      liquidsMl: phase === "walkout" ? null : interpolate(hour),
      cue: phase === "walkout" ? "Fight time. Full and strong." : DEFAULT_CUE,
      isMeal: false,
      phase,
    });
  }

  return rows;
}

/** Human-readable header for a phase group. */
function phaseTitle(phase: Phase): string {
  switch (phase) {
    case "front-load":
      return "Front-load";
    case "refeed":
      return "Refeed";
    case "overnight":
      return "Overnight";
    case "top-up":
      return "Top-up";
    case "walkout":
      return "Walkout";
  }
}

/** Format an ml value for the fluid column. `null` => em-dash. */
function formatFluid(ml: number | null): string {
  if (ml === null) return "—";
  return `${Math.round(ml)} ml`;
}

// ── Component ────────────────────────────────────────────────────────

export function RehydrationTimeline({
  anchors,
  gapHours,
  totalLitresTarget,
  className,
}: RehydrationTimelineProps) {
  const rows = expandHours(anchors, gapHours);

  // Header line: "Replace 3 L over 24 h" (drop the "X L" part when absent).
  const litrePart =
    totalLitresTarget !== undefined && totalLitresTarget > 0
      ? `${Number(totalLitresTarget.toFixed(1))} L `
      : "";

  return (
    <section
      role="region"
      aria-label="Hour-by-hour rehydration plan"
      className={cn(
        "card-surface rounded-2xl border border-border/50 p-5",
        className,
      )}
    >
      {/* Section header */}
      <p className="text-[10px] uppercase tracking-[0.15em] font-bold text-func-hydration-cyan">
        Step 2 · Rehydration plan
      </p>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Replace{" "}
        <span className="font-semibold text-foreground">
          {litrePart}over {gapHours} h
        </span>{" "}
        · weigh-in to walkout
      </p>

      {/* Fixed-layout table — H+ and ml columns align across ALL rows. */}
      <table className="mt-4 w-full table-fixed border-collapse tabular-nums">
        <colgroup>
          <col className="w-[48px]" />
          <col className="w-[64px]" />
          <col />
        </colgroup>
        <tbody>
          {rows.map((row, i) => {
            const prev = rows[i - 1];
            const showPhaseHeader = !prev || prev.phase !== row.phase;
            return (
              <PhaseAndRow
                key={row.hourOffset}
                row={row}
                showPhaseHeader={showPhaseHeader}
              />
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ── Internal: phase header + data row ────────────────────────────────

function PhaseAndRow({
  row,
  showPhaseHeader,
}: {
  row: ExpandedHour;
  showPhaseHeader: boolean;
}) {
  const isOvernight = row.phase === "overnight";
  const isWalkoutHeader = row.phase === "walkout";

  return (
    <>
      {showPhaseHeader && (
        <tr>
          <td
            colSpan={3}
            className={cn(
              "pb-1 pt-3.5 text-[8.5px] font-bold uppercase tracking-[0.13em]",
              isWalkoutHeader
                ? "text-func-danger-red"
                : "text-func-hydration-cyan",
            )}
          >
            {phaseTitle(row.phase)}
          </td>
        </tr>
      )}
      <tr className={cn(row.isMeal && "bg-emerald-500/[0.06]")}>
        {/* H+ column */}
        <td
          className={cn(
            "border-b border-border/40 py-[7px] align-top text-[11px] font-bold tabular-nums",
            isOvernight ? "text-muted-foreground/50" : "text-func-hydration-cyan",
          )}
        >
          H+{row.hourOffset}
        </td>

        {/* Fluid column — right-aligned, no wrap */}
        <td
          className={cn(
            "whitespace-nowrap border-b border-border/40 py-[7px] text-right align-top text-[11px] tabular-nums",
            isOvernight ? "text-muted-foreground/50" : "text-func-hydration-cyan/90",
          )}
        >
          {formatFluid(row.liquidsMl)}
        </td>

        {/* Cue column */}
        <td
          className={cn(
            "border-b border-border/40 py-[7px] pl-3 align-top text-[10.5px] leading-[1.35]",
            isOvernight ? "text-muted-foreground/45" : "text-muted-foreground",
          )}
        >
          {row.isMeal && (
            <span className="mr-1.5 inline-block rounded border border-emerald-500/30 bg-emerald-500/10 px-1 py-[1px] align-[1px] text-[7.5px] font-extrabold uppercase tracking-[0.06em] text-emerald-400">
              MEAL
            </span>
          )}
          {row.lead && (
            <span className="font-semibold text-foreground/90">{row.lead} </span>
          )}
          <span>{row.cue}</span>
        </td>
      </tr>
    </>
  );
}
