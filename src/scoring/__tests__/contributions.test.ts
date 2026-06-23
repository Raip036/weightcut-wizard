import { describe, it, expect } from "vitest";
import { computeContributions } from "../contributions";
import type { SubScore, SubScoreKey } from "../types";

const sub = (value: number, weight: number): SubScore => ({
  value,
  weight,
  reason: "—",
});

describe("computeContributions", () => {
  it("decomposes a full fixture: contributions sum to rawScore, sorted desc, weightCut first", () => {
    const subScores: Record<SubScoreKey, SubScore> = {
      weightCut: sub(70, 0.3),
      sleep: sub(64, 0.25),
      trainingLoad: sub(73, 0.15),
      wellness: sub(60, 0.15),
      nutritionAdherence: sub(40, 0.15),
    };

    const result = computeContributions(subScores, "build");

    // All five pillars active.
    expect(result.pillars).toHaveLength(5);
    expect(result.totalActiveWeight).toBeCloseTo(1.0, 9);

    // Sorted descending by contributionPts; weightCut (highest value×weight) first.
    expect(result.pillars[0].key).toBe("weightCut");
    const ptsDesc = result.pillars.map((p) => p.contributionPts);
    for (let i = 1; i < ptsDesc.length; i++) {
      expect(ptsDesc[i]).toBeLessThanOrEqual(ptsDesc[i - 1]);
    }

    // Contributions sum to rawScore (the engine's Σ(v×w)/Σw composite).
    const sumPts = result.pillars.reduce((a, p) => a + p.contributionPts, 0);
    expect(result.rawScore).toBe(Math.round(sumPts));

    // Cross-check rawScore against the engine's own formula.
    const engineRaw = Math.round(
      (70 * 0.3 + 64 * 0.25 + 73 * 0.15 + 60 * 0.15 + 40 * 0.15) / 1.0,
    );
    expect(result.rawScore).toBe(engineRaw);

    // effectiveWeightPct reflects share of active weight.
    const weightCut = result.pillars.find((p) => p.key === "weightCut")!;
    expect(weightCut.effectiveWeightPct).toBe(30);
  });

  it("wellness is the sole recovery-dimension pillar", () => {
    const subScores: Record<SubScoreKey, SubScore> = {
      weightCut: sub(70, 0.3),
      sleep: sub(64, 0.25),
      trainingLoad: sub(73, 0.15),
      wellness: sub(60, 0.15),
      nutritionAdherence: sub(40, 0.15),
    };

    const result = computeContributions(subScores);

    // wellness carries the recovery dimension directly.
    const wellness = result.pillars.find((p) => p.key === "wellness")!;
    expect(wellness.value).toBe(60);
    expect(wellness.weight).toBeCloseTo(0.15, 9);
    expect(result.inactive).toHaveLength(0);
  });

  it("lists missing canonical display keys as inactive", () => {
    const subScores: Record<string, SubScore> = {
      weightCut: sub(70, 0.5),
      sleep: sub(60, 0.5),
    };

    const result = computeContributions(subScores);

    expect(result.pillars).toHaveLength(2);
    expect(result.inactive.sort()).toEqual(
      ["nutritionAdherence", "trainingLoad", "wellness"].sort(),
    );
  });

  it("returns the zero shape for null/undefined/empty input without throwing", () => {
    const allInactive: SubScoreKey[] = [
      "trainingLoad",
      "sleep",
      "weightCut",
      "wellness",
      "nutritionAdherence",
    ];

    for (const input of [null, undefined, {}]) {
      const result = computeContributions(input as never);
      expect(result.pillars).toEqual([]);
      expect(result.rawScore).toBe(0);
      expect(result.totalActiveWeight).toBe(0);
      expect(result.inactive.sort()).toEqual([...allInactive].sort());
    }
  });

  it("returns the zero shape when every present pillar has weight 0", () => {
    const subScores: Record<SubScoreKey, SubScore> = {
      weightCut: sub(70, 0),
      sleep: sub(64, 0),
      trainingLoad: sub(73, 0),
      wellness: sub(60, 0),
      nutritionAdherence: sub(40, 0),
    };

    const result = computeContributions(subScores);
    expect(result.pillars).toEqual([]);
    expect(result.rawScore).toBe(0);
    expect(result.totalActiveWeight).toBe(0);
    // 5 display pillars.
    expect(result.inactive).toHaveLength(5);
  });

  it("tie-breaks equal contributions by key alphabetical for determinism", () => {
    // sleep and weightCut produce identical contributionPts (60 × 0.5 each).
    const subScores: Record<string, SubScore> = {
      weightCut: sub(60, 0.5),
      sleep: sub(60, 0.5),
    };
    const result = computeContributions(subScores);
    expect(result.pillars.map((p) => p.key)).toEqual(["sleep", "weightCut"]);
  });
});
