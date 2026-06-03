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
  /** "circle" (default) draws a circular cutout; "rect" draws a rounded-
   *  rectangle cutout that matches the element's exact dimensions. */
  spotlightShape?: "circle" | "rect";
  /** Overrides the default spotlight padding (10px) around the element. */
  spotlightPadding?: number;
  /** Where to anchor the wizard + speech bubble.
   *  "bottom" (default) places the column above the nav buttons.
   *  "top" places it just below the status bar — use when the spotlight
   *  target is in the lower half of the screen and would be obscured. */
  wizardAnchor?: "bottom" | "top";
  /** When true, renders the speech bubble ABOVE the wizard regardless of
   *  whether a spotlight is active. Default for spotlight steps is wizard-
   *  first (bubble below); set this to invert. */
  bubbleFirst?: boolean;
  /** data-tutorial value of an element to smoothly scroll into view when
   *  this step activates (fires after nav settles). */
  scrollTo?: string;
  /** Auto-advance to the next step after this many milliseconds once the
   *  step is fully shown (nav settled). Useful for cinematic card→page
   *  transitions. The user can still tap Next to skip the wait. */
  autoAdvanceMs?: number;
  /** When true, TutorialStage dynamically positions the wizard column so its
   *  bottom edge sits just above the spotlight element — use when the spotlight
   *  target is in the lower portion of the screen and the default bottom
   *  position would overlap it. */
  wizardAboveSpotlight?: boolean;
  /** Horizontal side the wizard + bubble column is anchored to.
   *  "left" (default) anchors to the left edge; "right" anchors to the right. */
  wizardSide?: "left" | "right";
  /** CSS value for the tutorial nav Back/Next buttons' bottom offset.
   *  Defaults to "calc(env(safe-area-inset-bottom) + 16px)".
   *  Raise this for steps where the default position overlaps the BottomNav. */
  navBottomOffset?: string;
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
