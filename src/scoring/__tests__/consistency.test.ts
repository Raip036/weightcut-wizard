import { describe, it, expect } from "vitest";
import { computeFormMomentum } from "../consistency";
import { ScoringConfigV1 } from "../config/v1";

const cfg = ScoringConfigV1; // maxBonus 5, lookbackDays 5, minRawForBonus 75, fullBonusMean 92

describe("computeFormMomentum", () => {
  it("is 0 when fewer than lookbackDays prior scores exist", () => {
    const m = computeFormMomentum({
      priorRawScores: [{ date: "2026-04-30", rawScore: 95 }],
      rawScore: 95, activePillars: 5, totalPillars: 5, dataConfidence: 1, cfg,
    });
    expect(m).toBe(0);
  });

  it("is 0 when not all eligible pillars are present", () => {
    const priors = Array.from({ length: 5 }, (_, i) => ({ date: `2026-04-2${i}`, rawScore: 95 }));
    const m = computeFormMomentum({
      priorRawScores: priors, rawScore: 95, activePillars: 4, totalPillars: 5, dataConfidence: 1, cfg,
    });
    expect(m).toBe(0);
  });

  it("is 0 when today's rawScore is below minRawForBonus", () => {
    const priors = Array.from({ length: 5 }, (_, i) => ({ date: `2026-04-2${i}`, rawScore: 95 }));
    const m = computeFormMomentum({
      priorRawScores: priors, rawScore: 70, activePillars: 5, totalPillars: 5, dataConfidence: 1, cfg,
    });
    expect(m).toBe(0);
  });

  it("scales from 0 at minRawForBonus mean to maxBonus at fullBonusMean", () => {
    const at75 = Array.from({ length: 5 }, (_, i) => ({ date: `2026-04-2${i}`, rawScore: 75 }));
    const at92 = Array.from({ length: 5 }, (_, i) => ({ date: `2026-04-2${i}`, rawScore: 92 }));
    const mLow = computeFormMomentum({ priorRawScores: at75, rawScore: 80, activePillars: 5, totalPillars: 5, dataConfidence: 1, cfg });
    const mHigh = computeFormMomentum({ priorRawScores: at92, rawScore: 95, activePillars: 5, totalPillars: 5, dataConfidence: 1, cfg });
    expect(mLow).toBeCloseTo(0, 5);
    expect(mHigh).toBeCloseTo(5, 5);
  });

  it("uses only the most recent lookbackDays scores for the mean", () => {
    const priors = [
      ...Array.from({ length: 4 }, (_, i) => ({ date: `2026-04-0${i + 1}`, rawScore: 10 })),
      ...Array.from({ length: 5 }, (_, i) => ({ date: `2026-04-1${i + 1}`, rawScore: 92 })),
    ];
    const m = computeFormMomentum({ priorRawScores: priors, rawScore: 95, activePillars: 5, totalPillars: 5, dataConfidence: 1, cfg });
    expect(m).toBeCloseTo(5, 5);
  });

  it("is scaled down by low data confidence", () => {
    const priors = Array.from({ length: 5 }, (_, i) => ({ date: `2026-04-2${i}`, rawScore: 92 }));
    const m = computeFormMomentum({ priorRawScores: priors, rawScore: 95, activePillars: 5, totalPillars: 5, dataConfidence: 0.5, cfg });
    expect(m).toBeCloseTo(2.5, 5);
  });
});
