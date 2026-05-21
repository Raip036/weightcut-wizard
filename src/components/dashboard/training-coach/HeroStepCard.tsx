import type { Doc } from "@/../convex/_generated/dataModel";

export type HeroData = {
  path: Pick<Doc<"training_paths">, "_id" | "goal" | "sport">;
  currentStep: Pick<Doc<"training_path_steps">, "_id" | "prescription" | "wizardLine">;
  nextSteps: Array<Pick<Doc<"training_path_steps">, "prescription">>;
  totalSteps: number;
  stepNumber: number;
};

type Props = {
  hero: HeroData;
  onTap: () => void;
};

export function HeroStepCard({ hero, onTap }: Props) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full text-left rounded-2xl border border-primary/30 bg-primary/5 p-4 active:scale-[0.99] transition-transform"
      aria-label={`Step ${hero.stepNumber} of ${hero.totalSteps}: ${hero.currentStep.prescription}`}
    >
      <p className="text-[14px] italic text-foreground/90 leading-snug">
        🧙 “{hero.currentStep.wizardLine}”
      </p>
      <p className="mt-2 text-[15px] font-semibold leading-tight">
        {hero.currentStep.prescription}
      </p>
      <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        Step {hero.stepNumber} of {hero.totalSteps} · {hero.path.goal}
      </p>
      {hero.nextSteps.length > 0 && (
        <div className="mt-3 border-t border-border/40 pt-2 space-y-0.5">
          {hero.nextSteps[0] && (
            <p className="text-[11px] text-muted-foreground">
              Up next: {hero.nextSteps[0].prescription}
            </p>
          )}
          {hero.nextSteps[1] && (
            <p className="text-[11px] text-muted-foreground/70">
              Then: {hero.nextSteps[1].prescription}
            </p>
          )}
        </div>
      )}
    </button>
  );
}
