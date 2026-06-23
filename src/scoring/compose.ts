import type { FightFormScore, FightFormState, ScoringConfig, ScoringInputs, SubScore, SubScoreKey } from "./types";
import { computeTrainingLoad } from "./subScores/trainingLoad";
import { computeSleep } from "./subScores/sleep";
import { computeWeightCut } from "./subScores/weightCut";
import { computeWellness } from "./subScores/wellness";
import { computeNutritionAdherence } from "./subScores/nutritionAdherence";
import { resolvePhase, weightsForPhase } from "./phaseWeights";
import { applyCeilings, latchCeilings } from "./ceilings";
import { computeCampAge } from "./campAge";
import { lastLogDates, lastRealLogDates, staleDaysFor, decayFactor } from "./staleness";
import { completenessFor, rollUpConfidence } from "./confidence";
import { computeFormMomentum } from "./consistency";

function countDistinctDaysOfData(inputs: ScoringInputs): number {
  const days = new Set<string>();
  for (const x of [...inputs.sleepHours, ...inputs.weights, ...inputs.sessions, ...inputs.hooperByDate, ...inputs.meals]) {
    days.add(x.date);
  }
  return days.size;
}

function emaSmooth(rawToday: number, prior: Array<{ date: string; rawScore: number }>, days: number): number {
  if (prior.length === 0) return rawToday;
  const series = [...prior.sort((a, b) => a.date.localeCompare(b.date)).slice(-(days - 1)).map((p) => p.rawScore), rawToday];
  const alpha = 2 / (days + 1);
  let v = series[0];
  for (let i = 1; i < series.length; i++) v = alpha * series[i] + (1 - alpha) * v;
  return v;
}

function pickLabel(score: number, cfg: ScoringConfig): FightFormScore["label"] {
  const t = cfg.labelThresholds;
  if (score >= t.sharp) return "sharp";
  if (score >= t.sharpening) return "sharpening";
  if (score >= t.offPace) return "off_pace";
  return "at_risk";
}

function consecutiveDangerousDays(
  weights: Array<{ date: string; weightKg: number }>,
  startingWeightKg: number | null,
  campStartDate: string | null,
  cfg: ScoringConfig,
): number {
  if (!startingWeightKg || !campStartDate) return 0;
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return 0;
  let consecutive = 0;
  for (let i = sorted.length - 1; i > 0; i--) {
    const prior = sorted[i - 1];
    const cur = sorted[i];
    const days = (new Date(cur.date + "T00:00:00Z").getTime() - new Date(prior.date + "T00:00:00Z").getTime()) / 86400000;
    if (days <= 0) continue;
    const pctPerWeek = ((prior.weightKg - cur.weightKg) / startingWeightKg / (days / 7)) * 100;
    if (pctPerWeek > cfg.weightCut.dangerCeilingPct) consecutive++;
    else break;
  }
  return consecutive;
}

function sleepDebt7d(
  sleep: Array<{ date: string; hours: number }>,
  asOfDate: string,
  cfg: ScoringConfig,
): number {
  // Only count debt for nights that were actually logged. Missing nights
  // contribute zero, otherwise a user who hasn't backfilled a week of sleep
  // would always trip the `sleep_debt` ceiling. The per-night Max(0, …) keeps
  // 10h sleep nights from cancelling out a 4h night so accumulated debt is
  // a true sum of nightly shortfalls, not a net rolling balance.
  const end = new Date(asOfDate + "T00:00:00Z");
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const target = cfg.sleep.targetHoursPerNight;
  let debt = 0;
  for (const s of sleep) {
    const t = new Date(s.date + "T00:00:00Z").getTime();
    if (t >= start.getTime() && t <= end.getTime()) {
      debt += Math.max(0, target - s.hours);
    }
  }
  return debt;
}

function computeAcwr(sessions: ScoringInputs["sessions"], asOfDate: string, cfg: ScoringConfig): number {
  if (sessions.length === 0) return 0;
  const sumLoad = (windowDays: number) => {
    const end = new Date(asOfDate + "T00:00:00Z");
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (windowDays - 1));
    let total = 0;
    for (const s of sessions) {
      const t = new Date(s.date + "T00:00:00Z").getTime();
      if (t >= start.getTime() && t <= end.getTime()) total += s.rpe * s.durationMinutes;
    }
    return total / windowDays;
  };
  const acute = sumLoad(cfg.trainingLoad.acuteWindowDays);
  const chronic = sumLoad(cfg.trainingLoad.chronicWindowDays);
  if (chronic === 0) return acute > 0 ? 999 : 0;
  return acute / chronic;
}

/**
 * Cold-start guard inputs for the `training_spike` ceiling. Mirrors the
 * recovery engine's signals so that one logged session against an empty
 * 28-day window doesn't artificially cap the score.
 */
function computeAcuteLoadAbsolute(sessions: ScoringInputs["sessions"], asOfDate: string, cfg: ScoringConfig): number {
  const end = new Date(asOfDate + "T00:00:00Z");
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (cfg.trainingLoad.acuteWindowDays - 1));
  let total = 0;
  for (const s of sessions) {
    const t = new Date(s.date + "T00:00:00Z").getTime();
    if (t >= start.getTime() && t <= end.getTime()) total += s.rpe * s.durationMinutes;
  }
  return total;
}

function countTrainingDaysIn28d(sessions: ScoringInputs["sessions"], asOfDate: string, cfg: ScoringConfig): number {
  const end = new Date(asOfDate + "T00:00:00Z");
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (cfg.trainingLoad.chronicWindowDays - 1));
  const days = new Set<string>();
  for (const s of sessions) {
    const t = new Date(s.date + "T00:00:00Z").getTime();
    if (t >= start.getTime() && t <= end.getTime()) days.add(s.date);
  }
  return days.size;
}

function latestHooper(hooperByDate: ScoringInputs["hooperByDate"], asOfDate: string): number | null {
  const sorted = [...hooperByDate].sort((a, b) => a.date.localeCompare(b.date));
  let chosen: number | null = null;
  for (const h of sorted) {
    if (h.date <= asOfDate) chosen = h.hooper;
  }
  return chosen;
}

function emptySubScores(): FightFormScore["subScores"] {
  const empty = { value: 0, weight: 0, reason: "—" };
  return {
    trainingLoad: empty,
    sleep: empty,
    weightCut: empty,
    wellness: empty,
    nutritionAdherence: empty,
  };
}

export function computeFightFormScore(inputs: ScoringInputs, cfg: ScoringConfig): FightFormScore {
  if (inputs.isCampPaused) {
    return {
      score: 0, rawScore: 0, label: "off_pace", state: "paused", phase: null,
      campAge: null, subScores: emptySubScores(), topDriver: "weightCut",
      topLimiter: "weightCut", appliedCeiling: null, algorithmVersion: cfg.version,
      dataConfidence: 0, dataAgeDays: 0, activePillars: 0, totalPillars: 0,
      formMomentum: 0,
    };
  }
  if (!inputs.fightDate || !inputs.campStartDate) {
    return {
      score: 0, rawScore: 0, label: "off_pace", state: "no_camp", phase: null,
      campAge: null, subScores: emptySubScores(), topDriver: "weightCut",
      topLimiter: "weightCut", appliedCeiling: null, algorithmVersion: cfg.version,
      dataConfidence: 0, dataAgeDays: 0, activePillars: 0, totalPillars: 0,
      formMomentum: 0,
    };
  }

  // Post-fight: once the fight date passes, the camp is over. Surface as
  // "paused" so the dashboard stops asking the user to log against a dead
  // schedule. Without this, `resolvePhase` keeps returning `fightWeek`
  // weights forever and the score drifts on stale data.
  const daysToFight = (new Date(inputs.fightDate + "T00:00:00Z").getTime()
    - new Date(inputs.date + "T00:00:00Z").getTime()) / (1000 * 60 * 60 * 24);
  if (daysToFight < 0) {
    return {
      score: 0, rawScore: 0, label: "off_pace", state: "paused", phase: null,
      campAge: null, subScores: emptySubScores(), topDriver: "weightCut",
      topLimiter: "weightCut", appliedCeiling: null, algorithmVersion: cfg.version,
      dataConfidence: 0, dataAgeDays: 0, activePillars: 0, totalPillars: 0,
      formMomentum: 0,
    };
  }

  const daysOfData = countDistinctDaysOfData(inputs);
  if (daysOfData < cfg.coldStart.minDaysOfDataIn7d) {
    return {
      score: 0, rawScore: 0, label: "off_pace", state: "calibrating", phase: null,
      campAge: null, subScores: emptySubScores(), topDriver: "weightCut",
      topLimiter: "weightCut", appliedCeiling: null, algorithmVersion: cfg.version,
      dataConfidence: 0, dataAgeDays: 0, activePillars: 0, totalPillars: 0,
      formMomentum: 0,
    };
  }

  const phase = resolvePhase(inputs.date, inputs.fightDate, cfg);
  const weights = weightsForPhase(phase, cfg);

  const lastDates = lastLogDates(inputs);
  // Real log dates (excluding markedSkips) are used for the sub-score window
  // so that skips pause staleness without shifting the computation window.
  const realDates = lastRealLogDates(inputs);
  const neutral = cfg.staleness.neutral;

  // Compute a date-windowed pillar's raw sub-score AS OF a given date. Reading
  // a pillar at its last-logged date (rather than always at `inputs.date`)
  // lets a pillar that stopped being logged be read at its last-known state
  // and then decayed toward neutral over its full staleness horizon — instead
  // of vanishing the instant its data leaves the sub-score's own short window.
  const computeWindowedPillar = (
    key: SubScoreKey,
    asOf: string,
  ): { value: number; reason: string; meta?: SubScore["meta"] } => {
    switch (key) {
      case "trainingLoad":
        return computeTrainingLoad(inputs.sessions, asOf, cfg, inputs.restDays ?? []);
      case "sleep":
        return computeSleep(inputs.sleepHours, asOf, cfg, inputs.assumedSleepDates);
      case "weightCut":
        return computeWeightCut(
          {
            weights: inputs.weights,
            startingWeightKg: inputs.startingWeightKg,
            goalWeightKg: inputs.goalWeightKg,
            campStartDate: inputs.campStartDate,
            fightDate: inputs.fightDate,
            cutPlanJson: inputs.cutPlanJson as never,
          },
          asOf, cfg,
        );
      case "wellness":
        return computeWellness(inputs.hooperByDate, asOf, cfg);
      case "nutritionAdherence":
        return computeNutritionAdherence(inputs.meals, inputs.targets, asOf, cfg);
      default: {
        const _exhaustive: never = key;
        return _exhaustive;
      }
    }
  };

  // A pillar's own cold-start sentinel, read off its reason string (the
  // sub-scores signal "no usable data" via these reason prefixes).
  const hasDataFor = (key: SubScoreKey, reason: string): boolean => {
    switch (key) {
      case "trainingLoad": return !/^(Cold start)/.test(reason);
      case "sleep": return !/^(No sleep logs|Only \d+ night)/.test(reason);
      case "weightCut": return !/^(No weight logs yet|Camp data incomplete|No cut plan or weight data yet)/.test(reason);
      case "wellness": return reason !== "No wellness check-ins in 7 days";
      case "nutritionAdherence": return !/^(Only \d+|No calorie)/.test(reason);
    }
  };

  // Build a windowed pillar: read it at its last-log date, gate presence on
  // cold-start AND staleness horizon, then ease the value toward neutral by
  // the decay factor. Past the horizon (or never logged) → weight 0 (excluded).
  const buildWindowedPillar = (key: SubScoreKey, phaseWeight: number): SubScore => {
    const pCfg = cfg.staleness.byPillar[key];
    // Use the real (non-skip) date for sub-score computation so the window
    // reflects actual data; use lastDates (includes skips) for staleness so
    // a marked skip pauses decay without fabricating data.
    const asOf = realDates[key] ?? inputs.date;
    const sub = computeWindowedPillar(key, asOf);
    const hasData = hasDataFor(key, sub.reason);
    const sd = staleDaysFor(lastDates[key], inputs.date);
    const beyondHorizon = sd !== null && sd >= pCfg.horizonDays;
    const present = hasData && lastDates[key] !== null && !beyondHorizon;
    const weight = present ? phaseWeight : 0;
    const d = sd === null ? 0 : decayFactor(sd, pCfg);
    const value = weight > 0 ? sub.value * (1 - d) + neutral * d : sub.value;
    return {
      value,
      weight,
      reason: sub.reason,
      meta: sub.meta,
      completeness: weight > 0 ? completenessFor(sd, pCfg) : 0,
    };
  };

  // The self-reported wellness (Hooper) survey is the sole recovery-dimension
  // driver. It carries its full phase weight whenever it has data;
  // `buildWindowedPillar` zeroes the weight internally on cold start / stale.
  const subScores: FightFormScore["subScores"] = {
    trainingLoad: buildWindowedPillar("trainingLoad", weights.trainingLoad),
    sleep: buildWindowedPillar("sleep", weights.sleep),
    weightCut: buildWindowedPillar("weightCut", weights.weightCut),
    wellness: buildWindowedPillar("wellness", weights.wellness),
    nutritionAdherence: buildWindowedPillar("nutritionAdherence", weights.nutritionAdherence),
  };

  // Composite redistribution on missing data: divide only by present weights.
  const subScoreList = Object.values(subScores);
  const present = subScoreList.filter((s) => s.weight > 0);
  const totalPresentWeight = present.reduce((a, s) => a + s.weight, 0);
  const rawScore = totalPresentWeight > 0
    ? present.reduce((a, s) => a + s.value * s.weight, 0) / Math.max(1e-9, totalPresentWeight)
    : 50; // every sub-score absent — neutral placeholder; ceilings still run.

  // Confidence + staleness summary fields.
  const dataConfidence = rollUpConfidence(
    (Object.keys(subScores) as SubScoreKey[]).map((k) => ({
      weight: subScores[k].weight,
      completeness: subScores[k].completeness ?? 0,
    })),
  );
  const activePillars = present.length;
  // Pillars eligible this phase (weight defined > 0).
  const phaseKeys = (Object.keys(weights) as SubScoreKey[]).filter((k) => weights[k] > 0);
  const totalPillars = phaseKeys.length;
  const dataAgeDays = (Object.keys(subScores) as SubScoreKey[])
    .filter((k) => subScores[k].weight > 0)
    .reduce((max, k) => Math.max(max, staleDaysFor(lastDates[k], inputs.date) ?? 0), 0);

  // Consistency reward — added to the raw composite BEFORE ceilings so safety
  // caps and latching still override it. Rewards sustained all-pillar strength.
  const formMomentum = computeFormMomentum({
    priorRawScores: inputs.priorRawScores,
    rawScore,
    activePillars,
    totalPillars,
    dataConfidence,
    cfg,
  });
  const boostedRaw = Math.min(100, rawScore + formMomentum);

  const ceil = applyCeilings(boostedRaw, {
    weightCutDangerousDays: consecutiveDangerousDays(inputs.weights, inputs.startingWeightKg, inputs.campStartDate, cfg),
    sleepDebt7d: sleepDebt7d(inputs.sleepHours, inputs.date, cfg),
    acwr: computeAcwr(inputs.sessions, inputs.date, cfg),
    trainingDaysIn28d: countTrainingDaysIn28d(inputs.sessions, inputs.date, cfg),
    acuteLoad: computeAcuteLoadAbsolute(inputs.sessions, inputs.date, cfg),
    latestHooper: latestHooper(inputs.hooperByDate, inputs.date),
  }, cfg);

  // Anti-gaming: latch a recently-fired ceiling that live signals no longer
  // trigger when the governing pillar is stale (escape-by-not-logging).
  const latched = latchCeilings(ceil, {
    asOfDate: inputs.date,
    priorCeilings: inputs.priorCeilings ?? [],
    staleDaysByRule: {
      // realDates (skip-excluded): a marked skip must NOT release a safety cap — only real recovered data can.
      sleep_debt: staleDaysFor(realDates.sleep, inputs.date),
      weight_cut_dangerous: staleDaysFor(realDates.weightCut, inputs.date),
      training_spike: staleDaysFor(realDates.trainingLoad, inputs.date),
    },
  }, cfg);

  const displayed = emaSmooth(latched.score, inputs.priorRawScores, cfg.smoothing.emaDays);
  const finalScore = Math.round(Math.max(0, Math.min(100, displayed)));

  const lowConfidence = dataConfidence < cfg.confidence.labelCapThreshold;
  let label = pickLabel(finalScore, cfg);
  if (lowConfidence && label === "sharp") label = "sharpening";
  const state: FightFormState = lowConfidence ? "stale" : "ok";

  const contributions = (Object.keys(subScores) as SubScoreKey[]).map((k) => ({
    key: k, contribution: subScores[k].value * subScores[k].weight,
  }));
  const sorted = [...contributions].sort((a, b) => b.contribution - a.contribution);
  const topDriver = sorted[0].key;
  const topLimiter = sorted[sorted.length - 1].key;

  return {
    score: finalScore,
    rawScore: Math.round(latched.score),
    label,
    state,
    phase,
    campAge: computeCampAge({
      campStartDate: inputs.campStartDate,
      fightDate: inputs.fightDate,
      asOfDate: inputs.date,
      startingWeightKg: inputs.startingWeightKg,
      goalWeightKg: inputs.goalWeightKg,
      currentWeightKg: inputs.currentWeightKg,
    }, cfg),
    subScores,
    topDriver,
    topLimiter,
    appliedCeiling: latched.applied,
    algorithmVersion: cfg.version,
    dataConfidence,
    dataAgeDays,
    activePillars,
    totalPillars,
    formMomentum,
  };
}
