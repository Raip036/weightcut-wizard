import { Icon } from "@/components/ui/Icon";
import type { SubScoreKey } from "@/scoring/types";

type Props = {
  delta: number | null;
  topDriver: SubScoreKey | null;
  topLimiter: SubScoreKey | null;
  onTap?: () => void;
};

const SUBSCORE_HUMAN: Record<SubScoreKey, string> = {
  trainingLoad: "training load",
  sleep: "sleep",
  weightCut: "weight cut",
  wellness: "wellness",
  nutritionAdherence: "nutrition",
};

// Threshold below which day-over-day movement is considered noise rather
// than signal. Matches what the brainstorm called the "earn-your-space"
// minimum — a 3-point drift isn't worth a banner; a 5-point one is.
const MIN_NOTABLE_DELTA = 5;

export function FightFormDeltaBanner(p: Props) {
  if (p.delta == null || Math.abs(p.delta) < MIN_NOTABLE_DELTA) return null;

  const up = p.delta > 0;
  const magnitude = Math.abs(p.delta);
  const subject = up
    ? (p.topDriver ? SUBSCORE_HUMAN[p.topDriver] : null)
    : (p.topLimiter ? SUBSCORE_HUMAN[p.topLimiter] : null);

  const headline = up
    ? subject
      ? `Score +${magnitude} since yesterday — ${subject} is climbing.`
      : `Score +${magnitude} since yesterday.`
    : subject
      ? `Score −${magnitude} since yesterday — ${subject} is the brake.`
      : `Score −${magnitude} since yesterday.`;

  return (
    <button
      type="button"
      onClick={p.onTap}
      className="card-surface rounded-xs border border-border/50 px-3.5 py-2 mt-2 flex items-center justify-center gap-2.5 w-full max-w-sm text-center transition-colors hover:border-border"
      aria-label="Open Fight Form Score details"
    >
      <span
        className={
          up
            ? "shrink-0 rounded-full bg-func-recovery-green/15 text-func-recovery-green p-1.5"
            : "shrink-0 rounded-full bg-func-danger-red/15 text-func-danger-red p-1.5"
        }
      >
        {up ? <Icon name="trendingUpOutline" size={14} /> : <Icon name="trendingDownOutline" size={14} />}
      </span>
      <span className="text-[12.5px] leading-snug text-foreground/90">{headline}</span>
    </button>
  );
}
