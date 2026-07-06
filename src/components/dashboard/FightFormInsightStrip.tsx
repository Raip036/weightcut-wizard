import { useNavigate } from "react-router-dom";
import { triggerHapticSelection } from "@/lib/haptics";
import { track, EVENTS } from "@/lib/analytics";
import type { FightFormLabel, FightFormState, ScoringPhase, SubScore, SubScoreKey } from "@/scoring/types";

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
  /** Largest staleness gap (days since last log) across contributing
   *  pillars — same field the ring's "as of Nd ago" line and the old
   *  standalone "Holding at N" pill both read from. */
  dataAgeDays?: number;
  /** Per-pillar sub-scores (for `completeness`), used to name the stalest
   *  contributing pillar the same way the old "Holding at N" pill did. */
  subScores?: Record<SubScoreKey, SubScore> | null;
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

// Threshold (days since last log) above which contributing data counts as
// stale. Matches the ring's own "as of Nd ago" line and the old standalone
// "Holding at N" pill (both used `dataAgeDays >= 2`), so the two never
// disagree about when data has gone stale.
const STALE_THRESHOLD_DAYS = 2;

type RouteInfo = { cause: string; route: string };

// Where tapping the "X is holding your score back" line should send you.
// `weightCut` goes to the cut plan (the fix is reviewing/adjusting the
// plan), distinct from `STALE_ROUTE.weightCut` below which is about the raw
// weight log itself.
const LIMITER_ROUTE: Record<SubScoreKey, RouteInfo> = {
  nutritionAdherence: { cause: "nutrition", route: "/nutrition" },
  weightCut: { cause: "weight-cut", route: "/cut-plan" },
  wellness: { cause: "recovery", route: "/recovery/check-in" },
  sleep: { cause: "sleep", route: "/sleep" },
  trainingLoad: { cause: "training", route: "/training-calendar" },
};

// Where tapping the "Running on Nd old data" line should send you — the fix
// is to log fresh data for that pillar, so weightCut here means "go log
// your weight" rather than "go review the cut plan".
const STALE_ROUTE: Record<SubScoreKey, RouteInfo> = {
  nutritionAdherence: { cause: "nutrition", route: "/nutrition" },
  weightCut: { cause: "stale-weight", route: "/weight" },
  wellness: { cause: "wellness", route: "/recovery/check-in" },
  sleep: { cause: "sleep", route: "/sleep" },
  trainingLoad: { cause: "training", route: "/training-calendar" },
};

const LIMITER_ACTION: Record<SubScoreKey, string> = {
  nutritionAdherence: "log a meal",
  weightCut: "review your plan",
  wellness: "complete your check-in",
  sleep: "log last night's sleep",
  trainingLoad: "log today's session",
};

const STALE_ACTION: Record<SubScoreKey, string> = {
  nutritionAdherence: "log a meal",
  weightCut: "log your weight",
  wellness: "log your check-in",
  sleep: "log last night's sleep",
  trainingLoad: "log today's session",
};

const STALE_NOUN: Record<SubScoreKey, string> = {
  nutritionAdherence: "nutrition",
  weightCut: "weight",
  wellness: "recovery",
  sleep: "sleep",
  trainingLoad: "training",
};

const CEILING_COPY: Record<string, { reason: string; action: string } & RouteInfo> = {
  weight_cut_dangerous: {
    reason: "cut too aggressive this week",
    action: "review your plan",
    cause: "cut",
    route: "/cut-plan",
  },
  sleep_debt: {
    reason: "sleep debt is piling up",
    action: "log sleep to catch up",
    cause: "sleep",
    route: "/sleep",
  },
  training_spike: {
    reason: "training load is spiking",
    action: "ease up this week",
    cause: "training",
    route: "/training-calendar",
  },
};

type Prescription = { text: string; cause: string; route: string | null };

// Same "stalest contributing pillar" logic the old "Holding at N" pill used:
// lowest `completeness` among pillars that actually carry weight this phase.
function findStalestPillar(subScores?: Record<SubScoreKey, SubScore> | null): SubScoreKey | null {
  if (!subScores) return null;
  let laggard: SubScoreKey | null = null;
  let lowest = Infinity;
  for (const [key, s] of Object.entries(subScores) as [SubScoreKey, SubScore][]) {
    if (!s || s.weight <= 0) continue;
    const c = s.completeness ?? 1;
    if (c < lowest) {
      lowest = c;
      laggard = key;
    }
  }
  return laggard;
}

// Decides the single tappable line under the ring, in priority order:
// applied ceiling > top limiter > stale data > positive driver. The "sharp"
// label skips the limiter branch (that copy is reserved for camps that
// actually need a fix), so a genuinely peaking camp falls through to the
// staleness check and, failing that, a positive driver line instead of
// nagging about whichever pillar happens to be relatively lowest.
function computePrescription(p: Props): Prescription | null {
  if (p.appliedCeiling) {
    const copy = CEILING_COPY[p.appliedCeiling.ruleId];
    if (copy) {
      return {
        text: `Score capped: ${copy.reason}, ${copy.action}.`,
        cause: copy.cause,
        route: copy.route,
      };
    }
    return {
      text: `Score capped at ${p.appliedCeiling.cap}, review your plan.`,
      cause: "cut",
      route: "/cut-plan",
    };
  }

  if (p.label !== "sharp" && p.topLimiter) {
    const pillar = p.topLimiter;
    return {
      text: `${SUBSCORE_HUMAN[pillar]} is holding your score back, ${LIMITER_ACTION[pillar]}.`,
      cause: LIMITER_ROUTE[pillar].cause,
      route: LIMITER_ROUTE[pillar].route,
    };
  }

  const dataAgeDays = p.dataAgeDays ?? 0;
  if (dataAgeDays >= STALE_THRESHOLD_DAYS) {
    const laggard = findStalestPillar(p.subScores);
    const days = Math.round(dataAgeDays);
    if (laggard) {
      return {
        text: `Running on ${days} day old ${STALE_NOUN[laggard]} data, ${STALE_ACTION[laggard]} to refresh.`,
        cause: STALE_ROUTE[laggard].cause,
        route: STALE_ROUTE[laggard].route,
      };
    }
    return {
      text: `Running on ${days} day old data, log today to refresh.`,
      cause: "stale",
      route: null,
    };
  }

  if (p.topDriver) {
    return {
      text: `${SUBSCORE_HUMAN[p.topDriver]} is carrying your score today.`,
      cause: "driver",
      route: null,
    };
  }

  // Strong score, every pillar fresh, nothing to single out — say nothing.
  return null;
}

export function FightFormInsightStrip(p: Props) {
  const navigate = useNavigate();

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

  // Calibrating (with something already logged) → the ring itself already shows
  // the "Day X of Y" counter + countdown, so render nothing here. (The old
  // standalone day-counter pill duplicated the ring and has been removed.)
  if (p.state === "calibrating" && p.calibration && !p.calibration.unlocked) {
    return null;
  }

  // Scored states (ok / stale): a single tappable prescription line — what's
  // capping/limiting the score, a truthful "data is stale" read, or (only
  // when there's genuinely nothing to flag) a short positive note. Ranked by
  // `computePrescription`; falls through to nothing for a strong, fresh camp.
  const prescription = computePrescription(p);
  if (!prescription) return null;

  const handleTap = () => {
    triggerHapticSelection();
    track(EVENTS.FEATURE_OPENED, { feature: "ring_prescription", cause: prescription.cause });
    if (prescription.route) {
      navigate(prescription.route);
    } else {
      p.onHeadlineTap?.();
    }
  };

  return (
    <button
      type="button"
      onClick={handleTap}
      aria-label="Fight Form Score details"
      className="mt-2 w-full max-w-xs mx-auto px-6 py-1 rounded-xl text-center card-press"
    >
      <span className="text-[12px] font-medium text-muted-foreground leading-snug">
        {prescription.text}
      </span>
    </button>
  );
}
