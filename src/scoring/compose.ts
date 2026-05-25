import type { FightFormScore, ScoringConfig, ScoringInputs, ScoringInputSources, SubScoreKey } from "./types";
import { computeTrainingLoad } from "./subScores/trainingLoad";
import { computeSleep } from "./subScores/sleep";
import { computeWeightCut } from "./subScores/weightCut";
import { computeWellness } from "./subScores/wellness";
import { computeNutritionAdherence } from "./subScores/nutritionAdherence";
import { computeRecovery } from "./subScores/recovery";
import { resolvePhase, weightsForPhase } from "./phaseWeights";
import { applyCeilings } from "./ceilings";
import { computeCampAge } from "./campAge";

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
    if (pctPerWeek > cfg.weightCut.dangerEdgePct) consecutive++;
    else break;
  }
  return consecutive;
}

function sleepDebt7d(
  sleep: Array<{ date: string; hours: number }>,
  asOfDate: string,
  cfg: ScoringConfig,
): number {
  const end = new Date(asOfDate + "T00:00:00Z");
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  let total = 0;
  for (const s of sleep) {
    const t = new Date(s.date + "T00:00:00Z").getTime();
    if (t >= start.getTime() && t <= end.getTime()) total += s.hours;
  }
  return Math.max(0, 7 * cfg.sleep.targetHoursPerNight - total);
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
    recovery: empty,
  };
}

/**
 * Build the `inputSources` surface for the engine output. When
 * `inputs.sources` was populated (Convex call path), pass it straight
 * through. When absent (legacy tests, ad-hoc callers), derive a
 * `'manual'`-everywhere fallback from the inputs themselves so the field
 * is never undefined on the output.
 */
function resolveInputSources(inputs: ScoringInputs): ScoringInputSources {
  if (inputs.sources) return inputs.sources;
  const sleepHoursByDate: Record<string, "healthkit" | "manual"> = {};
  for (const s of inputs.sleepHours) sleepHoursByDate[s.date] = "manual";
  const weightsByDate: Record<string, "healthkit" | "manual"> = {};
  for (const w of inputs.weights) weightsByDate[w.date] = "manual";
  const sortedWeights = [...inputs.weights].sort((a, b) => a.date.localeCompare(b.date));
  const weightLatest = sortedWeights.length > 0 ? "manual" : null;
  const sleepHoursTargetDate = inputs.sleepHours.some((s) => s.date === inputs.date)
    ? "manual"
    : null;
  return { sleepHoursByDate, weightsByDate, weightLatest, sleepHoursTargetDate };
}

export function computeFightFormScore(inputs: ScoringInputs, cfg: ScoringConfig): FightFormScore {
  const inputSources = resolveInputSources(inputs);
  if (inputs.isCampPaused) {
    return {
      score: 0, rawScore: 0, label: "off_pace", state: "paused", phase: null,
      campAge: null, subScores: emptySubScores(), topDriver: "weightCut",
      topLimiter: "weightCut", appliedCeiling: null, algorithmVersion: cfg.version,
      recoveryConfidence: 0, inputSources,
    };
  }
  if (!inputs.fightDate || !inputs.campStartDate) {
    return {
      score: 0, rawScore: 0, label: "off_pace", state: "no_camp", phase: null,
      campAge: null, subScores: emptySubScores(), topDriver: "weightCut",
      topLimiter: "weightCut", appliedCeiling: null, algorithmVersion: cfg.version,
      recoveryConfidence: 0, inputSources,
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
      recoveryConfidence: 0, inputSources,
    };
  }

  const daysOfData = countDistinctDaysOfData(inputs);
  if (daysOfData < cfg.coldStart.minDaysOfDataIn7d) {
    return {
      score: 0, rawScore: 0, label: "off_pace", state: "calibrating", phase: null,
      campAge: null, subScores: emptySubScores(), topDriver: "weightCut",
      topLimiter: "weightCut", appliedCeiling: null, algorithmVersion: cfg.version,
      recoveryConfidence: 0, inputSources,
    };
  }

  const phase = resolvePhase(inputs.date, inputs.fightDate, cfg);
  const weights = weightsForPhase(phase, cfg);

  const trainingLoad = computeTrainingLoad(inputs.sessions, inputs.date, cfg, inputs.restDays ?? []);
  const sleep = computeSleep(inputs.sleepHours, inputs.date, cfg, inputs.assumedSleepDates);
  const weightCut = computeWeightCut(
    { weights: inputs.weights, startingWeightKg: inputs.startingWeightKg, goalWeightKg: inputs.goalWeightKg, campStartDate: inputs.campStartDate, fightDate: inputs.fightDate },
    inputs.date, cfg,
  );
  const wellness = computeWellness(inputs.hooperByDate, inputs.date, cfg);
  const nutritionAdherence = computeNutritionAdherence(inputs.meals, inputs.targets, inputs.date, cfg);

  // Fix #1 — capture "no data" signal from each sub-score BEFORE compose.ts
  // overrides their `weight` with the phase weight. Sub-scores returning
  // `value: 50, weight: 0` use that as a sentinel for "missing data, skip
  // me." We then assign the phase weight only when the sub-score had data;
  // otherwise we keep weight:0 and the redistributor excludes it from the
  // composite denominator.
  const subScoreHasData = {
    trainingLoad: !/^(Cold start)/.test(trainingLoad.reason),
    sleep: !/^(No sleep logs|Only \d+ night)/.test(sleep.reason),
    weightCut: !/^(No weight logs yet|Camp data incomplete)/.test(weightCut.reason),
    wellness: wellness.reason !== "No wellness check-ins in 7 days",
    nutritionAdherence: !/^(Only \d+ day|No calorie\/protein)/.test(nutritionAdherence.reason),
  };
  const recovery = computeRecovery(
    inputs.healthSignals ?? null,
    inputs.selfReportRecovery ?? null,
    cfg,
  );

  // When HealthKit signals are present and contribute (confidence > 0),
  // hand the wellness slot's weight over to recovery. Recovery already
  // folds the self-report soreness/energy back in, so we don't double-count.
  // When healthSignals is null/missing OR every signal is absent, wellness
  // keeps its weight and recovery stays at 0 — the composite is byte-for-byte
  // identical to the pre-HealthKit engine.
  const recoveryHasSignal = (inputs.healthSignals ?? null) !== null && recovery.confidence > 0;
  const wellnessWeight = recoveryHasSignal ? 0 : weights.wellness;
  const recoveryWeight = recoveryHasSignal ? weights.wellness : 0;

  const subScores: FightFormScore["subScores"] = {
    trainingLoad: { ...trainingLoad, weight: subScoreHasData.trainingLoad ? weights.trainingLoad : 0 },
    sleep: { ...sleep, weight: subScoreHasData.sleep ? weights.sleep : 0 },
    weightCut: { ...weightCut, weight: subScoreHasData.weightCut ? weights.weightCut : 0 },
    wellness: { ...wellness, weight: subScoreHasData.wellness ? wellnessWeight : 0 },
    nutritionAdherence: { ...nutritionAdherence, weight: subScoreHasData.nutritionAdherence ? weights.nutritionAdherence : 0 },
    recovery: {
      value: recovery.value,
      weight: recoveryWeight,
      reason: recovery.reason,
    },
  };

  // Fix #1 — composite redistribution on missing data.
  // Sub-scores that lack data return `weight: 0` (trainingLoad < 3 sessions,
  // sleep < 3 nights, nutrition < 3 logged days, wellness no Hooper, recovery
  // no HealthKit). Including them in the denominator would silently bottom
  // out the composite even when other sub-scores are healthy. Divide only by
  // the sum of weights for sub-scores that actually contributed.
  const subScoreList = Object.values(subScores);
  const present = subScoreList.filter((s) => s.weight > 0);
  const totalPresentWeight = present.reduce((a, s) => a + s.weight, 0);
  const rawScore = totalPresentWeight > 0
    ? present.reduce((a, s) => a + s.value * s.weight, 0) / Math.max(1e-9, totalPresentWeight)
    : 50; // every sub-score absent — neutral placeholder; ceilings still run.

  const ceil = applyCeilings(rawScore, {
    weightCutDangerousDays: consecutiveDangerousDays(inputs.weights, inputs.startingWeightKg, inputs.campStartDate, cfg),
    sleepDebt7d: sleepDebt7d(inputs.sleepHours, inputs.date, cfg),
    acwr: computeAcwr(inputs.sessions, inputs.date, cfg),
    trainingDaysIn28d: countTrainingDaysIn28d(inputs.sessions, inputs.date, cfg),
    acuteLoad: computeAcuteLoadAbsolute(inputs.sessions, inputs.date, cfg),
    latestHooper: latestHooper(inputs.hooperByDate, inputs.date),
  }, cfg);

  const displayed = emaSmooth(ceil.score, inputs.priorRawScores, cfg.smoothing.emaDays);
  const finalScore = Math.round(Math.max(0, Math.min(100, displayed)));

  const contributions = (Object.keys(subScores) as SubScoreKey[]).map((k) => ({
    key: k, contribution: subScores[k].value * subScores[k].weight,
  }));
  const sorted = [...contributions].sort((a, b) => b.contribution - a.contribution);
  const topDriver = sorted[0].key;
  const topLimiter = sorted[sorted.length - 1].key;

  return {
    score: finalScore,
    rawScore: Math.round(ceil.score),
    label: pickLabel(finalScore, cfg),
    state: "ok",
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
    appliedCeiling: ceil.applied,
    algorithmVersion: cfg.version,
    recoveryConfidence: recovery.confidence,
    inputSources,
  };
}
