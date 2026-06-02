import { AICompactOverlay } from "@/components/AICompactOverlay";
import { MealPhotoScanOverlay } from "@/components/nutrition/MealPhotoScanOverlay";
import type { AITaskType } from "@/contexts/AITaskContext";

interface AiTaskLike {
  id: string;
  steps: any[];
  startedAt: number;
  label: string;
  type?: AITaskType;
}

interface AiTaskBannerProps {
  aiTask: AiTaskLike | null | undefined;
  photoAnalyzing: boolean;
  photoBase64: string | null;
  onCancel: () => void;
  onDismiss: (id: string) => void;
  /**
   * When true, suppress the banner for `meal-analysis` tasks. Used by the
   * Nutrition page while the QuickAddDialog is open — that dialog renders
   * its own MealPhotoScanOverlay, so showing this one too leaves a ghost
   * copy of the photo sitting behind the dimmed dialog backdrop.
   */
  suppressMealAnalysis?: boolean;
}

/**
 * Sticky overlay shown at the top of the Nutrition page while any
 * long-running AI task is active (meal analysis, ingredient lookup,
 * meal plan generation, diet analysis).
 */
export function AiTaskBanner({ aiTask, photoAnalyzing, photoBase64, onCancel, onDismiss, suppressMealAnalysis }: AiTaskBannerProps) {
  if (!aiTask) return null;
  if (suppressMealAnalysis && aiTask.type === "meal-analysis") return null;
  // Diet analysis renders its own inline wizard-scroll animation in the
  // diet-analysis card slot (WizardDietScrollOverlay), so the sticky top
  // banner stays out of its way.
  if (aiTask.type === "diet-analysis") return null;
  const handleCancel = () => { onCancel(); onDismiss(aiTask.id); };

  return (
    <div className="sticky top-0 z-50 px-5 sm:px-6 pt-2 pb-2 max-w-7xl mx-auto bg-background/95">
      {photoAnalyzing && photoBase64 ? (
        <MealPhotoScanOverlay
          isOpen
          isGenerating
          photoBase64={photoBase64}
          steps={aiTask.steps}
          startedAt={aiTask.startedAt}
          title={aiTask.label}
          onCancel={handleCancel}
        />
      ) : (
        <AICompactOverlay
          isOpen
          isGenerating
          steps={aiTask.steps}
          startedAt={aiTask.startedAt}
          title={aiTask.label}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
