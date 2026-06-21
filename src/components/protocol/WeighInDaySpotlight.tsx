// WP-T14: WeighInDaySpotlight
// Large hero card for D-0 (weigh-in day) showing the morning timeline of
// beats: weight check → final sauna (if needed) → on-stage → first food
// + ORS. The card is intrinsically attention-worthy, so it ships with an
// amber 2px top stripe regardless of safety tier.
//
// Pro-only: when `locked === true` this component renders `null` so the
// parent page can compose a `LockedDayCard` for the same slot. Keeps the
// locked / unlocked concerns separate at the page level rather than
// branching here.
//
// Visual conventions mirror RecoveryDashboard's HeroCard and the rest of
// the protocol surface:
//   - `card-surface rounded-2xl border border-border/50 p-5`
//   - 2px amber top stripe (`bg-func-warning-yellow`)
//   - 10px uppercase tracker for the section label
//   - 18px semibold headline, 13px muted body
//   - tabular-nums on time chips
//   - mount: fade + slide-up (16px, 320ms spring); entry rows stagger
//     50ms after the card lands
//   - all motion respects `prefers-reduced-motion`
import { motion, useReducedMotion } from "motion/react";
import { Icon, type IonIconName } from "@/components/ui/Icon";

export interface TimelineEntry {
  /** Time label, e.g. "06:00". Rendered as a tabular-nums chip. */
  time: string;
  /** Optional emoji used as a leading glyph when no `iconName` is provided. */
  emoji?: string;
  /** Optional Ionicon name rendered before the label. Takes precedence over `emoji`. */
  iconName?: IonIconName;
  /** Short description, e.g. "weight check" / "final sauna IF needed" / "ON-STAGE". */
  label: string;
  /** Most-important beat (typically the weigh-in itself). Gets bolder text + amber dot marker. */
  highlight?: boolean;
}

export interface WeighInDaySpotlightProps {
  /** Display weigh-in time, e.g. "11:00". Empty string falls back to a label-only chip. */
  weighInTime: string;
  /** Vertical list of morning beats, top-to-bottom. */
  entries: TimelineEntry[];
  /**
   * If true, render `null` so the parent can compose a `LockedDayCard`
   * for this slot. Keeps locked / unlocked rendering paths separate.
   */
  locked?: boolean;
  className?: string;
}

// ── Component ────────────────────────────────────────────────────────

export function WeighInDaySpotlight({
  weighInTime,
  entries,
  locked = false,
  className = "",
}: WeighInDaySpotlightProps) {
  const prefersReduced = useReducedMotion();

  // Pro-only: free users see a `LockedDayCard` rendered by the parent.
  // We return null here rather than branching to keep this component
  // purely focused on the unlocked experience.
  if (locked) return null;

  const hasEntries = entries.length > 0;
  const trimmedWeighInTime = weighInTime.trim();
  const chipLabel = trimmedWeighInTime
    ? `[ ON-STAGE ${trimmedWeighInTime} ]`
    : `[ WEIGH-IN ]`;
  const bodyCopy = trimmedWeighInTime
    ? `Make the scale at ${trimmedWeighInTime}. Once you step off, the rehydration timeline takes over.`
    : `Make the scale on time. Once you step off, the rehydration timeline takes over.`;

  return (
    <motion.section
      role="region"
      aria-label="Weigh-in day spotlight"
      initial={prefersReduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 280, duration: 0.32 }}
      className={`relative overflow-hidden card-surface rounded-2xl border border-border/50 p-5 ${className}`}
    >
      {/* Amber 2px top stripe: matches TodaysActionHero / FightPlanDayCard
          "today" treatment. Weigh-in day is always attention-worthy. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5 bg-func-warning-yellow"
      />

      {/* Header row: section tracker + weigh-in time chip */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">
          WEIGH-IN DAY
        </p>
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] tabular-nums text-func-warning-yellow">
          {chipLabel}
        </span>
      </div>

      {/* Headline */}
      <h2 className="mt-2 text-[18px] leading-tight font-semibold text-foreground">
        Final cut · first refeed
      </h2>

      {/* Body copy */}
      <p className="mt-2 text-[13px] text-muted-foreground leading-snug">
        {bodyCopy}
      </p>

      {/* Timeline */}
      <div className="mt-4">
        {hasEntries ? (
          <ol className="relative space-y-3">
            {/* Connector bar: sits behind the rows and is hidden from
                a11y. We use absolute positioning + a calibrated left
                inset so the bar lands under the row markers. */}
            <div
              aria-hidden
              className="absolute left-[3px] top-1.5 bottom-1.5 w-[2px] bg-border/40 rounded-full"
            />
            {entries.map((entry, i) => (
              <TimelineRow
                key={`${entry.time}-${i}`}
                entry={entry}
                index={i}
                prefersReduced={!!prefersReduced}
              />
            ))}
          </ol>
        ) : (
          // Fallback when the upstream plan hasn't landed yet. Kept as a
          // single muted line so the card height stays close to its
          // populated state and we avoid layout shift on data arrival.
          <p className="text-[13px] text-muted-foreground/70 italic">
            Plan loading…
          </p>
        )}
      </div>
    </motion.section>
  );
}

// ── Internal: TimelineRow ────────────────────────────────────────────

interface TimelineRowProps {
  entry: TimelineEntry;
  index: number;
  prefersReduced: boolean;
}

function TimelineRow({ entry, index, prefersReduced }: TimelineRowProps) {
  // Card lands at ~0ms, then rows stagger 50ms apart after a small lead
  // so the timeline reads as building beneath the headline rather than
  // arriving simultaneously with it.
  const delay = prefersReduced ? 0 : 0.18 + index * 0.05;

  const isHighlight = !!entry.highlight;

  return (
    <motion.li
      initial={prefersReduced ? false : { opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        delay,
        type: "spring",
        damping: 26,
        stiffness: 320,
      }}
      className="relative pl-5 flex items-center gap-3"
    >
      {/* Row marker: sits on top of the connector bar. Highlight rows
          get a filled amber dot; other rows get a muted ring so the bar
          reads as continuous between beats. */}
      <span
        aria-hidden
        className={`absolute left-0 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full ${
          isHighlight
            ? "bg-func-warning-yellow ring-2 ring-func-warning-yellow/25"
            : "bg-border/80 ring-2 ring-background"
        }`}
      />

      {/* Time chip: tabular nums keeps the column visually aligned. */}
      <span
        className={`text-[12px] tabular-nums shrink-0 inline-flex items-center gap-1 ${
          isHighlight
            ? "text-foreground font-semibold"
            : "text-muted-foreground"
        }`}
      >
        {entry.iconName ? (
          <Icon name={entry.iconName} size={14} aria-hidden />
        ) : entry.emoji ? (
          <span aria-hidden className="text-[12px] leading-none">
            {entry.emoji}
          </span>
        ) : null}
        <span>{entry.time}</span>
      </span>

      {/* Label: foreground for the highlight beat, muted otherwise. */}
      <span
        className={`text-[13px] leading-snug ${
          isHighlight
            ? "text-foreground font-semibold"
            : "text-muted-foreground"
        }`}
      >
        {entry.label}
      </span>
    </motion.li>
  );
}
