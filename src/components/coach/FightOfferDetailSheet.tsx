/**
 * Coach-facing detail sheet for a fight offer.
 *
 * Shows the structured offer header, every fighter's response, and a
 * single CTA per row to pick that fighter. The list is sorted YES →
 * MAYBE → PASS, then by absolute weight delta to the offer's class so
 * the fighter closest to weight (and most eager) sits at the top.
 *
 * Picking a fighter calls `selectFighter` which auto-creates a fight
 * camp pre-populated with the offer's date + weight class and patches
 * the fighter's profile target. If the fighter already has an
 * unfinished camp, the API returns `skippedCampCreation: true` and we
 * surface that as a non-blocking toast so the coach knows to resolve
 * it manually.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Loader2, Trophy, Calendar, MapPin, Swords, CheckCircle2, Trash2,
  RotateCcw, UserPlus, X,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic, celebrateSuccess } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { logger } from "@/lib/logger";

interface Props {
  offerId: Id<"fight_offers"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SIGNAL_LABEL: Record<"yes" | "maybe" | "pass", string> = {
  yes: "I'm in",
  maybe: "Maybe",
  pass: "Pass",
};

const SIGNAL_ORDER: Record<"yes" | "maybe" | "pass", number> = {
  yes: 0,
  maybe: 1,
  pass: 2,
};

function formatOfferDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function FightOfferDetailSheet({ offerId, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const data = useQuery(api.fight_offers.getOffer, offerId ? { offerId } : "skip");
  const selectFighter = useMutation(api.fight_offers.selectFighter);
  const changeFighter = useMutation(api.fight_offers.changeFighter);
  const withdrawOffer = useMutation(api.fight_offers.withdrawOffer);
  const reopenOffer = useMutation(api.fight_offers.reopenOffer);
  const deleteOffer = useMutation(api.fight_offers.deleteOffer);
  const [picking, setPicking] = useState<string | null>(null);
  const [confirmingFighter, setConfirmingFighter] = useState<{
    userId: Id<"users">;
    displayName: string;
    kind: "select" | "change";
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyAction, setBusyAction] = useState<"reopen" | "withdraw" | "delete" | null>(null);

  const ranked = useMemo(() => {
    if (!data) return [];
    const wc = data.weight_class_kg;
    return [...data.interests].sort((a, b) => {
      const orderDelta = SIGNAL_ORDER[a.signal] - SIGNAL_ORDER[b.signal];
      if (orderDelta !== 0) return orderDelta;
      const aw =
        a.current_weight_kg != null ? Math.abs(a.current_weight_kg - wc) : Infinity;
      const bw =
        b.current_weight_kg != null ? Math.abs(b.current_weight_kg - wc) : Infinity;
      return aw - bw;
    });
  }, [data]);

  const grouped = useMemo(() => {
    const out: Record<"yes" | "maybe" | "pass", typeof ranked> = {
      yes: [],
      maybe: [],
      pass: [],
    };
    for (const r of ranked) out[r.signal].push(r);
    return out;
  }, [ranked]);

  const handlePick = async (
    userId: Id<"users">,
    displayName: string,
    mode: "select" | "change",
  ) => {
    if (!offerId) return;
    triggerHaptic(ImpactStyle.Medium);
    setPicking(userId);
    try {
      const result = mode === "select"
        ? await selectFighter({ offerId, fighterUserId: userId })
        : await changeFighter({ offerId, newFighterUserId: userId });
      celebrateSuccess();
      if (result?.skippedCampCreation) {
        toast({
          title: mode === "change" ? `Reassigned to ${displayName}` : `Offered to ${displayName}`,
          description:
            "They already have an active fight camp — resolve it in their profile.",
        });
      } else {
        toast({
          title: mode === "change" ? `Reassigned to ${displayName}` : `Offered to ${displayName}`,
          description: "Fight camp opened with the offer's date + weight class.",
        });
      }
      setConfirmingFighter(null);
      if (mode === "select") onOpenChange(false);
    } catch (err: any) {
      logger.warn("FightOfferDetailSheet: pick failed", err);
      toast({
        title: "Couldn't update the offer",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setPicking(null);
    }
  };

  const handleWithdraw = async () => {
    if (!offerId) return;
    triggerHaptic(ImpactStyle.Medium);
    setBusyAction("withdraw");
    try {
      await withdrawOffer({ offerId });
      toast({ title: "Offer withdrawn" });
      onOpenChange(false);
    } catch (err: any) {
      logger.warn("FightOfferDetailSheet: withdraw failed", err);
      toast({
        title: "Couldn't withdraw",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleReopen = async () => {
    if (!offerId) return;
    triggerHaptic(ImpactStyle.Medium);
    setBusyAction("reopen");
    try {
      await reopenOffer({ offerId });
      toast({
        title: "Offer reopened",
        description: "The picked fighter was notified.",
      });
    } catch (err: any) {
      logger.warn("FightOfferDetailSheet: reopen failed", err);
      toast({
        title: "Couldn't reopen",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async () => {
    if (!offerId) return;
    triggerHaptic(ImpactStyle.Medium);
    setBusyAction("delete");
    try {
      await deleteOffer({ offerId });
      toast({ title: "Offer deleted" });
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (err: any) {
      logger.warn("FightOfferDetailSheet: delete failed", err);
      toast({
        title: "Couldn't delete",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] [&>button]:hidden max-h-[88vh] flex flex-col"
      >
        <div className="flex justify-center pt-1 pb-3 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
        </div>

        <SheetHeader className="px-1 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
              <Trophy className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base font-semibold text-left leading-tight">
                Fight offer
              </SheetTitle>
              <p className="text-[11px] text-muted-foreground/80 text-left mt-0.5">
                {data ? formatOfferDate(data.fight_date) : "—"}
              </p>
            </div>
          </div>
        </SheetHeader>

        {!data ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-1">
            {/* Header card — date / weight class / meta */}
            <div className="card-surface rounded-xs border border-border p-3 space-y-2">
              <div className="flex items-baseline gap-3">
                <span className="text-[22px] font-semibold tabular-nums leading-none">
                  {new Date(data.fight_date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <span className="text-[18px] font-semibold tabular-nums leading-none text-primary">
                  {data.weight_class_kg.toFixed(1)}kg
                </span>
                {data.status === "filled" && (
                  <span className="ml-auto px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[9px] uppercase tracking-wider font-semibold">
                    Filled
                  </span>
                )}
                {data.status === "withdrawn" && (
                  <span className="ml-auto px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground text-[9px] uppercase tracking-wider font-semibold">
                    Withdrawn
                  </span>
                )}
              </div>
              {(data.event_name || data.location || data.opponent_name) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-foreground/80">
                  {data.event_name && (
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3 text-muted-foreground" />
                      {data.event_name}
                    </span>
                  )}
                  {data.location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-muted-foreground" />
                      {data.location}
                    </span>
                  )}
                  {data.opponent_name && (
                    <span className="inline-flex items-center gap-1">
                      <Swords className="h-3 w-3 text-muted-foreground" />
                      vs {data.opponent_name}
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-3 text-[11px] pt-1">
                <span className="text-emerald-400 font-semibold">
                  {grouped.yes.length} yes
                </span>
                <span className="text-amber-400 font-semibold">
                  {grouped.maybe.length} maybe
                </span>
                <span className="text-muted-foreground/70 font-semibold">
                  {grouped.pass.length} pass
                </span>
              </div>
            </div>

            {/* Responses */}
            {ranked.length === 0 ? (
              <div className="card-surface rounded-xs border border-dashed border-border p-6 text-center">
                <p className="text-[13px] font-semibold mb-1">No responses yet</p>
                <p className="text-[12px] text-muted-foreground leading-snug">
                  Fighters will appear here as they tap in.
                </p>
              </div>
            ) : (
              (["yes", "maybe", "pass"] as const).map((bucket) => {
                const rows = grouped[bucket];
                if (rows.length === 0) return null;
                return (
                  <div key={bucket}>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1.5 px-1">
                      {SIGNAL_LABEL[bucket]} · {rows.length}
                    </p>
                    <div className="card-surface rounded-xs border border-border overflow-hidden divide-y divide-border/40">
                      {rows.map((r) => {
                        const delta =
                          r.current_weight_kg != null
                            ? +(r.current_weight_kg - data.weight_class_kg).toFixed(1)
                            : null;
                        const isOpen = data.status === "open";
                        const isPicked =
                          data.selected_fighter_user_id === r.user_id;
                        return (
                          <div
                            key={r.user_id}
                            className={`flex items-center gap-3 px-3 py-2.5 min-h-[56px] ${
                              isPicked ? "bg-primary/5" : ""
                            }`}
                          >
                            {/* Initials avatar — keeps the row light without a network round-trip per row. */}
                            <div className="h-9 w-9 rounded-full bg-muted/40 flex items-center justify-center text-[12px] font-semibold uppercase text-foreground/80 flex-shrink-0">
                              {r.display_name.slice(0, 2)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] font-medium truncate">
                                  {r.display_name}
                                </span>
                                {isPicked && (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 text-[11px] tabular-nums">
                                {r.current_weight_kg != null ? (
                                  <span className="text-foreground/70">
                                    {r.current_weight_kg.toFixed(1)}kg
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/60">no weight</span>
                                )}
                                {delta != null && (
                                  <span
                                    className={
                                      Math.abs(delta) < 0.1
                                        ? "text-emerald-400 font-semibold"
                                        : delta > 0
                                        ? "text-amber-500 font-semibold"
                                        : "text-emerald-400 font-semibold"
                                    }
                                  >
                                    {Math.abs(delta) < 0.1
                                      ? "0.0"
                                      : delta > 0
                                      ? `+${delta.toFixed(1)}`
                                      : `−${Math.abs(delta).toFixed(1)}`}
                                  </span>
                                )}
                              </div>
                            </div>
                            {(isOpen || data.status === "filled") &&
                              bucket !== "pass" &&
                              !isPicked && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmingFighter({
                                      userId: r.user_id as Id<"users">,
                                      displayName: r.display_name,
                                      kind: isOpen ? "select" : "change",
                                    })
                                  }
                                  disabled={picking === r.user_id}
                                  className="h-8 px-3 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold active:scale-[0.97] transition-transform disabled:opacity-50 flex-shrink-0 inline-flex items-center gap-1"
                                >
                                  {picking === r.user_id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : isOpen ? (
                                    "Offer"
                                  ) : (
                                    "Reassign"
                                  )}
                                </button>
                              )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}

            {/* Coach action row. Adapts to offer status:
                 - open: Withdraw + Delete
                 - filled: Reopen + Withdraw + Delete
                 - withdrawn: Delete only
                Reassignment to a different fighter is done from each
                response row above. */}
            <div className="grid grid-cols-2 gap-2 mt-2">
              {data.status === "filled" && (
                <button
                  type="button"
                  onClick={handleReopen}
                  disabled={busyAction !== null}
                  className="col-span-2 h-10 rounded-xs bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-foreground/85 text-[12px] font-semibold active:scale-[0.99] transition-transform inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {busyAction === "reopen" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  Reopen offer
                </button>
              )}
              {data.status !== "withdrawn" && (
                <button
                  type="button"
                  onClick={handleWithdraw}
                  disabled={busyAction !== null}
                  className="h-10 rounded-xs text-amber-400 text-[12px] font-semibold active:scale-[0.99] transition-transform inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {busyAction === "withdraw" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                  Withdraw
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={busyAction !== null}
                className={`h-10 rounded-xs text-destructive text-[12px] font-semibold active:scale-[0.99] transition-transform inline-flex items-center justify-center gap-1.5 disabled:opacity-50 ${
                  data.status === "withdrawn" ? "col-span-2" : ""
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete offer
              </button>
            </div>
          </div>
        )}

        {/* Inline confirm bar — sticky at the bottom so the coach doesn't get
            dropped out of the offer detail flow. Copy adapts to whether
            we're selecting for the first time or reassigning. */}
        {confirmingFighter && data && (
          <div className="border-t border-border/60 bg-background/95 backdrop-blur-md px-3 pt-3 pb-1 shrink-0">
            <p className="text-[12px] text-foreground/85 mb-2 leading-snug">
              {confirmingFighter.kind === "change" ? "Reassign" : "Offer"} this fight to{" "}
              <span className="font-semibold">{confirmingFighter.displayName}</span>?
              {" "}
              {confirmingFighter.kind === "change"
                ? "The previously picked fighter will be notified that the slot moved."
                : `We'll open a fight camp on ${new Date(data.fight_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${data.weight_class_kg.toFixed(1)}kg.`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmingFighter(null)}
                disabled={picking === confirmingFighter.userId}
                className="flex-1 h-10 rounded-xs bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-foreground/85 text-[13px] font-semibold active:scale-[0.98] transition-transform"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  handlePick(
                    confirmingFighter.userId,
                    confirmingFighter.displayName,
                    confirmingFighter.kind,
                  )
                }
                disabled={picking === confirmingFighter.userId}
                className="flex-[2] h-10 rounded-xs bg-primary text-primary-foreground text-[13px] font-semibold active:scale-[0.98] transition-transform inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {picking === confirmingFighter.userId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : confirmingFighter.kind === "change" ? (
                  <UserPlus className="h-3.5 w-3.5" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                {confirmingFighter.kind === "change" ? "Reassign" : "Confirm"}
              </button>
            </div>
          </div>
        )}

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this fight offer?</AlertDialogTitle>
              <AlertDialogDescription>
                The offer, its responses, and the announcement card will be
                removed for everyone in the gym. The fighter's training plan
                (if one was opened) stays in place.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="justify-center sm:justify-center">
              <AlertDialogCancel
                disabled={busyAction === "delete"}
                className="min-w-[110px]"
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={busyAction === "delete"}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 min-w-[110px]"
              >
                {busyAction === "delete" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "Delete"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
