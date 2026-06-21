import { describe, it, expect } from "vitest";
import { pillarAdvice } from "../pillarAdvice";
import { SUBSCORE_ORDER } from "../constants";
import type { SubScore, SubScoreKey } from "@/scoring/types";

/**
 * Unit tests for the pure `pillarAdvice` advice module.
 *
 * The module maps a sub-score (value band + reason + meta) to a one-line
 * headline and 1-3 concrete actions. These assertions pin the behaviour the
 * sheet relies on: weightCut surfaces real meta deltas, healthy pillars
 * affirm + "maintain", and every pillar always yields at least one action.
 */

function stub(over: Partial<SubScore> = {}): SubScore {
  return { value: 50, weight: 1, reason: "", ...over };
}

describe("pillarAdvice", () => {
  it("weightCut behind plan surfaces the meta delta and concrete actions", () => {
    const advice = pillarAdvice(
      "weightCut",
      stub({
        value: 40,
        reason: "0.8 kg behind this week's 76.0 kg target",
        meta: { targetKg: 76.0, currentKg: 76.8, deltaKg: 0.8, weekNumber: 3 },
      }),
    );
    expect(advice.headline.toLowerCase()).toMatch(/behind|target/);
    expect(advice.headline).toContain("0.8");
    expect(advice.actions.length).toBeGreaterThan(0);
  });

  it("weightCut cutting too fast warns about easing the cut", () => {
    const advice = pillarAdvice(
      "weightCut",
      stub({
        value: 30,
        reason: "Cutting faster than plan (0.9 kg under), risk of muscle loss",
        meta: { targetKg: 76.0, currentKg: 75.1, deltaKg: -0.9, weekNumber: 3 },
      }),
    );
    expect(advice.headline.toLowerCase()).toMatch(/under|muscle|easing/);
    expect(advice.actions.length).toBeGreaterThan(0);
  });

  it("a high-value pillar yields an affirming maintain-style action", () => {
    const advice = pillarAdvice("sleep", stub({ value: 90, reason: "Sleep on track (avg 8.0h)" }));
    expect(advice.actions).toHaveLength(1);
    expect(advice.actions[0].label.toLowerCase()).toContain("maintain");
  });

  it("trainingLoad with high ACWR tells the user to drop a session", () => {
    const advice = pillarAdvice(
      "trainingLoad",
      stub({ value: 45, reason: "ACWR 1.85 (sweet spot 0.7-1.4)" }),
    );
    expect(advice.actions.some((a) => a.label.toLowerCase().includes("drop"))).toBe(true);
  });

  it("trainingLoad with low ACWR tells the user to add a session", () => {
    const advice = pillarAdvice(
      "trainingLoad",
      stub({ value: 45, reason: "ACWR 0.45 (sweet spot 0.7-1.4)" }),
    );
    expect(advice.actions.some((a) => a.label.toLowerCase().includes("add a session"))).toBe(true);
  });

  it("every SubScoreKey returns at least one action", () => {
    for (const key of SUBSCORE_ORDER) {
      const advice = pillarAdvice(key as SubScoreKey, stub({ value: 45 }));
      expect(advice.actions.length).toBeGreaterThan(0);
      expect(advice.headline.length).toBeGreaterThan(0);
    }
  });
});
