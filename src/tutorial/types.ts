export type TooltipPosition = "top" | "bottom" | "left" | "right" | "center";
export type GoalType = "cutting" | "bulking" | "maintaining";
export type WizardPose = "idle" | "wave" | "point" | "celebrate";
export type VoicePace = "normal" | "slow";

export interface UserTutorialState {
  goalType: GoalType;
  currentRoute: string;
  hasProfile: boolean;
  profileData: any | null;
}

export interface TutorialStep {
  id: string;
  target?: string;                                    // data-tutorial attribute value
  title: string;
  description: string;
  position: TooltipPosition;
  route?: string;                                     // which route this step requires
  navigateTo?: string;                                // navigate to this route before showing step
  condition?: (state: UserTutorialState) => boolean;  // skip if false
  spotlight?: string;                                  // data-tutorial value of element to spotlight (dims everything else)
  spotlightOffset?: { x?: number; y?: number; width?: number; height?: number; yPercent?: number }; // manual spotlight nudge (yPercent: % of viewport height)
  /** When set, a window CustomEvent with this name is dispatched when the
   *  step enters. Used to bridge declarative steps to imperative actions
   *  (e.g. "open the Fight Form sheet" → "tutorial:open-fight-form-sheet").
   *  The listener is responsible for any required side-effects + timing. */
  actionEventName?: string;
  wizardPose?: WizardPose;
  voicePace?: VoicePace;
}

export interface TutorialFlow {
  id: string;
  version: number;         // bump to re-trigger for existing users
  steps: TutorialStep[];
}

export interface TutorialPersistenceData {
  completedFlows: Record<string, number>;  // flowId -> completed version
  currentFlow: string | null;
  currentStepIndex: number;
}

export interface TutorialManagerState {
  isActive: boolean;
  currentFlow: TutorialFlow | null;
  currentStep: TutorialStep | null;
  currentStepIndex: number;
  totalSteps: number;
  activeSteps: TutorialStep[];
}

// Derive goal type from profile weights (no explicit field in DB)
export function deriveGoalType(profile: any | null): GoalType {
  if (!profile?.current_weight_kg || !profile?.goal_weight_kg) return "cutting";
  const diff = profile.current_weight_kg - profile.goal_weight_kg;
  if (diff > 0.5) return "cutting";
  if (diff < -0.5) return "bulking";
  return "maintaining";
}
