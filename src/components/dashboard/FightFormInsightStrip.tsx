import type { FightFormLabel, FightFormState, ScoringPhase, SubScoreKey } from "@/scoring/types";

type Adherence = {
  weight: boolean;
  sleep: boolean;
  training: boolean;
  wellnessCheckin: boolean;
};

type CalibrationProgress = {
  daysWithAnyLog: number;
  daysNeeded: number;
  unlocked: boolean;
  perSource: {
    sleep: number;
    weight: number;
    training: number;
    wellness: number;
    nutrition: number;
  };
};

type Props = {
  state: FightFormState;
  label: FightFormLabel;
  phase: ScoringPhase | null;
  topDriver: SubScoreKey | null;
  topLimiter: SubScoreKey | null;
  appliedCeiling: { ruleId: string; cap: number } | null;
  adherence: Adherence;
  calibration: CalibrationProgress | null;
  onHeadlineTap?: () => void;
};

type SourceKey = "sleep" | "weight" | "training" | "wellness" | "nutrition";

const SOURCE_LABEL: Record<SourceKey, string> = {
  sleep: "Sleep",
  weight: "Weight",
  training: "Train",
  wellness: "Wellness",
  nutrition: "Meals",
};

const SUBSCORE_HUMAN: Record<SubScoreKey, string> = {
  trainingLoad: "Training load",
  sleep: "Sleep",
  weightCut: "Weight cut",
  wellness: "Wellness",
  nutritionAdherence: "Nutrition",
};

function adherenceForSource(a: Adherence, source: SourceKey): boolean {
  switch (source) {
    case "sleep": return a.sleep;
    case "weight": return a.weight;
    case "training": return a.training;
    case "wellness": return a.wellnessCheckin;
    case "nutrition": return false; // no per-day adherence bool yet for meals
  }
}

function nextMissingSource(adherence: Adherence): SourceKey | null {
  // Prefer the lightest-friction logs first: sleep & weight are sub-10s actions.
  const order: SourceKey[] = ["sleep", "weight", "wellness", "training", "nutrition"];
  for (const s of order) {
    if (s === "nutrition") continue; // can't reliably infer today-logged
    if (!adherenceForSource(adherence, s)) return s;
  }
  return null;
}

function headlineFor(p: Props): string {
  if (p.state === "no_camp") return "Set a target date and goal weight to start scoring your camp.";
  if (p.state === "paused")  return "Camp is paused. Log when ready to resume.";

  // Cold-start override — when nothing is logged today yet, replace the
  // numeric / calibration copy with a single welcoming sentence.
  const nothingLoggedToday =
    !p.adherence.sleep
    && !p.adherence.weight
    && !p.adherence.training
    && !p.adherence.wellnessCheckin;
  if (nothingLoggedToday) return "Fresh start — log anything to begin";

  if (p.state === "calibrating") {
    if (!p.calibration) return "Logging your first days to calibrate your score.";
    const { daysWithAnyLog, daysNeeded, unlocked } = p.calibration;
    if (unlocked) return "Calibration complete. Finalizing your score now.";
    const missing = nextMissingSource(p.adherence);
    const remaining = Math.max(1, daysNeeded - daysWithAnyLog);
    if (missing) {
      return `${remaining} more ${remaining === 1 ? "day" : "days"} to unlock.\nLog ${SOURCE_LABEL[missing].toLowerCase()} today to advance.`;
    }
    return `${remaining} more ${remaining === 1 ? "day" : "days"} of logging to unlock your score.`;
  }

  // state === "ok"
  if (p.appliedCeiling) {
    if (p.appliedCeiling.ruleId === "weight_cut_dangerous") return "Score capped. Weight loss is too aggressive this week.";
    if (p.appliedCeiling.ruleId === "sleep_debt") return "Score capped. Sleep debt is over 10 hours.";
    if (p.appliedCeiling.ruleId === "training_spike") return "Score capped. Training load is spiking.";
    return `Score capped at ${p.appliedCeiling.cap}.`;
  }

  const driver = p.topDriver ? SUBSCORE_HUMAN[p.topDriver] : null;
  const limiter = p.topLimiter ? SUBSCORE_HUMAN[p.topLimiter] : null;

  if (p.label === "sharp") {
    if (driver) return `You're peaking. ${driver} is carrying it.`;
    return "You're peaking. Hold the line.";
  }
  if (p.label === "sharpening") {
    if (limiter) return `Trending up. ${limiter} is the next lever.`;
    return "Trending up. Small wins this week.";
  }
  if (p.label === "off_pace") {
    if (limiter) return `Drifting. ${limiter} is the brake.`;
    return "Drifting. Pick one component to fix this week.";
  }
  // at_risk
  if (limiter) return `At risk. ${limiter} needs attention now.`;
  return "At risk. Check the limiter and fix it first.";
}

export function FightFormInsightStrip(p: Props) {
  if (p.state === "no_camp" || p.state === "paused") {
    return (
      <p className="text-[12px] text-muted-foreground text-center mt-10 px-6 max-w-xs mx-auto leading-snug">
        {headlineFor(p)}
      </p>
    );
  }

  const headline = headlineFor(p);

  // When the strip carries diagnostic info (an applied cap, or a driver/
  // limiter once the score is unlocked) we surface a "Why?" tap target so
  // the user can pull up the full explanation sheet instead of guessing
  // what "Score capped — training load is spiking" actually means.
  const isTappable =
    !!p.onHeadlineTap &&
    (p.appliedCeiling != null || (p.state === "ok" && (p.topDriver != null || p.topLimiter != null)));

  return (
    <div className="mt-10 flex flex-col items-center gap-2.5">
      {isTappable ? (
        <button
          type="button"
          onClick={p.onHeadlineTap}
          className="block text-[11px] text-foreground/90 text-center px-6 max-w-sm leading-snug whitespace-pre-line active:opacity-70 transition-opacity"
          aria-label="Show explanation"
        >
          <span>{headline}</span>{" "}
          <span className="text-[11px] font-semibold text-primary underline underline-offset-2 decoration-primary/40 whitespace-nowrap">
            Why?
          </span>
        </button>
      ) : (
        <p className="text-[11px] text-foreground/90 text-center px-6 max-w-sm leading-snug whitespace-pre-line">
          {headline}
        </p>
      )}

      {p.state === "calibrating" && p.calibration && !p.calibration.unlocked && (() => {
        // Suppress the "Day N of N" chip during the cold-start case so the
        // "Fresh start" headline isn't immediately contradicted by a counter.
        const nothingLoggedToday =
          !p.adherence.sleep
          && !p.adherence.weight
          && !p.adherence.training
          && !p.adherence.wellnessCheckin;
        if (nothingLoggedToday) return null;
        return (
          <p className="text-[11px] text-muted-foreground tabular-nums">
            Day {Math.min(p.calibration.daysWithAnyLog, p.calibration.daysNeeded)} of {p.calibration.daysNeeded}
          </p>
        );
      })()}
    </div>
  );
}
