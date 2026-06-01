// WP-T11 — TodaysActionHero
// Phase-aware hero card for the Weight Protocol page. This is the single
// source of truth for "what to do right now": a tier-colored 2px top
// stripe sets the safety mood at a glance, the headline + body explain
// the play, and 4-5 metric pills surface the day's key numbers.
//
// Visual conventions mirror RecoveryDashboard's HeroCard:
//   - card-surface rounded-2xl border border-border/50 p-5
//   - 10px uppercase tracker for the phase label
//   - 13px muted body
//   - tabular-nums on numeric pill values
//   - motion fade + slide-up on mount (320ms spring), guarded by
//     useReducedMotion
//   - optional breath pulse on the headline (3.4s loop) — only when
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
  /** Lifecycle phase — drives the formatted phase label only. */
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

// Format the phase prop into the uppercase tracker label shown at the
// top of the card. We currently use a static label per phase — the
// surrounding page can wrap this with day-counter context (e.g. "CUT
// WEEK · DAY -6") later by passing it via a different prop if needed.
function formatPhaseLabel(phase: ProtocolPhase): string {
  switch (phase) {
    case "prep":
      return "PREP";
    case "cut":
      return "CUT WEEK";
    case "weigh-in":
      return "WEIGH-IN DAY";
    case "refeed":
      return "REFEED";
    case "pre-fight":
      return "PRE-FIGHT";
  }
}

// Tier → top stripe colour. Matches the RecoveryDashboard convention
// of a 2px coloured line at the top of the card rather than a full
// flood — keeps the surface calm while still telegraphing safety.
function tierStripeClass(tier: Tier): string {
  switch (tier) {
    case "green":
      return "bg-func-recovery-green";
    case "amber":
      return "bg-func-warning-yellow";
    case "red":
      return "bg-func-danger-red";
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

  return (
    <motion.section
      initial={prefersReduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 280, duration: 0.32 }}
      className={`relative overflow-hidden card-surface rounded-2xl border border-border/50 p-5 ${className}`}
      aria-label={`Today's action — ${phaseLabel}`}
    >
      {/* Tier-coloured 2px top stripe. */}
      <div
        aria-hidden
        className={`absolute inset-x-0 top-0 h-0.5 ${tierStripeClass(tier)}`}
      />

      {/* Phase label */}
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
        {phaseLabel}
      </p>

      {/* Headline — optionally breath-pulsing */}
      <motion.h2
        className="mt-2 text-[32px] leading-tight font-semibold text-foreground"
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
        // motion scales from the element's center by default; setting
        // a transformOrigin keeps the headline anchored visually so the
        // tiny pulse doesn't shift surrounding copy.
        style={{ transformOrigin: "left center" }}
      >
        {headline}
      </motion.h2>

      {/* Body copy */}
      <p className="mt-2 text-[15px] text-muted-foreground leading-snug">{body}</p>

      {/* Metric pills */}
      {metrics.length > 0 && (
        <div className="mt-4 flex gap-3 flex-wrap">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="flex flex-col gap-0.5 rounded-xl border border-border/40 bg-background/30 px-3 py-2 min-w-[64px]"
            >
              <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
                {m.label}
              </span>
              <span className="text-[18px] font-semibold tabular-nums text-foreground leading-none">
                {m.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </motion.section>
  );
}
