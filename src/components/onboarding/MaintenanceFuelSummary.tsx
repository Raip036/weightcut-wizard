import { Button } from "@/components/ui/button";
import { DailyFuelCard } from "./InlinePlanDisplay";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";

interface Props {
  displayName: string;
  calories: number;
  weightKg: number;
  onContinue: () => void;
}

export function MaintenanceFuelSummary({ displayName, calories, weightKg, onContinue }: Props) {
  return (
    <div className="relative">
      <WizardAuroraBackground intensity="full" radialGlow />
      <div className="relative z-10 space-y-5">
        <div className="text-center space-y-1.5">
          <h1 className="text-2xl font-bold tracking-tight">You're all set, {displayName}</h1>
          <p className="text-sm text-muted-foreground">
            Here's your daily fuel to hold your weight.
          </p>
        </div>

        <DailyFuelCard
          maintenance={calories}
          target={calories}
          calories={calories}
          weightKg={weightKg}
        />

        <p className="text-sm text-muted-foreground text-center px-2 leading-relaxed">
          You're ready to log training, weight, meals and recovery from day one. No fight date, no cut plan, just your numbers.
        </p>

        <Button
          onClick={onContinue}
          className="no-tap-select w-full h-12 rounded-2xl cta-premium"
        >
          Enter the app
        </Button>
      </div>
    </div>
  );
}
