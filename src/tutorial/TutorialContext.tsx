import {
  createContext,
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import { seedDemoData, clearDemoData, isDemoActive } from "@/lib/demoData";
import { localCache } from "@/lib/localCache";
import { TutorialManager } from "./tutorialManager";
import { tutorialPersistence } from "./tutorialPersistence";
import { onboardingFlow } from "./flows/onboardingFlow";
import { featureFlows } from "./flows/featureFlows";
import { TutorialStage } from "./TutorialStage";
import type {
  TutorialStep,
  TutorialManagerState,
  UserTutorialState,
} from "./types";
import { deriveGoalType } from "./types";

export interface TutorialContextValue {
  isActive: boolean;
  currentStep: TutorialStep | null;
  currentStepIndex: number;
  totalSteps: number;
  next: () => void;
  prev: () => void;
  skip: () => void;
  triggerTutorial: (flowId: string) => void;
  replayTutorial: (flowId: string) => void;
  /** True when the "Want a quick tour?" bubble should show on the coach orb. */
  onboardingPromptVisible: boolean;
  /** User tapped "Start tour" — begins the onboarding tour. */
  acceptOnboardingPrompt: () => void;
  /** User tapped "Later"/dismiss — hides the bubble (already marked shown). */
  declineOnboardingPrompt: () => void;
}

export const TutorialContext = createContext<TutorialContextValue | null>(null);

/** Delay before showing tooltip after a route navigation (lets lazy page load + animate) */
const NAV_SETTLE_MS = 600;

export function TutorialProvider({ children }: { children: ReactNode }) {
  const { userId, profile, hasProfile } = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const markTutorialShown = useMutation(api.profiles.markOnboardingTutorialShown);
  const managerRef = useRef(new TutorialManager());
  const autoTriggeredRef = useRef(false);
  const pausedFlowRef = useRef<{ flowId: string; stepIndex: number } | null>(null);
  const isPausingRef = useRef(false);
  // Set true while prev() handles a cross-route back navigation so the pause
  // mechanism doesn't fire a skip() before the navigation resolves.
  const navigatingBackRef = useRef(false);

  // Whether we're waiting for a navigation to settle before revealing the tooltip
  const [waitingForNav, setWaitingForNav] = useState(false);

  // Drives the "Want a quick tour?" speech bubble on the coach orb. Set true on
  // the first settled /dashboard after onboarding (replaces the old silent
  // auto-start); the user explicitly accepts or declines.
  const [onboardingPromptVisible, setOnboardingPromptVisible] = useState(false);

  const [state, setState] = useState<TutorialManagerState>({
    isActive: false,
    currentFlow: null,
    currentStep: null,
    currentStepIndex: 0,
    totalSteps: 0,
    activeSteps: [],
  });

  // Build user state for condition evaluation
  const getUserState = useCallback((): UserTutorialState => {
    return {
      goalType: deriveGoalType(profile),
      currentRoute: location.pathname,
      hasProfile: hasProfile,
      profileData: profile,
    };
  }, [profile, hasProfile, location.pathname]);

  // Register flows. The version is a dep so that Vite HMR re-registers the
  // latest flow object when only onboardingFlow.ts changes (avoiding stale
  // flows staying in the TutorialManager ref after a hot reload).
  useEffect(() => {
    const manager = managerRef.current;
    manager.registerFlow(onboardingFlow);
    manager.registerFlows(featureFlows);
  }, [onboardingFlow.version]);

  // Subscribe to manager state changes
  useEffect(() => {
    const manager = managerRef.current;
    const unsub = manager.subscribe((newState) => {
      setState(newState);

      // If flow just completed (isActive false but currentFlow present), persist
      // But NOT if we're just pausing (navigating away mid-tutorial)
      if (!newState.isActive && newState.currentFlow && userId && !isPausingRef.current) {
        tutorialPersistence.markFlowCompleted(
          userId,
          newState.currentFlow.id,
          newState.currentFlow.version
        );
        // Clear demo data when onboarding tutorial finishes
        if (newState.currentFlow.id === "onboarding") {
          if (isDemoActive(userId)) clearDemoData(userId);
        }
      }
    });
    return unsub;
  }, [userId]);

  // Persist progress on step changes
  useEffect(() => {
    if (state.isActive && state.currentFlow && userId) {
      tutorialPersistence.saveProgress(
        userId,
        state.currentFlow.id,
        state.currentStepIndex
      );
    }
  }, [state.isActive, state.currentFlow, state.currentStepIndex, userId]);

  // Scroll a target element into view once navigation has settled.
  // Gated on `waitingForNav` so scrollTo fires AFTER the page has rendered
  // (not mid-transition), giving the spotlight time to measure correctly.
  useEffect(() => {
    if (!state.isActive || !state.currentStep?.scrollTo || waitingForNav) return;
    const selector = state.currentStep.scrollTo;
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-tutorial="${selector}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => clearTimeout(t);
  }, [state.isActive, state.currentStep, waitingForNav]);

  // Auto-advance timer — fires autoAdvanceMs after nav settles so cinematic
  // card→page transitions don't need the user to tap Next.
  useEffect(() => {
    if (!state.isActive || !state.currentStep?.autoAdvanceMs || waitingForNav) return;
    const delay = state.currentStep.autoAdvanceMs;
    const t = setTimeout(() => {
      managerRef.current.next(getUserState());
    }, delay);
    return () => clearTimeout(t);
  }, [state.isActive, state.currentStep, waitingForNav, getUserState]);

  // Dispatch `actionEventName` (if set) when a step enters. Bridges
  // declarative tutorial steps to imperative side-effects in pages
  // (e.g. open a bottom sheet). Guarded by a ref so we fire exactly
  // once per step id — strict-mode double-invoke / unrelated re-renders
  // must not re-dispatch.
  const lastDispatchedStepIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state.isActive) {
      lastDispatchedStepIdRef.current = null;
      return;
    }
    const step = state.currentStep;
    if (!step?.actionEventName) return;
    if (lastDispatchedStepIdRef.current === step.id) return;
    lastDispatchedStepIdRef.current = step.id;
    window.dispatchEvent(new CustomEvent(step.actionEventName));
  }, [state.isActive, state.currentStep]);

  // --- Navigation handling ---
  // When the current step has a `navigateTo` that differs from location, navigate there.
  // Hide the tooltip while navigating, then reveal once the route matches.
  // Compare current location against a navigateTo target (which may include query params)
  const locationMatches = (target: string): boolean => {
    const currentFull = location.pathname + location.search;
    // Match if pathname matches (ignoring query) or full path+search matches
    const targetPath = target.split("?")[0];
    return currentFull === target || location.pathname === targetPath;
  };

  useEffect(() => {
    if (!state.isActive || !state.currentStep) return;

    const target = state.currentStep.navigateTo;
    if (!target) {
      setWaitingForNav(false);
      return;
    }

    if (!locationMatches(target)) {
      setWaitingForNav(true);
      navigate(target);
    }
  }, [state.currentStep, state.isActive, location.pathname, location.search, navigate]);

  // When we arrive at the correct route after a navigateTo, reveal the tooltip after settling
  useEffect(() => {
    if (!waitingForNav || !state.isActive || !state.currentStep) return;

    const target = state.currentStep.navigateTo;
    if (target && locationMatches(target)) {
      const t = setTimeout(() => setWaitingForNav(false), NAV_SETTLE_MS);
      return () => clearTimeout(t);
    }
  }, [waitingForNav, location.pathname, location.search, state.isActive, state.currentStep]);

  // When the signed-in account changes (e.g. logout then register a NEW account
  // in the same app session), reset the in-memory auto-trigger guards. Without
  // this, `autoTriggeredRef`/`pausedFlowRef` stay stale from the previous account
  // and short-circuit the new account's tutorial — the exact bug where a new user
  // on a device that had been used before saw no tutorial. "Already shown" is now
  // server-authoritative (profile field), so clearing these in-session flags is safe.
  const prevUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevUserIdRef.current !== null && prevUserIdRef.current !== userId) {
      autoTriggeredRef.current = false;
      pausedFlowRef.current = null;
      setState({
        isActive: false,
        currentFlow: null,
        currentStep: null,
        currentStepIndex: 0,
        totalSteps: 0,
        activeSteps: [],
      });
    }
    prevUserIdRef.current = userId ?? null;
  }, [userId]);

  // Auto-trigger onboarding on /dashboard — EXACTLY ONCE PER ACCOUNT, on the
  // first dashboard load after the weight-cut plan was generated. After it has
  // run once (or the user completed it), it NEVER auto-runs again; the only other
  // way to see it is the manual "replay" from Settings.
  //
  // The "already shown" lock is the SERVER field `onboarding_tutorial_shown_at`
  // (CAS-stamped via markOnboardingTutorialShown), so it's authoritative per
  // account and device-independent: a new account always gets the tutorial even
  // on a device that ran it for a previous account, and it never re-fires across
  // devices/reinstalls. The legacy per-user localStorage completion record is
  // kept only as a fallback so pre-existing users aren't re-shown.
  useEffect(() => {
    if (location.pathname !== "/dashboard" || !userId || !hasProfile || state.isActive) return;

    // `wcw_onboarding_just_completed` is set ONCE by onboarding right after the
    // plan is generated — the only signal that auto-starts the tutorial.
    const justOnboarded = localStorage.getItem("wcw_onboarding_just_completed");

    // Resume a paused flow (mid-tutorial manual navigation) — highest priority.
    // A paused flow means the tutorial is already in progress, so consume the
    // one-shot flag and resume.
    if (pausedFlowRef.current) {
      if (justOnboarded) localStorage.removeItem("wcw_onboarding_just_completed");
      const { flowId, stepIndex } = pausedFlowRef.current;
      pausedFlowRef.current = null;
      const timer = setTimeout(() => {
        managerRef.current.start(flowId, getUserState(), stepIndex);
      }, 400);
      return () => clearTimeout(timer);
    }

    if (autoTriggeredRef.current) return;

    // A freshly generated cut plan must be viewed first: Dashboard redirects a
    // just-onboarded user from here to /cut-plan (wcw_cut_plan set, seen flag
    // cleared by onboarding). That redirect lands us on this transient
    // /dashboard mount BEFORE the user has actually settled here. If we consumed
    // the one-shot `wcw_onboarding_just_completed` flag and armed the start timer
    // now, the imminent navigation to /cut-plan would cancel the timer (effect
    // cleanup) AND we'd already have CAS-stamped the server "shown" field — so
    // the tutorial would be lost forever and never re-fire. Bail WITHOUT
    // consuming the flag; the effect re-runs when the user closes the plan and
    // returns to a settled /dashboard (seen flag now set), and the tutorial
    // fires then. This is the root-cause fix for the "tutorial never starts for
    // a 2nd new account on the same device" race: a warm session has the profile
    // ready at this transient mount and loses the race; a cold first install
    // lags a render and accidentally survived it.
    const cutPlanPendingFirstView =
      !!localStorage.getItem("wcw_cut_plan") &&
      !localStorage.getItem("wcw_cut_plan_seen");
    if (justOnboarded && cutPlanPendingFirstView) return;

    // Server-authoritative per-account guard; localStorage completion is a
    // fallback for users who finished the tutorial before this field existed.
    const alreadyShown =
      profile?.onboarding_tutorial_shown_at != null ||
      tutorialPersistence.isFlowCompleted(userId, onboardingFlow);

    // Only auto-run on the FIRST dashboard entry after plan generation.
    if (!justOnboarded || alreadyShown) {
      if (justOnboarded) localStorage.removeItem("wcw_onboarding_just_completed");
      autoTriggeredRef.current = true;
      return;
    }

    // First-time post-plan: consume the trigger flag, lock the in-memory guard,
    // and CAS-stamp the server field. Per the "ask once per account" design we
    // stamp on SHOW (not on the user's answer) — if they ignore the bubble it
    // won't re-appear, and Settings → Replay is the way back in. Instead of the
    // old silent auto-start, surface a prompt bubble on the coach orb and let
    // the user choose (accept → start the tour, decline → dismiss).
    localStorage.removeItem("wcw_onboarding_just_completed");
    autoTriggeredRef.current = true;
    void markTutorialShown().catch(() => {
      // Non-fatal: the in-memory guard already prevents a same-session re-fire;
      // the stamp will retry on a later session if it failed.
    });
    setOnboardingPromptVisible(true);
  }, [location.pathname, userId, hasProfile, state.isActive, profile?.onboarding_tutorial_shown_at]);

  // Pause on route change — ONLY if the user navigated manually (not via tutorial navigation).
  // If the step has `navigateTo`, the context handles it — don't pause.
  // If `navigatingBackRef` is set, prev() is handling a back-navigation — don't pause.
  useEffect(() => {
    if (!state.isActive || !state.currentStep) return;
    if (navigatingBackRef.current) return;

    const step = state.currentStep;
    if (step.navigateTo) return;
    const flowId = state.currentFlow?.id;
    if (step.route && step.route !== location.pathname && flowId) {
      pausedFlowRef.current = {
        flowId,
        stepIndex: state.currentStepIndex,
      };
      isPausingRef.current = true;
      managerRef.current.skip();
      isPausingRef.current = false;
    }
  }, [location.pathname, state.isActive, state.currentStep, state.currentFlow, state.currentStepIndex]);

  const next = useCallback(() => {
    managerRef.current.next(getUserState());
  }, [getUserState]);

  const prev = useCallback(() => {
    const mgr = managerRef.current;
    const { activeSteps, currentStepIndex } = mgr.getState();

    // Peek at what the previous step would be.
    let prevIdx = currentStepIndex - 1;
    while (prevIdx >= 0) {
      const s = activeSteps[prevIdx];
      if (!s.target || s.navigateTo || mgr.resolveTarget(s)) break;
      prevIdx--;
    }

    if (prevIdx >= 0) {
      const prevStep = activeSteps[prevIdx];
      const targetRoute = prevStep.navigateTo ?? prevStep.route;
      if (targetRoute) {
        const targetPath = targetRoute.split("?")[0];
        if (location.pathname !== targetPath) {
          // Route navigation needed — suppress the pause mechanism while it resolves.
          navigatingBackRef.current = true;
          setWaitingForNav(true);
          navigate(targetPath);
          setTimeout(() => { navigatingBackRef.current = false; }, NAV_SETTLE_MS * 2 + 200);
        }
      }
    }

    mgr.prev(getUserState());
  }, [getUserState, location.pathname, navigate]);

  const skip = useCallback(() => {
    pausedFlowRef.current = null;
    if (state.currentFlow && userId) {
      tutorialPersistence.markFlowCompleted(
        userId,
        state.currentFlow.id,
        state.currentFlow.version
      );
      if (state.currentFlow.id === "onboarding") {
        if (isDemoActive(userId)) clearDemoData(userId);
      }
    }
    managerRef.current.skip();
    // Navigate back to dashboard when skipping mid-tour on another page
    if (location.pathname !== "/dashboard") {
      navigate("/dashboard");
    }
  }, [state.currentFlow, userId, location.pathname, navigate]);

  const triggerTutorial = useCallback(
    (flowId: string) => {
      managerRef.current.start(flowId, getUserState());
    },
    [getUserState]
  );

  const replayTutorial = useCallback(
    (flowId: string) => {
      if (userId) {
        tutorialPersistence.clearFlow(userId, flowId);
      }
      autoTriggeredRef.current = false;
      managerRef.current.start(flowId, getUserState());
    },
    [userId, getUserState]
  );

  // Onboarding prompt bubble (rendered on the coach orb by FloatingWizardChat).
  // Accept → seed demo data for brand-new users so the tour has something to
  // point at, then start the onboarding flow. A short delay lets the bubble's
  // exit animation play before the tour overlay takes the screen.
  const acceptOnboardingPrompt = useCallback(() => {
    setOnboardingPromptVisible(false);
    if (userId) {
      const hasRealData = localCache.get(userId, "dashboard_weight_logs");
      if (!hasRealData && !isDemoActive(userId)) {
        seedDemoData(userId);
      }
    }
    setTimeout(() => {
      managerRef.current.start("onboarding", getUserState());
    }, 280);
  }, [userId, getUserState]);

  // Decline → just hide the bubble. The "shown" stamp already happened when it
  // appeared, so it won't re-prompt; Settings → Replay remains the way back in.
  const declineOnboardingPrompt = useCallback(() => {
    setOnboardingPromptVisible(false);
  }, []);

  // Don't show overlay while waiting for navigation to settle
  const showOverlay = state.isActive && !waitingForNav;

  // Memoized so consumers across the app (this provider wraps the whole tree)
  // only re-render when tutorial state actually changes — not on every
  // unrelated provider render that would otherwise mint a fresh value object.
  const value: TutorialContextValue = useMemo(
    () => ({
      isActive: state.isActive,
      currentStep: state.currentStep,
      currentStepIndex: state.currentStepIndex,
      totalSteps: state.totalSteps,
      next,
      prev,
      skip,
      triggerTutorial,
      replayTutorial,
      onboardingPromptVisible,
      acceptOnboardingPrompt,
      declineOnboardingPrompt,
    }),
    [
      state.isActive,
      state.currentStep,
      state.currentStepIndex,
      state.totalSteps,
      next,
      prev,
      skip,
      triggerTutorial,
      replayTutorial,
      onboardingPromptVisible,
      acceptOnboardingPrompt,
      declineOnboardingPrompt,
    ]
  );

  return (
    <TutorialContext.Provider value={value}>
      {children}
      <TutorialStage
        isActive={showOverlay}
        currentStep={state.currentStep}
        currentStepIndex={state.currentStepIndex}
        totalSteps={state.totalSteps}
        activeSteps={state.activeSteps}
        flowId={state.currentFlow?.id ?? null}
        onNext={next}
        onPrev={prev}
        onSkip={skip}
      />
    </TutorialContext.Provider>
  );
}
