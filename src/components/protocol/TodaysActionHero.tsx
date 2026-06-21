// WP-T11: TodaysActionHero
// The "Today" focal card for the Weight Protocol page. This is the single
// source of truth for "what to do right now": a primary-accented bordered
// card with a small uppercase label line, three big stat tiles (large
// tabular numbers with small unit labels), a bold one-line action
// headline, then a muted sub-note.
//
// Visual conventions (mirrors the approved combined-v3 mockup, mapped to
// real app tokens):
//   - bg-card rounded-2xl border border-primary/40 + soft primary glow
//   - 10px uppercase primary label line ("TODAY · <phase>")
//   - three bg-muted/30 rounded-xl stat tiles: big tabular number + unit
//   - bold foreground action headline
//   - muted sub-note (body, optionally extended with a folded 4th metric)
//   - motion fade + slide-up on mount (320ms spring), guarded by
//     useReducedMotion
//   - optional breath pulse on the headline (3.4s loop), only when
//     `breathPulse === true` AND the user hasn't requested reduced motion
import { motion, useReducedMotion } from "motion/react";

export type ProtocolPhase = "prep" | "cut" | "weigh-in" | "refeed" | "pre-fight";
export type Tier = "green" | "amber" | "red";

export interface MetricPill {
  /** Short label, e.g. "Carbs" / "Water". 10px uppercase muted. */
  label: string;
  /** Pill value, e.g. "80g" / "5.0→2.0L". 18px tabular-nums foreground. */
  value: string;
}

export interface TodaysActionHeroProps {
  /** Lifecycle phase: drives the formatted phase label only. */
  phase: ProtocolPhase;
  /** Big card headline, e.g. "PRIME THE TANK". 32px semibold. */
  headline: string;
  /** Short body, e.g. "Eat normally. Hit 4.0L water." 15px muted. */
  body: string;
  /** 4-5 stat pills rendered in a wrapping flex row. */
  metrics: MetricPill[];
  /** Tier drives the top stripe colour: green / amber / red. */
  tier: Tier;
  /**
   * When true, the headline gets a slow breath-pulse scale animation.
   * Typical use: weigh-in day and the current rehydration hour during
   * refeed. Always overridden by `prefers-reduced-motion`.
   */
  breathPulse?: boolean;
  className?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

// Format the phase prop into a human label for the "TODAY · <phase>"
// header line.
function formatPhaseLabel(phase: ProtocolPhase): string {
  switch (phase) {
    case "prep":
      return "Prep";
    case "cut":
      return "Cut week";
    case "weigh-in":
      return "Weigh-in day";
    case "refeed":
      return "Refeed";
    case "pre-fight":
      return "Pre-fight";
  }
}

// Split a metric value like "250g", "7.0L", "2.5g", "5.0→2.0L" into a big
// number portion and a trailing unit. We keep the leading numeric run
// (digits, dot, arrows, minus) as the big number and treat the trailing
// alpha run as the unit label. Falls back gracefully for non-numeric
// values by surfacing the whole string as the number with no unit.
function splitValue(value: string): { number: string; unit: string } {
  const match = value.match(/^([\d.,→–—>+\-\s]+)\s*([a-zA-Z%/]+)?$/);
  if (match) {
    return { number: match[1].trim(), unit: (match[2] ?? "").trim() };
  }
  return { number: value, unit: "" };
}

// Tier → soft accent glow tint behind the card. The card border/label
// stay on --primary for the "focal card" look from the mockup; tier is
// expressed as a subtle radial glow so safety mood still reads at a
// glance without competing with the primary accent.
function tierGlowClass(tier: Tier): string {
  switch (tier) {
    case "green":
      return "shadow-[0_0_28px_-8px_rgb(var(--func-recovery-green)/0.35)]";
    case "amber":
      return "shadow-[0_0_28px_-8px_rgb(var(--func-warning-yellow)/0.35)]";
    case "red":
      return "shadow-[0_0_28px_-8px_rgb(var(--func-danger-red)/0.4)]";
  }
}

// ── Component ────────────────────────────────────────────────────────

export function TodaysActionHero({
  phase,
  headline,
  body,
  metrics,
  tier,
  breathPulse = false,
  className = "",
}: TodaysActionHeroProps) {
  const prefersReduced = useReducedMotion();
  const showBreath = breathPulse && !prefersReduced;
  const phaseLabel = formatPhaseLabel(phase);

  // First three numeric metrics become the big stat tiles. A 4th metric
  // (e.g. "Fibre", a text note) is folded into the sub-note line rather
  // than getting its own tile.
  const tiles = metrics.slice(0, 3);
  const foldedMetric = metrics[3] ?? null;

  // Sub-note = body, optionally extended with the folded 4th metric.
  const subNote = foldedMetric
    ? [body, `${foldedMetric.label.toLowerCase()} ${foldedMetric.value}`]
        .filter(Boolean)
        .join(" · ")
    : body;

  return (
    <motion.section
      initial={prefersReduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 280, duration: 0.32 }}
      className={`relative overflow-hidden bg-card rounded-2xl border border-primary/40 p-5 ${tierGlowClass(
        tier
      )} ${className}`}
      aria-label={`Today's action: ${phaseLabel}`}
    >
      {/* Label line: "TODAY · <phase>" in the primary accent. */}
      <p className="text-[10px] uppercase tracking-[0.15em] text-primary font-bold">
        Today · {phaseLabel}
      </p>

      {/* Three big stat tiles */}
      {tiles.length > 0 && (
        <div className="mt-3 flex gap-2">
          {tiles.map((m) => {
            const { number, unit } = splitValue(m.value);
            return (
              <div
                key={m.label}
                className="flex-1 min-w-0 rounded-xl bg-muted/30 px-3 py-2.5 text-center"
              >
                <span className="block text-[26px] font-bold leading-none tabular-nums text-foreground">
                  {number}
                </span>
                <span className="mt-1.5 block text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                  {m.label}
                  {unit ? ` ${unit}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Headline: bold one-line action, optionally breath-pulsing */}
      <motion.h2
        className="mt-4 text-[20px] leading-tight font-bold text-foreground"
        animate={showBreath ? { scale: [1, 1.012, 1] } : { scale: 1 }}
        transition={
          showBreath
            ? {
                duration: 3.4,
                repeat: Infinity,
                repeatType: "loop",
                ease: "easeInOut",
              }
            : { duration: 0 }
        }
        // Anchor the transform so the tiny pulse doesn't shift copy.
        style={{ transformOrigin: "left center" }}
      >
        {headline}
      </motion.h2>

      {/* Sub-note */}
      {subNote && (
        <p className="mt-1.5 text-[13px] text-muted-foreground leading-snug">
          {subNote}
        </p>
      )}
    </motion.section>
  );
}
