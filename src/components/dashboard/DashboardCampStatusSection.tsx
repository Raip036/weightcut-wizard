import { memo } from "react";
import { CutPaceForecast, type PlanData } from "@/components/dashboard/CutPaceForecast";
import { PhaseCoachCard } from "@/components/dashboard/PhaseCoachCard";
import { useInView } from "@/hooks/useInView";

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
  // This section sits below the fold, so the dashboard's mount-time
  // entrance animation would fade the widgets up while they're still out
  // of sight. Gate the reveal on the section actually scrolling into view
  // so the user sees the motion. `dashboard-enter-stagger` then staggers
  // the heading + cards; `opacity-0` keeps them hidden until then.
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div ref={ref} className={inView ? "dashboard-enter-stagger" : "opacity-0"}>
      <div className="space-y-2 pt-3">
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
          plan={plan}
        />
      </div>
    </div>
  );
});

DashboardCampStatusSection.displayName = "DashboardCampStatusSection";
