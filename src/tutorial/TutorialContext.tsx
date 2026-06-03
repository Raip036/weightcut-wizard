import {
  createContext,
  useRef,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
}

export const TutorialContext = createContext<TutorialContextValue | null>(null);

/** Delay before showing tooltip after a route navigation (lets lazy page load + animate) */
const NAV_SETTLE_MS = 600;

export function TutorialProvider({ children }: { children: ReactNode }) {
  const { userId, profile, hasProfile } = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const managerRef = useRef(new TutorialManager());
  const autoTriggeredRef = useRef(false);
  const pausedFlowRef = useRef<{ flowId: string; stepIndex: number } | null>(null);
  const isPausingRef = useRef(false);
  // Set true while prev() handles a cross-route back navigation so the pause
  // mechanism doesn't fire a skip() before the navigation resolves.
  const navigatingBackRef = useRef(false);

  // Whether we're waiting for a navigation to settle before revealing the tooltip
  const [waitingForNav, setWaitingForNav] = useState(false);

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

  // Auto-trigger onboarding on /dashboard
  useEffect(() => {
    if (location.pathname !== "/dashboard" || !userId || !hasProfile || state.isActive) return;

    // Check for fresh onboarding completion — must come before autoTriggeredRef check
    // so we can reset the ref (it may have been set during the /cut-plan render cycle)
    const justOnboarded = localStorage.getItem("wcw_onboarding_just_completed");
    if (justOnboarded) {
      autoTriggeredRef.current = false;
    }

    if (autoTriggeredRef.current) return;

    // Check if we should resume a paused flow
    if (pausedFlowRef.current) {
      const { flowId, stepIndex } = pausedFlowRef.current;
      pausedFlowRef.current = null;
      const timer = setTimeout(() => {
        managerRef.current.start(flowId, getUserState(), stepIndex);
      }, 400);
      return () => clearTimeout(timer);
    }

    // If user just finished onboarding, always show the tutorial
    if (justOnboarded) {
      localStorage.removeItem("wcw_onboarding_just_completed");
      // Clear any stale completion state so the tutorial runs fresh
      tutorialPersistence.clearFlow(userId, "onboarding");
    } else {
      // Check if onboarding already completed (persistence + localStorage guard)
      if (tutorialPersistence.isFlowCompleted(userId, onboardingFlow)) {
        autoTriggeredRef.current = true;
        return;
      }

      // Extra guard: check if tutorial was already shown this session
      const sessionKey = `wcw_tutorial_shown_${userId}`;
      if (localStorage.getItem(sessionKey)) {
        autoTriggeredRef.current = true;
        return;
      }
    }

    // Seed demo data only for brand-new users (no cached weight data yet)
    const hasRealData = localCache.get(userId, "dashboard_weight_logs");
    if (!hasRealData && !isDemoActive(userId)) {
      seedDemoData(userId);
    }

    // Start onboarding after dashboard animations finish — mark as shown immediately
    const sessionKey = `wcw_tutorial_shown_${userId}`;
    localStorage.setItem(sessionKey, 'true');
    const timer = setTimeout(() => {
      autoTriggeredRef.current = true;
      managerRef.current.start("onboarding", getUserState());
    }, 400);
    return () => clearTimeout(timer);
  }, [location.pathname, userId, hasProfile, state.isActive]);

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

  // Don't show overlay while waiting for navigation to settle
  const showOverlay = state.isActive && !waitingForNav;

  const value: TutorialContextValue = {
    isActive: state.isActive,
    currentStep: state.currentStep,
    currentStepIndex: state.currentStepIndex,
    totalSteps: state.totalSteps,
    next,
    prev,
    skip,
    triggerTutorial,
    replayTutorial,
  };

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
