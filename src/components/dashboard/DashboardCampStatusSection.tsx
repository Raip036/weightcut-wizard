import { memo } from "react";
import { CutPaceForecast, type PlanData } from "@/components/dashboard/CutPaceForecast";
import { PhaseCoachCard } from "@/components/dashboard/PhaseCoachCard";

interface DashboardCampStatusSectionProps {
  weightLogs: Parameters<typeof CutPaceForecast>[0]["weightLogs"];
  currentWeight: number | null | undefined;
  goalWeight: number;
  targetDate: string;
  phase: Parameters<typeof PhaseCoachCard>[0]["phase"];
  daysUntilFight: number | null;
  plan?: PlanData | null;
}

export const DashboardCampStatusSection = memo(function DashboardCampStatusSection({
  weightLogs,
  currentWeight,
  goalWeight,
  targetDate,
  phase,
  daysUntilFight,
  plan,
}: DashboardCampStatusSectionProps) {
  return (
    <>
      <div className="pt-3 flex items-baseline justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">Camp Status</p>
      </div>
      <div className="space-y-2 -mt-2">
        <CutPaceForecast
          weightLogs={weightLogs}
          currentWeight={currentWeight ?? 0}
          goalWeight={goalWeight}
          targetDate={targetDate}
          plan={plan}
        />
        <PhaseCoachCard
          phase={phase}
          daysUntilFight={daysUntilFight}
          weightLogs={weightLogs}
          currentWeight={currentWeight ?? null}
          targetWeight={goalWeight}
          targetDateISO={targetDate}
        />
      </div>
    </>
  );
});

DashboardCampStatusSection.displayName = "DashboardCampStatusSection";
