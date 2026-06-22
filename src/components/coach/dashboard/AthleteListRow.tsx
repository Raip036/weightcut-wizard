/**
 * AthleteListRow — the workhorse of the coach dashboard. One full-width
 * glass card per athlete that surfaces all four scan-signals without
 * forcing the coach to expand or tap through:
 *
 *   1. Readiness — tier-coloured ring around the avatar
 *   2. Weight   — 7-day sparkline + delta to fight target
 *   3. Camp     — fight-camp phase pill (Build / Peak / Fight Week, with a
 *                 goal-type fallback) + days to fight
 *
 * Last-session recency lives in the human-readable footer line.
 *
 * Apple-Fitness flavour: muted glass card, tier-coloured accents, soft
 * breath-pulse animation when the athlete needs urgent attention (low
 * readiness or active alerts). Reduced-motion respected throughout.
 *
 * Helpers (severity, alerts, phase, deltas) live in `athleteRowHelpers.ts`
 * so this file stays a clean component module.
 */
import { ChevronRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { AthleteAvatar } from "@/components/coach/AthleteAvatar";
import { StrainSparkline } from "@/components/coach/StrainSparkline";
import { Icon } from "@/components/ui/Icon";
import type { AthleteOverviewRow } from "@/hooks/coach/useCoachData";
import {
  buildAlerts,
  campPhase,
  daysSince,
  daysUntil,
  deriveReadiness,
  FIGHT_FORM_LABEL,
  readinessSeverity,
  targetDelta,
  type CampPhase,
  type Severity,
} from "./athleteRowHelpers";

// ── Tailwind colour maps ────────────────────────────────────────────────
// Static literal strings so the JIT extractor sees every variant.

const SEV_RING: Record<Severity, string> = {
  ok: "stroke-func-recovery-green",
  warn: "stroke-func-warning-yellow",
  alert: "stroke-func-danger-red",
};
const SEV_PILL: Record<Severity, string> = {
  ok: "bg-func-recovery-green/12 text-func-recovery-green ring-func-recovery-green/30",
  warn: "bg-func-warning-yellow/12 text-func-warning-yellow ring-func-warning-yellow/30",
  alert: "bg-func-danger-red/12 text-func-danger-red ring-func-danger-red/30",
};
const PHASE_PILL: Record<CampPhase, string> = {
  Cut: "bg-func-warning-yellow/12 text-func-warning-yellow ring-func-warning-yellow/25",
  Build: "bg-func-recovery-green/12 text-func-recovery-green ring-func-recovery-green/25",
  Maintain: "bg-primary/12 text-primary ring-primary/25",
  Plan: "bg-muted/40 text-muted-foreground ring-border/40",
};
// Actual fight-camp phase (preferred over the goal-type fallback above).
// Cool → hot as the fight nears: Build (green) → Peak (orange) → Fight Week (red).
type CampPhaseKey = "build" | "peak" | "fightWeek";
const CAMP_PHASE_LABEL: Record<CampPhaseKey, string> = {
  build: "Build",
  peak: "Peak",
  fightWeek: "Fight Week",
};
const CAMP_PHASE_PILL: Record<CampPhaseKey, string> = {
  build: "bg-func-recovery-green/12 text-func-recovery-green ring-func-recovery-green/25",
  peak: "bg-func-carbs-orange/12 text-func-carbs-orange ring-func-carbs-orange/25",
  fightWeek: "bg-func-danger-red/12 text-func-danger-red ring-func-danger-red/25",
};
// Left-edge severity stripe — replaces the loud "AT RISK" text chip.
// Encodes the row's headline status as a single ambient colour bar.
const SEV_STRIPE: Record<Severity, string> = {
  ok: "bg-func-recovery-green",
  warn: "bg-func-warning-yellow",
  alert: "bg-func-danger-red",
};

// ── ReadinessAvatarRing ─────────────────────────────────────────────────
// Tiny SVG ring drawn around the avatar. Track is muted, arc fills tier-
// coloured by readiness. Designed to nest a 40px avatar inside a 52px
// outer ring.

function ReadinessAvatarRing({
  size = 52,
  strokeWidth = 2.5,
  score,
  severity,
}: {
  size?: number;
  strokeWidth?: number;
  score: number | null;
  severity: Severity;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = score == null ? 0 : Math.max(0, Math.min(1, score / 100));
  const dashOffset = circumference * (1 - pct);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="absolute inset-0"
      aria-hidden
    >
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted) / 0.35)"
          strokeWidth={strokeWidth}
        />
        {score != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className={SEV_RING[severity]}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 500ms ease" }}
          />
        )}
      </g>
    </svg>
  );
}

// ── Row component ──────────────────────────────────────────────────────

interface AthleteListRowProps {
  athlete: AthleteOverviewRow;
  /** Staggered entrance — passed by the list parent for the cascade. */
  index?: number;
  onOpen: () => void;
}

export function AthleteListRow({
  athlete,
  index = 0,
  onOpen,
}: AthleteListRowProps) {
  const prefersReduced = useReducedMotion();
  const readiness = deriveReadiness(athlete);
  const alerts = buildAlerts(athlete);
  const sev = readinessSeverity(readiness, alerts.length > 0);
  // Phase pill: prefer the athlete's ACTUAL fight-camp phase (Build / Peak /
  // Fight Week); fall back to the goal-type label (Maintain / Cut / …) when
  // they aren't in a dated camp.
  const campPhaseKey = athlete.fight_form?.phase ?? null;
  const goalPhase = campPhase(athlete.goal_type);
  const phaseLabel = campPhaseKey ? CAMP_PHASE_LABEL[campPhaseKey] : goalPhase;
  const phasePillClass = campPhaseKey
    ? CAMP_PHASE_PILL[campPhaseKey]
    : PHASE_PILL[goalPhase];
  const dToFight = daysUntil(athlete.target_date);
  const delta = targetDelta(athlete);
  const wDays = daysSince(athlete.last_weight_at);
  const lastSessionLabel =
    wDays == null
      ? "no recent log"
      : wDays === 0
        ? "today"
        : wDays === 1
          ? "yesterday"
          : `${wDays}d ago`;

  // Breath pulse — fires when the athlete needs urgent attention. Pure
  // animate prop on the outer motion.button; reduced-motion swaps to a
  // static scale so the row never moves for users opting out.
  const shouldBreathe =
    !prefersReduced &&
    ((readiness != null && readiness < 40) ||
      alerts.some((a) => a.tone === "alert"));

  // Readiness pill copy — show the score if we have one, fall back to the
  // fight-form label for athletes still calibrating but past zero-data.
  const readinessPillValue =
    readiness != null
      ? String(readiness)
      : athlete.fight_form
        ? FIGHT_FORM_LABEL[athlete.fight_form.label]
        : "-";

  // Stagger entry — capped at 8 so a 50-athlete roster doesn't crawl in.
  const animDelay = Math.min(index, 8) * 0.04;

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={prefersReduced ? false : { opacity: 0, y: 6 }}
      animate={
        shouldBreathe
          ? { opacity: 1, y: 0, scale: [1, 1.005, 1] }
          : { opacity: 1, y: 0 }
      }
      transition={
        shouldBreathe
          ? {
              opacity: { duration: 0.32, ease: "easeOut", delay: animDelay },
              y: { duration: 0.32, ease: "easeOut", delay: animDelay },
              scale: {
                duration: 3,
                repeat: Infinity,
                repeatType: "loop",
                ease: "easeInOut",
                delay: 0.5,
              },
            }
          : { duration: 0.32, ease: "easeOut", delay: animDelay }
      }
      aria-label={`${athlete.display_name}, readiness ${readiness ?? "unknown"}, ${alerts.length} alert${alerts.length === 1 ? "" : "s"}`}
      className="group glass-card relative flex w-full flex-col gap-2 overflow-hidden rounded-2xl border border-border/50 p-4 pl-[18px] text-left active:bg-muted/20 transition-colors"
    >
      {/* Severity stripe — 4px tier-coloured bar on the left edge that
          replaces the old "AT RISK" text chip. Single ambient signal of
          the row's headline status. */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-1 ${SEV_STRIPE[sev]}`}
      />

      <div className="flex items-center gap-3">
        {/* Avatar with tier-coloured readiness ring */}
        <div className="relative shrink-0" style={{ width: 52, height: 52 }}>
          <ReadinessAvatarRing score={readiness} severity={sev} />
          <div className="absolute inset-0 flex items-center justify-center">
            <AthleteAvatar
              avatarUrl={athlete.avatar_url}
              name={athlete.display_name}
              size={40}
            />
          </div>
        </div>

        {/* Name + alert dot + chevron */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[15px] font-semibold truncate leading-tight">
              {athlete.display_name}
            </p>
            <div className="flex items-center gap-1.5 shrink-0">
              {alerts.length > 0 && (
                <motion.span
                  aria-hidden
                  animate={
                    prefersReduced ? undefined : { opacity: [0.45, 1, 0.45] }
                  }
                  transition={
                    prefersReduced
                      ? undefined
                      : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
                  }
                  className="h-2 w-2 rounded-full bg-func-danger-red"
                />
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
            </div>
          </div>

          {/* Metric pill row — 3 inline pills sized for phone widths.
              Each pill carries a quiet leading icon glyph so the value
              isn't a context-free number. Readiness is conveyed via the
              avatar ring + accessibility label, so no separate readiness
              pill. Last-session moves to the human-readable footer. */}
          {/* Two matched pills — weight delta + camp phase. Identical height,
              padding, font-weight and icon size so they read as an aligned
              pair. (The old weekly-hours pill was removed.) */}
          <div className="mt-2 flex items-center gap-1.5 flex-nowrap min-w-0">
            {/* Weight sparkline + delta */}
            <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-muted/30 px-2 text-[10px] font-semibold text-foreground/80 ring-1 ring-border/40 tabular-nums shrink-0">
              <Icon
                name="scaleOutline"
                size={11}
                className="opacity-60"
                aria-label="weight"
              />
              <StrainSparkline
                values={athlete.strain_7d ?? []}
                width={24}
                height={10}
                className="opacity-90"
              />
              <span>
                {delta == null
                  ? "-"
                  : delta > 0
                    ? `+${delta.toFixed(1)}kg`
                    : delta < 0
                      ? `${delta.toFixed(1)}kg`
                      : "on tgt"}
              </span>
            </span>

            {/* Camp phase + days-to-fight */}
            <span
              className={`inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-[10px] font-semibold ring-1 tabular-nums shrink-0 ${phasePillClass}`}
            >
              <Icon
                name="flagOutline"
                size={11}
                className="opacity-60"
                aria-label="camp phase"
              />
              <span>{phaseLabel}</span>
              {dToFight != null && dToFight >= 0 && (
                <>
                  <span className="opacity-50">·</span>
                  <span>{dToFight}d</span>
                </>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Footer — human-readable headline of the row's data. Two short
          clauses joined by a dot, muted. Reads as the "what's going on"
          line under the metric pills. */}
      <div className="pl-[64px] text-[11px] text-muted-foreground leading-tight truncate">
        {delta == null
          ? "no weight on file"
          : delta > 0
            ? `+${delta.toFixed(1)}kg to target`
            : delta < 0
              ? `${delta.toFixed(1)}kg to target`
              : "on target"}
        <span className="opacity-50"> · </span>
        last session {lastSessionLabel}
      </div>
    </motion.button>
  );
}
