// WP-T16 — RehydrationHourRow
// Single row in the hour-by-hour rehydration timeline. The parent renders
// 23-ish of these inside an `<ol role="list">` covering the gap from
// weigh-in (H+0) to fight time (H+~23). Each row has three states:
//
//   - past    → opacity-60, ✓ leading marker, body always collapsed
//   - current → full opacity, pulsing tier-coloured marker + expanding
//               ring, body always expanded (it's the "now" focal point)
//   - future  → outlined leading marker, body collapsed by default;
//               tap to expand (the row is rendered as a <button> so the
//               affordance is keyboard-accessible)
//
// Visual conventions mirror the rest of the protocol/ family:
//   - card-surface rounded-2xl border border-border/50
//   - 13px body copy, 12px muted notes, 12px tier-red caution
//   - tabular-nums on the `H+N` tracker and the ml/g chip
//
// Mount animation: fade-in only (no slide — 23 rows sliding at once is
// noisy). Stagger 40ms × index, capped at 8 so the back half of the list
// doesn't wait ~900ms before settling. Guarded by `prefers-reduced-motion`.
//
// Current-state pulse:
//   - Marker dot: 1.6s opacity loop (1 → 0.55 → 1)
//   - Expanding ring: 1px ring grows outward and fades (scale 1 → 1.8,
//     opacity 0.6 → 0), 1.6s loop
// Both pulses are gated behind `prefers-reduced-motion` — under reduced
// motion the dot is solid and the ring is absent.
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import type { RehydrationProtocol } from "@/../convex/_shared/aiSchemas";

type HourEntry = RehydrationProtocol["hours"][number];

export interface RehydrationHourRowProps {
  hour: HourEntry;
  state: "past" | "current" | "future";
  className?: string;
  /** Mount stagger index. Capped at 8 internally. */
  index?: number;
}

// ── Formatting helpers ───────────────────────────────────────────────

/** "H+0" / "H+5". `hourOffset` is non-negative in the rehydration math. */
function formatHourTracker(hourOffset: number): string {
  return `H+${hourOffset}`;
}

/** "120g carb" / "60g carb" — short food shorthand for the right-rail chip.
 *  We pick the largest macro by mass; in practice the rehydration plan is
 *  carb-led until the last few hours so this almost always reads "Xg carb". */
function formatFoodShorthand(foodGrams: HourEntry["foodGrams"]): string {
  const { carbs, protein, fat } = foodGrams;
  if (carbs >= protein && carbs >= fat) {
    const rounded = Math.round(carbs);
    if (rounded === 0) return "—";
    return `${rounded}g carb`;
  }
  if (protein >= fat) {
    return `${Math.round(protein)}g pro`;
  }
  if (fat > 0) {
    return `${Math.round(fat)}g fat`;
  }
  return "—";
}

/** Aria suffix per state. */
function ariaSuffix(state: "past" | "current" | "future"): string {
  if (state === "past") return "done";
  if (state === "current") return "current hour";
  return "upcoming";
}

// ── Component ────────────────────────────────────────────────────────

export function RehydrationHourRow({
  hour,
  state,
  className = "",
  index = 0,
}: RehydrationHourRowProps) {
  const prefersReduced = useReducedMotion();
  const [futureExpanded, setFutureExpanded] = useState(false);

  // Past is locked-collapsed; current is locked-expanded; future toggles.
  const isExpanded =
    state === "current" || (state === "future" && futureExpanded);

  const isPast = state === "past";
  const isCurrent = state === "current";
  const isFuture = state === "future";

  // Stagger: 40ms × index, capped at 8 entries.
  const staggerDelay = Math.min(index, 8) * 0.04;

  const tracker = formatHourTracker(hour.hourOffset);
  const liquidsChip = `${Math.round(hour.liquidsMl)}ml`;
  const foodChip = formatFoodShorthand(hour.foodGrams);

  const opacityClass = isPast ? "opacity-60" : "opacity-100";

  // Tap behaviour: only future rows toggle. We still render past + current
  // as a non-interactive container — past rows are quiet log entries and
  // current rows are the focal point, so neither benefits from being a
  // button.
  const Container: React.ElementType = isFuture ? "button" : "div";
  const containerProps = isFuture
    ? {
        type: "button" as const,
        onClick: () => setFutureExpanded((v) => !v),
        "aria-expanded": futureExpanded,
      }
    : {};

  return (
    <motion.li
      role="listitem"
      initial={prefersReduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: staggerDelay, duration: 0.22, ease: "easeOut" }}
      className={className}
      aria-label={`${hour.label}, ${ariaSuffix(state)}`}
    >
      <Container
        {...containerProps}
        className={`w-full text-left card-surface rounded-2xl border border-border/50 px-4 py-3 ${opacityClass} ${
          isFuture
            ? "active:scale-[0.995] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            : ""
        }`}
      >
        <div className="grid grid-cols-[24px_1fr_auto] gap-3 items-start">
          {/* ── Left: leading marker ───────────────────────────── */}
          <div className="relative flex items-center justify-center h-5 w-6">
            <LeadingMarker state={state} prefersReduced={!!prefersReduced} />
          </div>

          {/* ── Middle: stacked content ────────────────────────── */}
          <div className="min-w-0">
            {/* Top line: tracker + label */}
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] tabular-nums text-muted-foreground/70">
                {tracker}
              </span>
              <span
                className={`text-[13px] leading-snug truncate ${
                  isCurrent
                    ? "font-semibold text-foreground"
                    : "text-foreground/90"
                }`}
              >
                {hour.label}
              </span>
            </div>

            {/* Expanded body */}
            {isExpanded && (
              <div className="mt-2 space-y-1.5">
                {hour.liquidsComposition && (
                  <p className="text-[13px] text-foreground/85 leading-snug">
                    {hour.liquidsComposition}
                  </p>
                )}
                {hour.foodCopy && (
                  <p className="text-[13px] text-foreground/85 leading-snug">
                    {hour.foodCopy}
                  </p>
                )}
                {hour.notes && (
                  <p className="text-[12px] text-muted-foreground leading-snug">
                    {hour.notes}
                  </p>
                )}
                {hour.caution && (
                  <p className="text-[12px] text-func-danger-red leading-snug">
                    {hour.caution}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Right: collapsed-view shorthand chips ─────────── */}
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className="text-[11px] font-semibold tabular-nums text-foreground/90 leading-none">
              {liquidsChip}
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums leading-none">
              {foodChip}
            </span>
          </div>
        </div>
      </Container>
    </motion.li>
  );
}

// ── Internal: LeadingMarker ──────────────────────────────────────────
// 24px-wide visual slot holding the per-state marker.
//   past    → small filled muted circle + tiny checkmark badge
//   current → filled amber dot + persistent pulse + expanding ring
//   future  → outlined circle (no fill)
function LeadingMarker({
  state,
  prefersReduced,
}: {
  state: "past" | "current" | "future";
  prefersReduced: boolean;
}) {
  if (state === "past") {
    return (
      <span
        aria-hidden
        className="inline-flex items-center justify-center h-3 w-3 rounded-full bg-muted-foreground/60 text-background"
      >
        <Icon name="checkmarkOutline" size={8} aria-hidden />
      </span>
    );
  }

  if (state === "current") {
    // Filled amber dot (matches the wider page's "current" amber tier).
    // Under reduced motion we render a solid dot and skip the ring entirely.
    if (prefersReduced) {
      return (
        <span
          aria-hidden
          className="inline-block h-3 w-3 rounded-full bg-func-warning-yellow"
        />
      );
    }
    return (
      <span aria-hidden className="relative inline-flex h-3 w-3">
        {/* Expanding 1px ring — fades out as it grows. */}
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full ring-1 ring-func-warning-yellow"
          initial={{ scale: 1, opacity: 0.6 }}
          animate={{ scale: 1.8, opacity: 0 }}
          transition={{
            duration: 1.6,
            repeat: Infinity,
            repeatType: "loop",
            ease: "easeOut",
          }}
        />
        {/* Dot core — soft opacity breath. */}
        <motion.span
          aria-hidden
          className="relative inline-block h-3 w-3 rounded-full bg-func-warning-yellow"
          animate={{ opacity: [1, 0.55, 1] }}
          transition={{
            duration: 1.6,
            repeat: Infinity,
            repeatType: "loop",
            ease: "easeInOut",
          }}
        />
      </span>
    );
  }

  // future
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 rounded-full border-2 border-border/40"
    />
  );
}
