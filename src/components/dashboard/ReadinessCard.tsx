import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";
import Sparkline from "@/components/charts/Sparkline";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";

interface ReadinessCardProps {
  userId: string | null | undefined;
}

// Readiness bands (0–100) mirror the performance-engine action-line
// thresholds so the dashboard verdict matches the Recovery page copy.
function verdictFor(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Peaked", color: "text-func-recovery-green" };
  if (score >= 55) return { label: "Ready", color: "text-primary" };
  if (score >= 35) return { label: "Recovering", color: "text-func-warning-yellow" };
  return { label: "Rest", color: "text-func-danger-red" };
}

/**
 * Dashboard "Readiness" metric card. Surfaces the latest daily wellness
 * check-in's readinessScore (0–100) with a verdict band, a trend sparkline,
 * and a last-check-in delta. Visually identical to the WEIGHT / SLEEP cards —
 * neutral number, semantic colour reserved for the small verdict + delta so
 * the stat grid stays cohesive. Taps through to the Recovery page.
 */
export function ReadinessCard({ userId }: ReadinessCardProps) {
  const navigate = useNavigate();
  // The whole Recovery surface is Pro-only — surface a lock badge so it
  // reads as gated at a glance (the route gate enforces it on tap).
  const { hasAccess } = useFeatureAccess("RECOVERY");
  const rows = useQuery(
    api.wellness.listCheckins,
    userId ? { limit: 14 } : "skip",
  );

  // Keep only check-ins that carry a readiness score, newest-first.
  const scored = (rows ?? []).filter(
    (r): r is typeof r & { readinessScore: number } =>
      typeof r.readinessScore === "number",
  );
  const asc = [...scored].reverse(); // oldest → newest for the sparkline
  const recent = asc.slice(-7);
  const series = recent.map((r) => r.readinessScore);
  const latest = scored[0] ?? null;
  const prev = scored[1] ?? null;
  const delta =
    latest && prev ? latest.readinessScore - prev.readinessScore : null;
  const hasData = series.length >= 2;
  const verdict = latest ? verdictFor(latest.readinessScore) : null;

  return (
    <button
      type="button"
      onClick={() => {
        triggerHapticSelection();
        navigate("/recovery");
      }}
      className="card-surface rounded-2xl p-3 aspect-square flex flex-col text-left card-press min-w-0 w-full overflow-hidden"
    >
      <div className="flex items-start justify-between w-full">
        <span className="text-micro font-normal uppercase tracking-[0.08em] text-muted-foreground">
          RECOVERY
        </span>
        {hasAccess ? (
          <Icon name="chevronForwardOutline" size={14} className="text-muted-foreground/40" />
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5">
            <Icon name="lockClosedOutline" size={10} className="text-primary" />
            <span className="text-[9px] font-bold uppercase tracking-wide text-primary">Pro</span>
          </span>
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-display font-bold text-[40px] leading-none text-foreground tabular-nums">
          {latest ? Math.round(latest.readinessScore) : "—"}
        </span>
        {verdict && (
          <span className={`text-note font-semibold ${verdict.color}`}>
            {verdict.label}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 mt-2">
        {hasData ? (
          <Sparkline data={series} className="h-full w-full" />
        ) : (
          <div className="flex flex-col items-center justify-end h-full text-center pb-0.5">
            <Icon name="pulseOutline" size={20} className="text-muted-foreground/40 mb-1" />
            <p className="text-note text-muted-foreground">No data yet</p>
          </div>
        )}
      </div>

      {/* Footer — last check-in delta, right-aligned to match siblings. */}
      <div className="mt-1.5 flex items-center justify-end">
        <div className="flex items-center gap-1.5">
          {delta != null && Math.abs(delta) >= 1 && (() => {
            const isUp = delta > 0; // higher readiness is better
            return (
              <div className={`flex items-center gap-0.5 text-micro font-medium tabular-nums ${isUp ? "text-func-recovery-green" : "text-func-danger-red"}`}>
                <Icon
                  name="trendingDownOutline"
                  size={12}
                  className={isUp ? "rotate-180" : ""}
                />
                <span>{Math.abs(Math.round(delta))}</span>
              </div>
            );
          })()}
        </div>
      </div>
    </button>
  );
}
