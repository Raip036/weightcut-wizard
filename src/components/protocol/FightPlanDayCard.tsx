// WP-T12: FightPlanDayCard
// Per-day card for the Fight Plan day list. The day list is the spine of
// the Fight Plan section: one card per day from T-N down to T-0. Each
// card surfaces the day's `keyAction` headline, its primary `carbsCopy`
// body line, four metric pills (Carbs / Water / Sodium / Fibre), and an
// optional cautions list.
//
// Visual states (driven by the `state` prop chosen at the parent level):
//   - `past`    → opacity-70, optional ✓ checkmark, collapses to a single
//                 line when `collapsed` is true (default for past days)
//   - `today`   → 2px tier-colored top stripe + TODAY pill in the header
//                 (the parent picks the tier; we default to amber, which
//                 matches the wider WeightProtocol page's "current day"
//                 highlight). Always rendered expanded.
//   - `future`  → standard chrome, always expanded
//
// Tap → calls `onToggle?.()` so the parent can flip a collapsed state.
//
// Mount animation: stagger fade-in (60ms × index, capped at 8 so a long
// camp doesn't end up with a half-second pre-roll). Skipped under
// `prefers-reduced-motion`. Subsequent prop changes do not re-trigger
// the entry animation (motion only fires `initial` once per mount).
//
// Visual chrome mirrors RecoveryDashboard:
//   - `card-surface rounded-2xl border border-border/50`
//   - 10px uppercase tracker labels, 15px semibold action line,
//     13px muted body
//   - tabular-nums on numeric pill values
import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import type { FightPlan } from "@/../convex/_shared/aiSchemas";

type DayProjection = FightPlan["days"][number];

export interface FightPlanDayCardProps {
  day: DayProjection;
  state: "past" | "today" | "future";
  /** Past days default-collapsed to a single line. Ignored for `today` / `future`. */
  collapsed?: boolean;
  /** Called when the card is tapped; typically toggles `collapsed`. */
  onToggle?: () => void;
  className?: string;
  /** Mount stagger index. Capped at 8 internally to keep long camps snappy. */
  index?: number;
}

// ── Formatting helpers ────────────────────────────────────────────────

/** "Sun" / "Mon" / ... from a stored ISO yyyy-mm-dd. Falls back to ""
 *  if parsing fails so we never render NaN-style noise. */
function dayOfWeekFromIso(iso: string): string {
  try {
    const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
    if (!y || !m || !d) return "";
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, { weekday: "short" });
  } catch {
    return "";
  }
}

/** "D-6" / "D-0" / "WEIGH-IN" header label. `daysToWeighIn` is non-negative
 *  in the schema; 0 → weigh-in day. */
function dayLabel(daysToWeighIn: number): string {
  if (daysToWeighIn === 0) return "D-0";
  return `D-${daysToWeighIn}`;
}

/** "1000mg" → "1000mg", "2200mg" → "2.2g". Keeps the pill compact while
 *  preserving precision below the cut-off threshold. */
function formatSodium(mg: number): string {
  if (mg < 1000) return `${Math.round(mg)}mg`;
  return `${(mg / 1000).toFixed(1)}g`;
}

/** Map the structured fibre enum to a short pill value. The longer
 *  `fibreCopy` narrative still appears in cautions where relevant. */
function formatFibre(note: DayProjection["fibreNote"]): string {
  switch (note) {
    case "normal":
      return "Normal";
    case "reduce":
      return "Reduce";
    case "eliminate":
      return "Cut";
    case "low_residue_only":
      return "Low-res";
  }
}

// ── Component ─────────────────────────────────────────────────────────

export function FightPlanDayCard({
  day,
  state,
  collapsed = false,
  onToggle,
  className = "",
  index = 0,
}: FightPlanDayCardProps) {
  const prefersReduced = useReducedMotion();

  // Collapse only applies to past days; today + future always render
  // their full body (today is the focal point of the list).
  const isCollapsed = state === "past" && collapsed;
  const isToday = state === "today";
  const isPast = state === "past";

  // Stagger: 60ms per index, capped at 8 entries so a 14-day camp doesn't
  // wait ~840ms before the last card lands.
  const staggerDelay = Math.min(index, 8) * 0.06;

  const headerLabel = `${dayLabel(day.daysToWeighIn)} · ${dayOfWeekFromIso(day.dayIso)}`;

  // Card chrome composition.
  //   - past:   muted (opacity-70)
  //   - today:  amber 2px top stripe + standard chrome
  //   - future: standard chrome
  const containerStateClass = isToday
    ? "opacity-100"
    : isPast
      ? "opacity-70"
      : "opacity-100";

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: staggerDelay,
        type: "spring",
        damping: 24,
        stiffness: 280,
      }}
      className={`relative ${className}`}
    >
      <button
        type="button"
        onClick={onToggle}
        // We render the card as a button when there's something to toggle.
        // Tapping is the expand/collapse affordance. Even when `onToggle`
        // is undefined we keep the button element so focus / press states
        // stay consistent; it just no-ops.
        aria-label={
          isCollapsed
            ? `${headerLabel}, expand`
            : `${headerLabel}: ${day.keyAction}`
        }
        aria-expanded={isPast ? !isCollapsed : undefined}
        className={`w-full text-left card-surface rounded-2xl border border-border/50 overflow-hidden active:scale-[0.995] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${containerStateClass}`}
      >
        {/* Today: 2px amber top stripe. Matches RecoveryDashboard's
            tier-stripe pattern. */}
        {isToday && (
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-0.5 bg-func-warning-yellow"
          />
        )}

        {isCollapsed ? (
          // ── Collapsed past row ───────────────────────────────────────
          // Single-line summary: "D-6 · Sun · ✓ done". Reads as a quiet
          // log entry rather than a card, which keeps long camps scannable.
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[12px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70 tabular-nums">
              {headerLabel}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground/80">
              <Icon name="checkmarkOutline" size={12} aria-hidden />
              <span>done</span>
            </span>
          </div>
        ) : (
          // ── Expanded layout ──────────────────────────────────────────
          <div className="p-4 space-y-3">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70 tabular-nums">
                {headerLabel}
              </span>
              {isToday && (
                <span className="inline-block px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-[0.14em] bg-func-warning-yellow/15 text-func-warning-yellow">
                  Today
                </span>
              )}
              {isPast && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground/80">
                  <Icon name="checkmarkOutline" size={12} aria-hidden />
                  <span>done</span>
                </span>
              )}
            </div>

            {/* Headline: the day's key action */}
            <h3 className="text-[15px] font-semibold leading-snug text-foreground">
              {day.keyAction}
            </h3>

            {/* Body: primary carbs narrative line */}
            {day.carbsCopy && (
              <p className="text-[13px] text-muted-foreground leading-snug">
                {day.carbsCopy}
              </p>
            )}

            {/* Metric pill row: 4 across, wraps on narrow viewports */}
            <div className="flex gap-2 flex-wrap">
              <MetricPill label="Carbs" value={`${Math.round(day.carbsGrams)}g`} />
              <MetricPill label="Water" value={`${day.waterLitres.toFixed(1)}L`} />
              <MetricPill label="Sodium" value={formatSodium(day.sodiumMg)} />
              <MetricPill label="Fibre" value={formatFibre(day.fibreNote)} />
            </div>

            {/* Cautions: bulleted list, tier-coloured to telegraph severity.
                We surface up to the schema-capped 3 entries; the parent
                can do further trimming if needed. */}
            {day.cautions.length > 0 && (
              <ul className="space-y-1 pt-1">
                {day.cautions.map((c, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground"
                  >
                    <span
                      aria-hidden
                      className={`mt-[6px] inline-block h-1 w-1 rounded-full shrink-0 ${
                        isToday
                          ? "bg-func-warning-yellow/70"
                          : "bg-muted-foreground/40"
                      }`}
                    />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </button>
    </motion.div>
  );
}

// ── Internal: MetricPill ──────────────────────────────────────────────
// Tight 2-line pill matching the TodaysActionHero convention (10px
// uppercase label over a 14px tabular-nums value). Kept internal so
// the public API of this file is just the day card.
function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border/40 bg-background/30 px-2.5 py-1.5 min-w-[56px]">
      <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70 font-bold">
        {label}
      </span>
      <span className="text-[14px] font-semibold tabular-nums text-foreground leading-none">
        {value}
      </span>
    </div>
  );
}
