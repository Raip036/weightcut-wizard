import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, ChevronRight, Share2 } from "lucide-react";
import { useUser } from "@/contexts/UserContext";
import { useMyGyms, type MyGymRow } from "@/hooks/coach/useMyGyms";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { globalLoading } from "@/lib/globalLoading";
import { logger } from "@/lib/logger";
import { DashboardSkeleton } from "@/components/ui/skeleton-loader";
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
import { GymLogoAvatar } from "@/components/coach/GymLogoAvatar";
import { AnnouncementsSection } from "@/components/coach/AnnouncementsSection";
import { LeaderboardSection } from "@/components/leaderboard/LeaderboardSection";
import ErrorBoundary from "@/components/ErrorBoundary";

export default function MyGym() {
  const { userId } = useUser();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { gyms, loading } = useMyGyms(userId);
  const setShareData = useMutation(api.gym_members.setShareData);
  const leaveGym = useMutation(api.gym_members.removeMember);
  const [pendingShareToggle, setPendingShareToggle] = useState<string | null>(null);
  const [leaveTarget, setLeaveTarget] = useState<MyGymRow | null>(null);
  const [leaving, setLeaving] = useState(false);

  if (loading && gyms.length === 0) return <DashboardSkeleton />;

  const handleToggleShare = async (gym: MyGymRow, next: boolean) => {
    if (!userId) return;
    setPendingShareToggle(gym.member_id);
    triggerHaptic(ImpactStyle.Light);
    try {
      await setShareData({
        memberId: gym.member_id as Id<"gym_members">,
        shareData: next,
      });
      toast({
        title: next ? "Sharing enabled" : "Sharing paused",
        description: next ? "Your coach can see your data again." : "Your coach can't see your data until re-enabled.",
      });
    } catch (err: any) {
      logger.error("MyGym: toggle share failed", err);
      toast({ title: "Could not update sharing", variant: "destructive" });
    } finally {
      setPendingShareToggle(null);
    }
  };

  const handleLeave = async () => {
    if (!userId || !leaveTarget) return;
    setLeaving(true);
    const target = leaveTarget;
    globalLoading.show(`Leaving ${target.gym_name}…`);
    try {
      await leaveGym({ memberId: target.member_id as Id<"gym_members"> });
      triggerHaptic(ImpactStyle.Medium);
      setLeaveTarget(null);
      globalLoading.hide();
      toast({ title: `Left ${target.gym_name}` });
    } catch (err: any) {
      logger.error("MyGym: leave failed", err);
      globalLoading.hide();
      toast({ title: "Could not leave gym", description: err?.message, variant: "destructive" });
    } finally {
      setLeaving(false);
    }
  };

  return (
    <ErrorBoundary>
      <div
        className="space-y-4 px-5 py-3 sm:p-5 md:p-6 w-full max-w-2xl mx-auto"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}
      >
        <h1 className="text-[28px] font-bold tracking-tight">Your gym</h1>

        {/* Live announcements from coach (broadcast + targeted) */}
        {gyms.length > 0 && (
          <AnnouncementsSection gymIds={gyms.map((g) => g.gym_id)} />
        )}

        {gyms.length === 0 ? (
          <div className="rounded-xs bg-card/60 border border-border/40 p-6 text-center">
            <p className="text-[15px] font-semibold mb-1">Join your coach's gym</p>
            <p className="text-[13px] text-muted-foreground leading-snug mb-4">
              Enter the 6-character invite code from your coach.
            </p>
            <button
              onClick={() => navigate("/join")}
              className="h-11 px-5 rounded-xs bg-primary text-primary-foreground text-[14px] font-semibold active:scale-[0.98] transition-transform"
            >
              Enter invite code
            </button>
          </div>
        ) : (
          gyms.map((gym) => (
            <GymCard
              key={gym.member_id}
              gym={gym}
              pendingShare={pendingShareToggle === gym.member_id}
              onShareToggle={(v) => handleToggleShare(gym, v)}
              onOpenFeed={() => navigate(`/gym-feed?gym=${gym.gym_id}`)}
              onLeave={() => setLeaveTarget(gym)}
            />
          ))
        )}
      </div>

      <AlertDialog open={!!leaveTarget} onOpenChange={(o) => !o && setLeaveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center">Leave {leaveTarget?.gym_name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              Your coach will lose access to your data. You can rejoin later with a new invite code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-center sm:justify-center gap-2">
            <AlertDialogCancel disabled={leaving} className="mt-0">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleLeave} disabled={leaving} className="bg-destructive hover:bg-destructive/90">
              {leaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Leave"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ErrorBoundary>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Member ID card hero — big logo, name, coach/location, stats belt, then
// quick-action rows for feed + share + leave. Leaderboard sits below.
// ─────────────────────────────────────────────────────────────────────

function GymCard({
  gym, pendingShare, onShareToggle, onOpenFeed, onLeave,
}: {
  gym: MyGymRow;
  pendingShare: boolean;
  onShareToggle: (v: boolean) => void;
  onOpenFeed: () => void;
  onLeave: () => void;
}) {
  // Reuse the leaderboard query for member count + viewer rank so the
  // hero stats stay coherent with what the leaderboard below displays.
  const leaderboard = useQuery(api.gymLeaderboard.weekly, {
    gymId: gym.gym_id as Id<"gyms">,
    discipline: undefined,
  });
  const memberCount = leaderboard?.totalRankedFighters ?? null;
  const myRank = leaderboard?.myRank?.rank ?? null;
  const joined = new Date(gym.joined_at).toLocaleDateString("en-US", { month: "short", year: "numeric" });

  return (
    <section className="space-y-4">
      {/* Hero — member ID card */}
      <div className="rounded-xs bg-card/60 border border-border/40 overflow-hidden">
        <div className="p-5 flex items-center gap-4">
          <GymLogoAvatar logoUrl={gym.gym_logo_url} name={gym.gym_name} size={64} />
          <div className="min-w-0 flex-1">
            <p className="text-[19px] font-bold tracking-tight leading-tight truncate">{gym.gym_name}</p>
            {gym.gym_location && (
              <p className="text-[12px] text-muted-foreground mt-0.5 truncate">{gym.gym_location}</p>
            )}
            <p className="text-[12px] text-muted-foreground/90 mt-0.5 truncate">
              Coach <span className="text-foreground font-medium">{gym.coach_name ?? "—"}</span>
              <span className="mx-1.5 text-muted-foreground/50">·</span>
              <span className="text-muted-foreground/80">Joined {joined}</span>
            </p>
          </div>
        </div>

        {/* Stats belt — Members / Your rank. Hidden when both values are
            unavailable so we don't show a row of em-dashes. */}
        {leaderboard !== null && (
          <div className="grid grid-cols-2 border-t border-border/40 divide-x divide-border/40">
            <div className="py-3 px-2 text-center">
              <p className="text-[22px] font-bold tabular-nums tracking-tight">
                {memberCount ?? "—"}
              </p>
              <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70 mt-0.5">
                {memberCount === 1 ? "Member" : "Members"}
              </p>
            </div>
            <div className="py-3 px-2 text-center">
              <p className="text-[22px] font-bold tabular-nums tracking-tight text-primary">
                {myRank != null ? `#${myRank}` : "—"}
              </p>
              <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70 mt-0.5">
                Your rank
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Quick actions group */}
      <div className="rounded-xs bg-card/60 border border-border/40 overflow-hidden divide-y divide-border/30">
        <button
          type="button"
          onClick={() => { triggerHaptic(ImpactStyle.Light); onOpenFeed(); }}
          className="w-full min-h-[56px] flex items-center gap-3 px-4 py-3 text-left active:bg-muted/40 transition-colors"
        >
          <div className="h-9 w-9 rounded-xs bg-primary/15 flex items-center justify-center shrink-0">
            <Share2 className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-medium leading-tight">Gym feed</p>
            <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug truncate">
              See what your gym is training
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground/60 shrink-0" />
        </button>

        <div className="min-h-[56px] flex items-center gap-3 px-4 py-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-medium leading-tight">Share data with coach</p>
            <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
              Pause this to hide your weight, meals, and training.
            </p>
          </div>
          <Switch
            checked={gym.share_data}
            onCheckedChange={onShareToggle}
            disabled={pendingShare}
            aria-label="Share data with coach"
          />
        </div>

        <button
          type="button"
          onClick={onLeave}
          className="w-full min-h-[52px] flex items-center gap-3 px-4 py-2.5 text-left active:bg-destructive/10 transition-colors"
        >
          <p className="flex-1 text-[15px] font-medium text-destructive">Leave gym</p>
          <ChevronRight className="h-4 w-4 text-destructive/60 shrink-0" />
        </button>
      </div>

      {/* Weekly training-volume leaderboard for this gym */}
      <LeaderboardSection
        gymId={gym.gym_id as Id<"gyms">}
        viewer="athlete"
      />
    </section>
  );
}
