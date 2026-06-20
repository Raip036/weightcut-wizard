import type { TutorialStep } from "./types";

export interface ProgressSection {
  id: string;
  label: string;
  stepIds: string[];
}

export const ONBOARDING_SECTIONS: ProgressSection[] = [
  {
    id: "home",
    label: "Home",
    stepIds: [
      "welcome",
      "home-overview",
      "ring-intro",
      "today-strip-intro",
      "today-weight",
      "today-sleep",
      "today-wellness",
      "home-stats",
    ],
  },
  {
    id: "camp",
    label: "Camp",
    stepIds: [
      "camp-intro",
      "camp-full-plan",
      "camp-gym-tracker",
      "camp-gym-page",
      "camp-training-calendar",
      "camp-training-calendar-page",
      "camp-recent-activity",
      "camp-weight-protocol-tile",
      "camp-fight-protocol",
    ],
  },
  {
    id: "community",
    label: "Community",
    stepIds: ["community-intro", "community-photos", "community-details"],
  },
  {
    id: "nutrition",
    label: "Nutrition",
    stepIds: [
      "nutrition-intro",
      "nutrition-snap-meal",
      "nutrition-meal-plan",
    ],
  },
  {
    id: "chat",
    label: "Chat",
    stepIds: ["chat-intro", "chat-suggestions"],
  },
  {
    id: "profile",
    label: "Profile",
    stepIds: ["profile-tap", "profile-intro"],
  },
  {
    id: "handoff",
    label: "Done",
    stepIds: ["camera-intro", "camera-log", "all-done"],
  },
];

export function computeSegmentFills(
  activeSteps: TutorialStep[],
  currentStepIndex: number,
): number[] {
  const activeIds = new Set(activeSteps.map((s) => s.id));
  const presentSections = ONBOARDING_SECTIONS.map((section) => ({
    ...section,
    stepIds: section.stepIds.filter((id) => activeIds.has(id)),
  })).filter((section) => section.stepIds.length > 0);

  const currentId = activeSteps[currentStepIndex]?.id ?? null;

  return presentSections.map((section) => {
    const idx = currentId ? section.stepIds.indexOf(currentId) : -1;
    if (idx >= 0) {
      return (idx + 1) / section.stepIds.length;
    }
    const allBefore = section.stepIds.every((id) => {
      const stepIdx = activeSteps.findIndex((s) => s.id === id);
      return stepIdx >= 0 && stepIdx < currentStepIndex;
    });
    return allBefore ? 1 : 0;
  });
}
