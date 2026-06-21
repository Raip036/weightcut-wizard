import { memo } from "react";
import { AICompactOverlay } from "./AICompactOverlay";
import type { LucideIcon } from "lucide-react";
import { useAITask } from "@/contexts/AITaskContext";

export interface AIStep {
  icon: LucideIcon;
  label: string;
  color?: string;
}

interface AIGeneratingOverlayProps {
  isOpen: boolean;
  isGenerating: boolean;
  steps: AIStep[];
  title?: string;
  subtitle?: string;
  onCompletion?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
}

export const AIGeneratingOverlay = memo(function AIGeneratingOverlay({
  isOpen,
  isGenerating,
  steps,
  title = "Analyzing Data",
  subtitle = "AI is processing your request...",
  onCompletion,
  onCancel,
}: AIGeneratingOverlayProps) {
  const { activeTask } = useAITask();

  const handleMinimize = () => {
    // No-op: the floating indicator already tracks the task via AITaskContext.
    // Minimizing just dismisses this overlay; the AIFloatingIndicator picks it up.
    onCancel?.();
  };

  return (
    <AICompactOverlay
      isOpen={isOpen}
      isGenerating={isGenerating}
      steps={steps}
      title={title}
      subtitle={subtitle}
      startedAt={activeTask?.startedAt}
      onCompletion={onCompletion}
      onCancel={onCancel}
      onMinimize={activeTask ? handleMinimize : undefined}
    />
  );
});
