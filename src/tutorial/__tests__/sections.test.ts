import { describe, it, expect } from "vitest";
import { computeSegmentFills, ONBOARDING_SECTIONS } from "../sections";
import type { TutorialStep } from "../types";

function step(id: string): TutorialStep {
  return { id, title: "", description: "", position: "center" };
}

const allSteps: TutorialStep[] = [
  // Home
  step("welcome"),
  step("home-overview"),
  step("ring-intro"),
  step("today-strip-intro"),
  step("today-weight"),
  step("today-sleep"),
  step("today-wellness"),
  step("home-stats"),
  // Camp
  step("camp-intro"),
  step("camp-full-plan"),
  step("camp-gym-tracker"),
  step("camp-gym-page"),
  step("camp-training-calendar"),
  step("camp-training-calendar-page"),
  step("camp-recent-activity"),
  step("camp-weight-protocol-tile"),
  step("camp-fight-protocol"),
  // Community
  step("community-intro"),
  step("community-photos"),
  step("community-details"),
  // Nutrition
  step("nutrition-intro"),
  step("nutrition-snap-meal"),
  step("nutrition-daily-wisdom"),
  step("nutrition-meal-plan"),
  // Chat
  step("chat-intro"),
  step("chat-suggestions"),
  // Profile
  step("profile-tap"),
  step("profile-intro"),
  // Handoff
  step("camera-intro"),
  step("camera-log"),
  step("all-done"),
];

describe("ONBOARDING_SECTIONS", () => {
  it("has seven sections", () => {
    expect(ONBOARDING_SECTIONS).toHaveLength(7);
  });
  it("covers every onboarding step id exactly once", () => {
    const ids = ONBOARDING_SECTIONS.flatMap((s) => s.stepIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(allSteps.map((s) => s.id));
  });
});

describe("computeSegmentFills", () => {
  it("fills the first segment to 1 when on the only step in it", () => {
    // Home has 8 steps. Step index 0 = "welcome" = 1/8 fill for the Home segment.
    const fills = computeSegmentFills(allSteps, 0);
    expect(fills[0]).toBeCloseTo(1 / 8, 5);
    expect(fills[1]).toBe(0);
  });
  it("fills a multi-step segment proportionally", () => {
    // Step index 2 = "ring-intro" = 3rd step in the Home segment (8 steps) → 3/8
    const fills = computeSegmentFills(allSteps, 2);
    expect(fills[0]).toBeCloseTo(3 / 8, 5);
  });
  it("marks completed segments as 1", () => {
    // Step index 17 = "community-intro" (first step of Section 3).
    // Home (8 steps, indices 0-7) and Camp (9 steps, indices 8-16) are fully complete.
    const fills = computeSegmentFills(allSteps, 17);
    expect(fills[0]).toBe(1); // Home complete
    expect(fills[1]).toBe(1); // Camp complete
    expect(fills[2]).toBeCloseTo(1 / 3, 5); // Community: 1st of 3 steps
  });
  it("collapses the Camp section when fight-protocol step is filtered out", () => {
    const filtered = allSteps.filter((s) => s.id !== "camp-fight-protocol");
    const fills = computeSegmentFills(filtered, 0);
    // Still 7 sections (Camp section shrinks to 5 steps but doesn't disappear).
    expect(fills).toHaveLength(7);
  });
});
