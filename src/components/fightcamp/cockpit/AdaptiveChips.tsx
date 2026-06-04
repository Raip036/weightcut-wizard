import type { CoachCockpitData } from "@/../convex/coachCockpit";

/**
 * Context-adaptive quick-reply chips for the coach cockpit.
 *
 * Phase 2 replaces the four STATIC starter prompts in `FloatingWizardChat`
 * with chips derived from where the fighter actually is in camp — days to
 * weigh-in and whether they're over target. The selection is a pure function
 * of the cockpit read so it stays trivially testable and deterministic:
 *
 *   - Fight week / ≤7 days out  → water-load + weigh-in-day + rehydration.
 *   - Mid camp & over target    → "fix my plan" with the live delta + tracking.
 *   - On track / general        → tracking + meals + safety.
 *   - No camp data (all null)    → the original static starter set.
 *
 * Per-turn `followups` (from each coach response) are rendered separately in
 * `FloatingWizardChat`; this component only owns the *opening* chip set.
 */

/** Surface the start of fight-week chips at or under this many days out. */
const FIGHT_WEEK_DAYS = 7;
/** Treat the fighter as "heavy" once they're more than this far over target. */
const OVER_TARGET_KG = 0.5;

/** Default chips when there is no camp context — mirrors the legacy starters. */
const DEFAULT_CHIPS: readonly string[] = [
  "How's my weight cut tracking?",
  "Plan my meals for today",
  "How do I make weight safely?",
  "What should I train this week?",
];

const FIGHT_WEEK_CHIPS: readonly string[] = [
  "Plan my water load",
  "What do I eat on weigh-in day?",
  "Tips for rehydration post-weigh-in?",
];

const ON_TRACK_CHIPS: readonly string[] = [
  "How's my weight cut tracking?",
  "Plan my meals for today",
  "How do I make weight safely?",
];

/** Format a positive delta for the heavy-state chip, e.g. 1.4 → "1.4kg". */
function formatDelta(deltaKg: number): string {
  const rounded = Math.round(deltaKg * 10) / 10;
  // Drop a trailing ".0" so whole numbers read "2kg", not "2.0kg".
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}kg`;
}

/**
 * Pure chip selector. Exported for direct unit testing / reuse without the
 * surrounding React component. Returns 3–4 chip strings; never empty.
 */
export function selectAdaptiveChips(data: CoachCockpitData | null): string[] {
  // No camp context at all → fall back to the static starter set.
  if (!data || (data.daysToWeighIn === null && data.deltaKg === null && data.phase === null)) {
    return [...DEFAULT_CHIPS];
  }

  const { phase, daysToWeighIn, deltaKg } = data;

  // Fight week (or within a week of weigh-in): make-weight logistics dominate.
  const inFightWeek =
    phase === "fightWeek" ||
    (daysToWeighIn !== null && daysToWeighIn <= FIGHT_WEEK_DAYS);
  if (inFightWeek) {
    return [...FIGHT_WEEK_CHIPS];
  }

  // Mid camp & carrying weight over target → lead with a fix-my-plan prompt
  // pre-filled with the live delta so the first tap is high-signal.
  if (deltaKg !== null && deltaKg > OVER_TARGET_KG) {
    return [
      `I'm ${formatDelta(deltaKg)} heavy - fix my plan`,
      "How's my cut tracking?",
      "What should I train this week?",
    ];
  }

  // On track / general mid-camp state.
  return [...ON_TRACK_CHIPS];
}

export function AdaptiveChips({
  data,
  onPick,
  className,
}: {
  data: CoachCockpitData | null;
  onPick: (text: string) => void;
  className?: string;
}): JSX.Element | null {
  const chips = selectAdaptiveChips(data);

  // Defensive: the selector never returns empty today, but honor the contract.
  if (chips.length === 0) return null;

  return (
    <div
      className={[
        "flex flex-col items-start gap-2",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          onClick={() => onPick(chip)}
          className="min-h-[44px] text-left text-[14px] leading-snug px-3.5 py-2 rounded-2xl border border-primary/30 bg-primary/10 text-foreground active:scale-[0.97] active:bg-primary/20 transition-all"
        >
          {chip}
        </button>
      ))}
    </div>
  );
}

export default AdaptiveChips;
