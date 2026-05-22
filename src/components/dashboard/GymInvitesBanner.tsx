import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";

/**
 * Athlete-side dashboard banner that surfaces pending gym invites. Reads
 * `gym_members.listMyInvites` reactively — when the list goes empty the
 * banner unmounts automatically. Tapping the banner opens a Sheet with
 * accept/decline controls per invite.
 *
 * Backed by:
 *  - api.gym_members.listMyInvites (query)
 *  - api.gym_members.acceptGymInvite (mutation)
 *  - api.gym_members.declineGymInvite (mutation)
 * All three are verified to exist in convex/gym_members.ts.
 */
export function GymInvitesBanner() {
  const invites = useQuery(api.gym_members.listMyInvites);
  const acceptInvite = useMutation(api.gym_members.acceptGymInvite);
  const declineInvite = useMutation(api.gym_members.declineGymInvite);
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = invites ?? [];
  const count = list.length;
  const show = count > 0;

  const handleAccept = async (inviteId: string, gymName: string | null) => {
    triggerHaptic(ImpactStyle.Medium);
    setBusyId(inviteId);
    try {
      await acceptInvite({ inviteId: inviteId as Id<"gym_invites"> });
      toast({
        title: "Invite accepted",
        description: gymName ? `Joined ${gymName}` : "You joined the gym",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not accept invite";
      toast({ title: "Accept failed", description: msg, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (inviteId: string) => {
    triggerHaptic(ImpactStyle.Light);
    setBusyId(inviteId);
    try {
      await declineInvite({ inviteId: inviteId as Id<"gym_invites"> });
      toast({ title: "Invite declined" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not decline invite";
      toast({ title: "Decline failed", description: msg, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <AnimatePresence initial={false}>
        {show && (
          <motion.button
            key="gym-invites-banner"
            type="button"
            onClick={() => {
              triggerHaptic(ImpactStyle.Light);
              setOpen(true);
            }}
            aria-label={
              count === 1 ? "View gym invite" : `View ${count} gym invites`
            }
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            className="w-full rounded-xs border-2 border-primary bg-primary/[0.08] p-3 flex items-center gap-3 active:scale-[0.99] transition-all"
          >
            <span className="relative flex h-9 w-9 rounded-full items-center justify-center flex-shrink-0 bg-primary text-primary-foreground">
              <span
                className="absolute inset-0 rounded-full animate-ping bg-primary/40"
                aria-hidden
              />
              <Icon name="businessOutline" size={16} className="relative" />
              {count > 1 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center tabular-nums border border-background">
                  {count > 9 ? "9+" : count}
                </span>
              )}
            </span>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-[12px] font-semibold text-primary">
                {count === 1 ? "Gym invite pending" : `${count} gym invites pending`}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                Tap to accept or decline
              </p>
            </div>
            <Icon name="chevronForwardOutline" size={12} className="text-muted-foreground/40 flex-shrink-0" />
          </motion.button>
        )}
      </AnimatePresence>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl border-t border-border">
          <SheetHeader>
            <SheetTitle>Gym invites</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-2 pb-4">
            {list.length === 0 ? (
              <p className="text-[12px] text-muted-foreground text-center py-6">
                No pending invites.
              </p>
            ) : (
              // Cap at 5 to keep the sheet compact; remaining invites stay
              // queued and re-appear as the user clears the front of the list.
              list.slice(0, 5).map((invite) => {
                const isBusy = busyId === invite.id;
                return (
                  <div
                    key={invite.id}
                    className="card-surface rounded-xs border border-border p-3 space-y-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-xs bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Icon name="businessOutline" size={16} className="text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold truncate">
                          {invite.gym_name ?? "Unknown gym"}
                        </p>
                        <p className="text-[11px] text-muted-foreground capitalize">
                          Invited as {invite.member_role}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDecline(invite.id)}
                        disabled={isBusy}
                        className="flex-1 h-11 rounded-xs border border-border bg-muted/30 text-[13px] font-semibold active:scale-[0.99] transition-transform disabled:opacity-50"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAccept(invite.id, invite.gym_name)}
                        disabled={isBusy}
                        className="flex-1 h-11 rounded-xs bg-primary text-primary-foreground text-[13px] font-semibold active:scale-[0.99] transition-transform inline-flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {isBusy && <Icon name="refreshOutline" size={16} className="animate-spin" />}
                        Accept
                      </button>
                    </div>
                  </div>
                );
              })
            )}
            {list.length > 5 && (
              <p className="text-[11px] text-muted-foreground text-center pt-1">
                Showing 5 of {list.length}. Resolve these to see more.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
