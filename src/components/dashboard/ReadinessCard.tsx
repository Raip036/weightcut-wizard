import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";
import Sparkline from "@/components/charts/Sparkline";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useRecoveryReadiness } from "@/hooks/useRecoveryReadiness";
import { ShimmerCrownBadge } from "@/components/subscription/ShimmerCrownBadge";

interface ReadinessCardProps {
  userId: string | null | undefined;
}

// Readiness bands (0-100) mirror the performance-engine action-line
// thresholds so the dashboard verdict matches the Recovery page copy.
function verdictFor(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Peaked", color: "text-func-recovery-green" };
  if (score >= 55) return { label: "Ready", color: "text-primary" };
  if (score >= 35) return { label: "Recovering", color: "text-func-warning-yellow" };
  return { label: "Rest", color: "text-func-danger-red" };
}

/**
 * Dashboard "Readiness" metric card. Surfaces the latest daily wellness
 * check-in's readinessScore (0-100) with a verdict band, a trend sparkline,
 * and a last-check-in delta. Visually identical to the WEIGHT / SLEEP cards:
 * neutral number, semantic colour reserved for the small verdict + delta so
 * the stat grid stays cohesive. Taps through to the Recovery page.
 */
export function ReadinessCard({ userId }: ReadinessCardProps) {
  const navigate = useNavigate();
  // The whole Recovery surface is Pro-only, surface a lock badge so it
  // reads as gated at a glance (the route gate enforces it on tap).
  const { hasAccess } = useFeatureAccess("RECOVERY");
  const rows = useQuery(
    api.wellness.listCheckins,
    userId ? { limit: 14 } : "skip",
  );
  // Live readiness, the SAME number the Recovery page hero shows. Skip the
  // compute for free users (they never see the number, just the Pro gate).
  const { score: liveScore } = useRecoveryReadiness(hasAccess ? userId : null);

  const today = new Date().toISOString().split("T")[0];

  // Persisted readiness history (carries each day's score once /recovery has
  // computed it), used to draw the multi-day line.
  const scored = (rows ?? []).filter(
    (r): r is typeof r & { readinessScore: number } =>
      typeof r.readinessScore === "number",
  );
  const asc = [...scored].reverse(); // oldest → newest
  // Build the line from prior days + today's LIVE score so the line always
  // ends on the number we're displaying (and never double-counts today).
  const priorScores = asc.filter((r) => r.date !== today).map((r) => r.readinessScore);
  const series =
    liveScore != null ? [...priorScores, liveScore].slice(-7) : asc.map((r) => r.readinessScore).slice(-7);

  // Displayed number: prefer the live engine score; fall back to the latest
  // persisted score; only show a dash when there's genuinely nothing.
  const latest = scored[0] ?? null;
  const displayScore = liveScore != null ? liveScore : latest ? latest.readinessScore : null;

  const prevPersisted = asc.filter((r) => r.date !== today).slice(-1)[0] ?? null;
  const delta =
    liveScore != null && prevPersisted
      ? liveScore - prevPersisted.readinessScore
      : null;
  const hasData = series.length >= 2;
  const verdict = displayScore != null ? verdictFor(displayScore) : null;

  return (
    <button
      type="button"
      onClick={() => {
        triggerHapticSelection();
        navigate("/recovery");
      }}
      className="relative card-surface rounded-2xl p-3 aspect-square flex flex-col text-left card-press min-w-0 w-full overflow-hidden"
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

      {hasAccess ? (
        <>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-display font-bold text-[40px] leading-none text-foreground tabular-nums">
              {displayScore != null ? Math.round(displayScore) : "-"}
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
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Icon name="pulseOutline" size={20} className="text-muted-foreground/40 mb-1" />
                <p className="text-note text-muted-foreground">No data yet</p>
              </div>
            )}
          </div>

          {/* Footer row: 7-day avg (left) + signed delta (right) */}
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-micro text-muted-foreground tabular-nums">
              {series.length >= 2 ? `avg ${Math.round(series.reduce((a, b) => a + b, 0) / series.length)}` : ""}
            </span>
            {delta != null && Math.abs(delta) >= 1 && (() => {
              const isUp = delta > 0; // higher readiness is better
              return (
                <span className={`text-micro font-semibold tabular-nums leading-none ${isUp ? "text-func-recovery-green" : "text-func-danger-red"}`}>
                  {isUp ? "+" : "−"}{Math.abs(Math.round(delta))}
                </span>
              );
            })()}
          </div>
        </>
      ) : (
        // Free users never see the score, render an aesthetic crown gate
        // instead (the number is not in the DOM). Absolutely centered over the
        // whole card so it's optically dead-centre regardless of the header.
        // Taps through to the animated Recovery Pro gate at /recovery.
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center gap-2 px-2">
          <ShimmerCrownBadge size={34} />
          <div>
            <p className="text-note font-semibold text-foreground leading-tight">Recovery is Pro</p>
            <p className="text-micro text-muted-foreground leading-snug mt-0.5">Tap to unlock</p>
          </div>
        </div>
      )}
    </button>
  );
}
