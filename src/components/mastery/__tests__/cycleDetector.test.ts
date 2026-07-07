import { describe, it, expect } from "vitest";
import {
  createCycleDetectorState,
  stepCycleDetection,
  type GraduatedCounts,
} from "../useMinimumDisplay";

// The Technique Mastery completion cutscene is driven by stepCycleDetection:
// when a discipline's un-mastered graduated count goes >0 -> 0, it fires ONE
// CycleCompletion. XP = prevCount * 45 + 50 (3 lands x 15 XP + 50 cycle bonus).
//
// These simulate the render sequence by calling stepCycleDetection with the same
// state object repeatedly, the way the hook does via a ref.

const XP = (prev: number) => prev * (3 * 15) + 50;

function step(
  state: ReturnType<typeof createCycleDetectorState>,
  counts: GraduatedCounts,
  resetKey: string | number | null | undefined,
  stable = true,
) {
  return stepCycleDetection(state, counts, resetKey, stable);
}

describe("stepCycleDetection", () => {
  it("seeds a baseline on the first stable step and emits nothing", () => {
    const s = createCycleDetectorState("campA");
    expect(step(s, { muaythai: 1 }, "campA")).toEqual([]);
    // Unchanged next step: still nothing.
    expect(step(s, { muaythai: 1 }, "campA")).toEqual([]);
  });

  it("fires exactly one completion when a count drops >0 -> 0, and never double-fires", () => {
    const s = createCycleDetectorState("campA");
    step(s, { muaythai: 1 }, "campA"); // baseline
    const fired = step(s, { muaythai: 0 }, "campA");
    expect(fired).toEqual([{ discipline: "muaythai", xp: XP(1) }]);
    // Same 0 count on the next render must not re-fire.
    expect(step(s, { muaythai: 0 }, "campA")).toEqual([]);
    // And again.
    expect(step(s, {}, "campA")).toEqual([]);
  });

  it("uses the pre-drop count for XP (2 graduated techniques)", () => {
    const s = createCycleDetectorState("campA");
    step(s, { boxing: 2 }, "campA"); // baseline
    expect(step(s, { boxing: 0 }, "campA")).toEqual([
      { discipline: "boxing", xp: XP(2) },
    ]);
  });

  it("REGRESSION: a camp switch does NOT false-fire disciplines from the old camp", () => {
    const s = createCycleDetectorState("campA");
    // Camp A has an active graduated cycle for muaythai + boxing.
    step(s, { muaythai: 1, boxing: 1 }, "campA"); // baseline for A

    // User switches camps. resetKey flips to campB, but the latched flow still
    // holds camp A's counts for a blip render (stable=false).
    expect(step(s, { muaythai: 1, boxing: 1 }, "campB", false)).toEqual([]);

    // Camp B's real counts land (a totally different discipline). muaythai and
    // boxing simply do not exist in camp B. This must NOT be read as two cycle
    // completions (the bug: the shared celebrated Set would get poisoned).
    const afterSwitch = step(s, { bjj: 1 }, "campB", true);
    expect(afterSwitch).toEqual([]);

    // A genuine completion in camp B still fires (the guard was not poisoned).
    expect(step(s, { bjj: 0 }, "campB", true)).toEqual([
      { discipline: "bjj", xp: XP(1) },
    ]);
  });

  it("REGRESSION: even with no blip render, a camp switch reseeds from settled data and does not fire", () => {
    const s = createCycleDetectorState("campA");
    step(s, { muaythai: 1 }, "campA"); // baseline A
    // Switch straight to camp B settled counts (stable throughout): the first
    // step under the new resetKey is a fresh baseline, not a transition.
    expect(step(s, { boxing: 2 }, "campB", true)).toEqual([]);
    // Real B completion fires afterwards.
    expect(step(s, { boxing: 0 }, "campB", true)).toEqual([
      { discipline: "boxing", xp: XP(2) },
    ]);
  });

  it("ignores unstable (blip) steps and resumes detection against the preserved baseline", () => {
    const s = createCycleDetectorState("campA");
    step(s, { muaythai: 2 }, "campA"); // baseline
    // A same-camp flow blip (stale/latched counts, stable=false) emits nothing
    // and must not move the baseline.
    expect(step(s, { muaythai: 2 }, "campA", false)).toEqual([]);
    // When it stabilises with the real drop, the completion still fires.
    expect(step(s, { muaythai: 0 }, "campA", true)).toEqual([
      { discipline: "muaythai", xp: XP(2) },
    ]);
  });

  it("re-entry: a new graduated batch after a trophy lets the next cycle celebrate again", () => {
    const s = createCycleDetectorState("campA");
    step(s, { muaythai: 1 }, "campA"); // baseline
    expect(step(s, { muaythai: 0 }, "campA")).toEqual([
      { discipline: "muaythai", xp: XP(1) },
    ]); // fires
    // New batch graduates (0 -> 3): re-arms the guard, emits nothing itself.
    expect(step(s, { muaythai: 3 }, "campA")).toEqual([]);
    // The new cycle completes and celebrates again.
    expect(step(s, { muaythai: 0 }, "campA")).toEqual([
      { discipline: "muaythai", xp: XP(3) },
    ]);
  });

  it("does not treat the initial appearance of a count (baseline) as a completion", () => {
    const s = createCycleDetectorState(null);
    // First stable step with data present: baseline, no completion.
    expect(step(s, { boxing: 3 }, null)).toEqual([]);
    // Only a real subsequent drop fires.
    expect(step(s, { boxing: 3 }, null)).toEqual([]);
    expect(step(s, { boxing: 0 }, null)).toEqual([{ discipline: "boxing", xp: XP(3) }]);
  });
});
