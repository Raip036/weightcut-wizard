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
  wellness: "Recovery",
  nutrition: "Meals",
};

const SUBSCORE_HUMAN: Record<SubScoreKey, string> = {
  trainingLoad: "Training load",
  sleep: "Sleep",
  weightCut: "Weight cut",
  wellness: "Recovery",
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

  // state === "stale"
  if (p.state === "stale") {
    const limiter = p.topLimiter ? SUBSCORE_HUMAN[p.topLimiter] : null;
    if (p.appliedCeiling) {
      return limiter
        ? `Score capped and running on older data. Log ${limiter.toLowerCase()} to refresh.`
        : "Score capped and running on older data. Log today to refresh it.";
    }
    return limiter
      ? `Score is based on older data. Log ${limiter.toLowerCase()} to refresh it.`
      : "Score is based on older data. Log today to refresh it.";
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
  // Paused renders nothing (no "Camp is paused" copy) — post-fight the camp
  // keeps running, and an explicit pause is surfaced elsewhere.
  if (p.state === "paused") return null;

  if (p.state === "no_camp") {
    return (
      <p className="text-[12px] text-muted-foreground text-center mt-10 px-6 max-w-xs mx-auto leading-snug">
        {headlineFor(p)}
      </p>
    );
  }

  // Cold-start: nothing logged today yet. Render nothing rather than a
  // welcome/countdown line under the ring.
  const nothingLoggedToday =
    !p.adherence.sleep
    && !p.adherence.weight
    && !p.adherence.training
    && !p.adherence.wellnessCheckin;
  if (nothingLoggedToday) return null;

  const headline = headlineFor(p);

  // Calibrating (with something already logged) → present the countdown copy
  // and the day counter inside translucent pill cards, the same UI family as
  // the unlocked delta banner, instead of bare text floating under the ring.
  if (p.state === "calibrating" && p.calibration && !p.calibration.unlocked) {
    const dayN = Math.min(p.calibration.daysWithAnyLog, p.calibration.daysNeeded);
    return (
      <div className="mt-10 flex flex-col items-center gap-2.5">
        <div className="mx-auto w-fit max-w-sm rounded-2xl border border-border/40 bg-foreground/[0.03] px-3.5 py-2 backdrop-blur-sm">
          <p className="text-[11px] text-foreground/90 text-center leading-snug whitespace-pre-line">
            {headline}
          </p>
        </div>
        <div className="mx-auto w-fit flex items-center gap-1.5 rounded-full border border-border/40 bg-foreground/[0.03] px-2.5 py-1 backdrop-blur-sm">
          <span className="text-[11.5px] font-medium leading-snug text-muted-foreground tabular-nums tracking-tight">
            Day {dayN} of {p.calibration.daysNeeded}
          </span>
        </div>
      </div>
    );
  }

  // Scored states (ok / stale) used to render the insight headline here
  // ("You're peaking…", "At risk. Nutrition needs attention now. Why?", "Score
  // capped…", etc.). That headline is intentionally removed — the ring's own
  // label and the delta pill below already carry the read, so no text sits
  // under the ring for a scored camp.
  return null;
}
