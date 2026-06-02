/**
 * Coach's home for a single athlete.
 *
 * Layout: profile hero (avatar + ring + key facts) → 2x2 chart grid
 * (readiness / weight / training load / sleep) → recent sessions list
 * → secondary insight panels (fight target, fight form breakdown,
 * prescribe path) → coach actions.
 *
 * All data comes from a single Convex query via `useAthleteDetail`
 * (`coach.athleteDetail`). No extra fetches added here — anything the
 * hook doesn't surface degrades gracefully to "no data" in the relevant
 * chart card.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useUser } from "@/contexts/UserContext";
import { useAthleteDetail } from "@/hooks/coach/useAthleteDetail";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { globalLoading } from "@/lib/globalLoading";
import { logger } from "@/lib/logger";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FightTargetBadge } from "@/components/coach/FightTargetBadge";
import { FightFormPanel } from "@/components/coach/FightFormPanel";
import ErrorBoundary from "@/components/ErrorBoundary";
import { registerPullRefresh } from "@/lib/pullRefreshRegistry";
import { AthleteHero } from "@/components/coach/athlete/AthleteHero";
import { AthleteChartCard } from "@/components/coach/athlete/AthleteChartCard";
import { AthleteSessionsList } from "@/components/coach/athlete/AthleteSessionsList";
import { AthleteDetailSkeleton } from "@/components/coach/athlete/AthleteDetailSkeleton";
import {
  buildChartCards,
  deriveAthleteMetrics,
} from "@/components/coach/athlete/athleteChartConfigs";

export default function AthleteDetail() {
  const { id: athleteId } = useParams<{ id: string }>();
  const { userId, profile } = useUser();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, loading, error, refresh } = useAthleteDetail(
    userId,
    athleteId ?? null,
  );
  const removeAthlete = useMutation(api.gym_members.removeAthleteFromMyGyms);

  useEffect(() => registerPullRefresh(() => refresh()), [refresh]);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  const derived = useMemo(() => deriveAthleteMetrics(data), [data]);
  const cards = useMemo(
    () => (derived && data ? buildChartCards(derived, data) : null),
    [derived, data],
  );

  // Block unauthorised viewers — only coaches reach this route.
  if (profile && profile.role !== "coach") {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-[13px] text-muted-foreground">Coach access only.</p>
      </div>
    );
  }

  if (loading && !data) return <AthleteDetailSkeleton />;

  if (error || !data || !data.profile || !derived || !cards) {
    return (
      <div
        className="animate-page-in px-5 pb-6 max-w-2xl mx-auto space-y-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.5rem)" }}
      >
        <button
          onClick={() => navigate("/coach")}
          className="inline-flex items-center gap-1 text-[13px] text-primary"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <div className="glass-card p-6 text-center">
          <p className="text-[13px] font-semibold mb-1">
            Athlete not available
          </p>
          <p className="text-[12px] text-muted-foreground leading-snug">
            {error || "They may have left your gym or paused sharing."}
          </p>
        </div>
      </div>
    );
  }

  const { ath, target } = derived;

  const handleRemove = async () => {
    if (!userId || !athleteId) return;
    setRemoving(true);
    globalLoading.show("Removing athlete…");
    try {
      await removeAthlete({ athleteUserId: athleteId as Id<"users"> });
      triggerHaptic(ImpactStyle.Medium);
      setRemoveDialogOpen(false);
      toast({ title: "Athlete removed from gym" });
      navigate("/coach", { replace: true });
      globalLoading.hideAfterPaint();
    } catch (err: any) {
      logger.error("AthleteDetail: remove failed", err);
      globalLoading.hide();
      toast({
        title: "Could not remove athlete",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <ErrorBoundary>
      <div
        className="animate-page-in space-y-3 px-5 pb-3 sm:px-5 sm:pb-5 md:px-6 md:pb-6 w-full max-w-2xl mx-auto"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)",
        }}
      >
        {/* Back row — minimal, so the hero can carry the page identity */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate("/coach")}
            className="-ml-2 p-2 rounded-xs active:bg-muted/50 transition-colors inline-flex items-center gap-1 text-[13px] text-muted-foreground"
            aria-label="Back to coach dashboard"
          >
            <ChevronLeft className="h-5 w-5" />
            <span>Back</span>
          </button>
        </div>

        <AthleteHero
          name={ath.display_name}
          avatarUrl={ath.avatar_url}
          athleteType={ath.athlete_type}
          goalType={ath.goal_type}
          currentWeightKg={ath.current_weight_kg}
          targetWeightKg={target}
          targetDate={ath.target_date}
          membershipGym={data.membership?.gym_name ?? null}
          fightForm={data.fight_form}
        />

        {/* Fight-form score panel — sits directly under the hero so the
            coach's first read-down is the current readiness picture. */}
        {data.fight_form && (
          <FightFormPanel
            fightForm={data.fight_form}
            trend={data.fight_form_trend}
          />
        )}

        {/* 2x2 chart grid — at-a-glance health of the four pillars */}
        <div className="grid grid-cols-2 gap-3">
          <AthleteChartCard {...cards.readiness} index={0} />
          <AthleteChartCard {...cards.weight} index={1} />
          <AthleteChartCard {...cards.training} index={2} />
          <AthleteChartCard {...cards.sleep} index={3} />
        </div>

        {/* Recent training feed — last 10 sessions */}
        <AthleteSessionsList
          sessions={data.recent_sessions ?? []}
          index={4}
        />

        {/* Secondary insight panel — fight target badge stays at the
            bottom as a deeper-context surface. */}
        {ath.target_date && (
          <FightTargetBadge
            targetDate={ath.target_date}
            fightWeekTargetKg={ath.fight_week_target_kg}
            goalWeightKg={ath.goal_weight_kg}
            currentWeightKg={ath.current_weight_kg}
            goalType={ath.goal_type}
            variant="card"
          />
        )}

        {/* Coach actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            disabled
            className="flex-1 h-10 rounded-xs bg-muted/40 text-muted-foreground/60 text-[12px] font-medium cursor-not-allowed"
          >
            Send check-in · soon
          </button>
          <button
            onClick={() => setRemoveDialogOpen(true)}
            className="h-10 px-3 rounded-xs text-[12px] font-medium text-destructive active:bg-destructive/10 transition-colors"
          >
            Remove
          </button>
        </div>
      </div>

      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center">
              Remove athlete from gym?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              They'll lose access to your coaching feedback. They can rejoin
              with the invite code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-center sm:justify-center gap-2">
            <AlertDialogCancel disabled={removing} className="mt-0">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={removing}
              className="bg-destructive hover:bg-destructive/90"
            >
              {removing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Remove"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ErrorBoundary>
  );
}
