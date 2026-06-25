import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface AIStep {
  icon: LucideIcon;
  label: string;
  color?: string;
}

export type AITaskType =
  | "meal-analysis" | "ingredient-lookup" | "meal-plan"
  | "diet-analysis" | "weight-analysis" | "rehydration"
  | "fight-week" | "gym-routine" | "training-summary"
  | "fight-camp-coach";

export interface AITask {
  id: string;
  type: AITaskType;
  label: string;
  status: "running" | "done" | "error";
  steps: AIStep[];
  currentStep: number;
  startedAt: number;
  returnPath: string;
  result?: any;
  error?: string;
}

interface AITaskInternal extends AITask {
  completedAt?: number;
  failedAt?: number;
}

interface AITaskState {
  tasks: AITask[];
  activeTask: AITask | null;
}

interface AITaskActions {
  addTask: (task: { id: string; type: AITaskType; label: string; steps: AIStep[]; returnPath: string }) => string;
  updateStep: (id: string, step: number) => void;
  completeTask: (id: string, result?: any) => void;
  failTask: (id: string, error: string) => void;
  dismissTask: (id: string) => void;
  getTask: (id: string) => AITask | undefined;
}

interface AITaskContextType extends AITaskState, AITaskActions {}

// Split context: state vs. actions. Action consumers (e.g. components that only
// call addTask/dismissTask but never read the live task list) get a stable
// reference and don't rerender when tasks change.
const AITaskStateContext = createContext<AITaskState | undefined>(undefined);
const AITaskActionsContext = createContext<AITaskActions | undefined>(undefined);

export function AITaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<AITaskInternal[]>([]);

  // Mirror tasks in a ref so getTask can read live state without depending on
  // `tasks` (which would re-create the callback on every task update).
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  const addTask = useCallback(
    (task: { id: string; type: AITaskType; label: string; steps: AIStep[]; returnPath: string }): string => {
      setTasks((prev) => {
        const filtered = prev.filter((t) => !(t.type === task.type && t.status === "running"));
        return [
          ...filtered,
          {
            ...task,
            status: "running" as const,
            currentStep: 0,
            startedAt: Date.now(),
          },
        ];
      });
      return task.id;
    },
    []
  );

  const updateStep = useCallback((id: string, step: number) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, currentStep: step } : t)));
  }, []);

  const completeTask = useCallback((id: string, result?: any) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, status: "done" as const, result, currentStep: t.steps.length - 1, completedAt: Date.now() }
          : t
      )
    );
  }, []);

  const failTask = useCallback((id: string, error: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: "error" as const, error, failedAt: Date.now() } : t)));
  }, []);

  const dismissTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const getTask = useCallback((id: string): AITask | undefined => {
    return tasksRef.current.find((t) => t.id === id);
  }, []);

  const activeTask: AITask | null = useMemo(
    () => [...tasks].reverse().find((t) => t.status === "running") ?? null,
    [tasks]
  );

  // Sweep timer to expire done/error tasks. Gated on `tasks.length` so it only
  // ticks while tasks exist — otherwise this fired every second for every user
  // forever (1 re-render/sec × all clients) even when nothing was running.
  useEffect(() => {
    if (tasks.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setTasks((prev) => prev.filter((t) => {
        if (t.status === "done" && t.completedAt && now - t.completedAt > 300_000) return false;
        if (t.status === "error" && t.failedAt && now - t.failedAt > 5_000) return false;
        return true;
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, [tasks.length]);

  const stateValue = useMemo<AITaskState>(() => ({ tasks, activeTask }), [tasks, activeTask]);
  const actionsValue = useMemo<AITaskActions>(
    () => ({ addTask, updateStep, completeTask, failTask, dismissTask, getTask }),
    [addTask, updateStep, completeTask, failTask, dismissTask, getTask]
  );

  return (
    <AITaskActionsContext.Provider value={actionsValue}>
      <AITaskStateContext.Provider value={stateValue}>
        {children}
      </AITaskStateContext.Provider>
    </AITaskActionsContext.Provider>
  );
}

/**
 * Returns the live AI-task list + active task. Subscribers rerender on task
 * updates — use only where you need the current state.
 */
export function useAITaskState(): AITaskState {
  const context = useContext(AITaskStateContext);
  if (!context) throw new Error("useAITaskState must be used within AITaskProvider");
  return context;
}

/**
 * Returns the AI-task action methods. Subscribers DO NOT rerender on task
 * updates — prefer this in components that only dispatch (addTask, dismissTask).
 */
export function useAITaskActions(): AITaskActions {
  const context = useContext(AITaskActionsContext);
  if (!context) throw new Error("useAITaskActions must be used within AITaskProvider");
  return context;
}

/**
 * Combined accessor — subscribes to both state and actions. Existing call
 * sites continue to work unchanged. New code should prefer the split hooks
 * to avoid unnecessary rerenders.
 */
export function useAITask(): AITaskContextType {
  const state = useAITaskState();
  const actions = useAITaskActions();
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}
