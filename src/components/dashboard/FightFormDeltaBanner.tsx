import { Icon } from "@/components/ui/Icon";
import type { SubScoreKey } from "@/scoring/types";

type Props = {
  delta: number | null;
  topDriver: SubScoreKey | null;
  topLimiter: SubScoreKey | null;
  onTap?: () => void;
  /** When set and there's no meaningful movement, show a neutral "holding on
   *  stale data" chip instead of rendering nothing. */
  held?: { pillarLabel: string; score: number; sinceLabel?: string } | null;
};

const SUBSCORE_HUMAN: Record<SubScoreKey, string> = {
  trainingLoad: "training load",
  sleep: "sleep",
  weightCut: "weight cut",
  // `wellness` is the recovery dimension in the UI, driven by the check-in.
  wellness: "recovery",
  nutritionAdherence: "nutrition",
};

// Threshold below which day-over-day movement is considered noise rather
// than signal. Matches what the brainstorm called the "earn-your-space"
// minimum, a 3-point drift isn't worth a banner; a 5-point one is.
const MIN_NOTABLE_DELTA = 5;

export function FightFormDeltaBanner(p: Props) {
  const hasRealMovement = p.delta != null && Math.abs(p.delta) >= MIN_NOTABLE_DELTA;

  // When there's no real movement but we have stale/held context, show the
  // neutral holding chip instead of rendering nothing.
  if (!hasRealMovement) {
    if (!p.held) return null;
    const heldText = p.held.sinceLabel
      ? `Holding at ${p.held.score} · ${p.held.pillarLabel} not logged since ${p.held.sinceLabel}`
      : `Holding at ${p.held.score} · ${p.held.pillarLabel} not logged`;
    return (
      <button
        type="button"
        onClick={p.onTap}
        className="mt-2 mx-auto w-fit flex items-center gap-1.5 rounded-full border border-border/40 bg-foreground/[0.03] px-2.5 py-1 backdrop-blur-sm transition-colors"
        aria-label="Open Fight Form Score details"
      >
        <Icon name="pauseOutline" size={11} className="text-muted-foreground" />
        <span className="text-[11.5px] font-medium leading-snug text-muted-foreground tracking-tight">{heldText}</span>
      </button>
    );
  }

  const up = p.delta > 0;
  const magnitude = Math.abs(p.delta);
  const subject = up
    ? (p.topDriver ? SUBSCORE_HUMAN[p.topDriver] : null)
    : (p.topLimiter ? SUBSCORE_HUMAN[p.topLimiter] : null);

  const headline = up
    ? subject
      ? `+${magnitude} vs yesterday · ${subject} leading`
      : `+${magnitude} vs yesterday`
    : subject
      ? `−${magnitude} vs yesterday · ${subject} lagging`
      : `−${magnitude} vs yesterday`;

  return (
    <button
      type="button"
      onClick={p.onTap}
      className="mt-2 mx-auto w-fit flex items-center gap-1.5 rounded-full border border-border/40 bg-foreground/[0.03] px-2.5 py-1 backdrop-blur-sm transition-colors"
      aria-label="Open Fight Form Score details"
    >
      <Icon
        name={up ? "caretUp" : "caretDown"}
        size={11}
        className={up ? "text-func-recovery-green" : "text-func-danger-red"}
      />
      <span className="text-[11.5px] font-medium leading-snug text-foreground/85 tracking-tight">{headline}</span>
    </button>
  );
}
