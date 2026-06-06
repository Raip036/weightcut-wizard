// CoachCockpitHeader — Fight Camp Coach redesign, Phase 2.
//
// The pinned cockpit header that sits ABOVE the chat scroll inside the
// FightCamp Coach bottom sheet (under the "FightCamp Coach" title bar). It is
// what makes the coach feel alive before any typing: a proactive, data-grounded
// greeting, the camp phase, a live weigh-in countdown, and a compact
// "weight to go" mini-callout — all from the same fightWeekData the coach
// action loads (surfaced via the `coachCockpit` query, `CoachCockpitData`).
//
// This is intentionally COMPACT (it is a header, not the big in-chat
// `weight_target` card from CoachBlocks). It reuses existing tokens
// (card-surface, rounded-xs, display-number, func-*) and the shared Icon.
//
// Composes sibling cockpit pieces — PhasePill, WeighInCountdown — and the
// `buildCoachGreeting` helper (each owned by a sibling agent; coded against
// their contracts).
import { motion, useReducedMotion } from "motion/react";
// `CoachCockpitData` is the canonical type exported by the backend cockpit
// query. The codebase imports Convex types via the `@/../convex/...` path
// (only `@/*` is aliased), so we use that form here.
import type { CoachCockpitData } from "@/../convex/coachCockpit";
import { Icon } from "@/components/ui/Icon";
import { PhasePill } from "@/components/fightcamp/cockpit/PhasePill";
import { WeighInCountdown } from "@/components/fightcamp/cockpit/WeighInCountdown";
import { buildCoachGreeting } from "@/lib/coachGreeting";

const SECTION_LABEL =
  "text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70";

/**
 * True when there is nothing camp-relevant to show. We treat the header as
 * empty if every key field is null, so the cockpit simply doesn't render a
 * header outside of a camp.
 */
function hasNoCampData(data: CoachCockpitData): boolean {
  return (
    data.phase === null &&
    data.daysToWeighIn === null &&
    data.weighInDateISO === null &&
    data.currentKg === null &&
    data.targetKg === null &&
    data.deltaKg === null &&
    data.fightName === null
  );
}

/**
 * Compact "weight to go" mini-callout. Distinct from the in-chat
 * `weight_target` hero card: small, single-line, header-scale typography.
 *
 * Sign semantics mirror CoachBlocks' WeightTargetBlock: a positive delta means
 * still over target ("to go"); a non-positive delta means at/under target. We
 * render the magnitude with a real minus glyph for negatives. Tone: green when
 * on track, amber when over/off track.
 */
function WeightToGo({
  deltaKg,
  onTrack,
}: {
  deltaKg: number;
  onTrack: boolean | null;
}): JSX.Element {
  const isOver = deltaKg > 0;
  const sign = deltaKg < 0 ? "−" : "";
  const magnitude = Math.abs(deltaKg).toFixed(1);
  const verb = isOver ? "over" : "to go";

  // On-track tone wins when known; otherwise fall back to "over → amber".
  const positive = onTrack ?? !isOver;
  const toneText = positive ? "text-func-recovery-green" : "text-func-warning-yellow";
  const toneBorder = positive
    ? "border-func-recovery-green/25"
    : "border-func-warning-yellow/25";

  return (
    <div
      className={`card-surface rounded-xs border ${toneBorder} px-2.5 py-1.5 inline-flex items-baseline gap-1.5`}
      role="group"
      aria-label={`Weight ${verb}: ${sign}${magnitude} kilograms`}
    >
      <span className={SECTION_LABEL}>weight</span>
      <span
        className={`display-number text-[15px] font-bold leading-none tabular-nums ${toneText}`}
      >
        {sign}
        {magnitude}
        <span className="ml-0.5 text-[10px] font-semibold text-muted-foreground">
          kg
        </span>
      </span>
      <span className={`text-[10px] font-semibold uppercase tracking-wide ${toneText}`}>
        {verb}
      </span>
    </div>
  );
}

export function CoachCockpitHeader({
  data,
}: {
  data: CoachCockpitData | null;
}): JSX.Element | null {
  const prefersReduced = useReducedMotion();

  // Nothing to show when there's no data, or when every key field is null.
  if (data === null || hasNoCampData(data)) return null;

  const greeting = buildCoachGreeting(data, new Date());

  // Show the mini-callout only when we have a concrete delta to render.
  const showWeight = data.deltaKg !== null;

  return (
    <motion.header
      initial={prefersReduced ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 26, stiffness: 280 }}
      className="card-surface rounded-xs border border-border/40 px-3.5 py-3 space-y-2.5"
    >
      {/* Top row: proactive greeting, ≤ 2 lines, VoiceOver-announced. */}
      <p
        aria-live="polite"
        className="text-[13.5px] font-semibold leading-snug text-foreground/95 line-clamp-2"
      >
        {greeting}
      </p>

      {/* Second row: phase + countdown side by side, with the compact
          weight-to-go callout trailing when available. */}
      <div className="flex flex-wrap items-center gap-2">
        <PhasePill phase={data.phase} />
        <WeighInCountdown
          weighInDateISO={data.weighInDateISO}
          daysToWeighIn={data.daysToWeighIn}
        />
        {showWeight && (
          <div className="ml-auto">
            <WeightToGo deltaKg={data.deltaKg as number} onTrack={data.onTrack} />
          </div>
        )}
      </div>

      {/* Fight name footnote when present — quiet context, not a focal point. */}
      {data.fightName && (
        <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70">
          <Icon name="trophyOutline" size={11} className="text-muted-foreground/70" />
          <span className="truncate">{data.fightName}</span>
        </p>
      )}
    </motion.header>
  );
}
