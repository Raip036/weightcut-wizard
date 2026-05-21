/**
 * Fighter-facing card for a fight-offer announcement.
 *
 * Renders the structured offer (date, weight class, event, opponent…)
 * plus a one-tap ternary interest signal. The "truth signal" line under
 * the buttons surfaces the fighter's own current-weight vs the offer's
 * weight class, derived client-side from the profile already in
 * UserContext + the announcement's fight date — no extra round trip.
 *
 * For `filled` offers, the buttons collapse and the card switches to
 * "You're up — fight camp opened" for the picked fighter, or a quiet
 * "Filled — congrats {Name}" for everyone else. Withdrawn offers grey
 * out with a "Withdrawn" pill.
 */
import { memo, useCallback, useMemo } from "react";
import { Trophy, Calendar, MapPin, Swords } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { logger } from "@/lib/logger";
import type { FightOfferPayload, GymAnnouncement } from "@/hooks/coach/useGymAnnouncements";

interface Props {
  announcement: GymAnnouncement;
  offer: FightOfferPayload;
}

function formatOfferDate(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function weeksBetween(epochMs: number): number {
  const ms = epochMs - Date.now();
  return Math.max(0, Math.round(ms / (7 * 24 * 60 * 60 * 1000)));
}

const SIGNAL_LABEL: Record<"yes" | "maybe" | "pass", string> = {
  yes: "You said: I'm in",
  maybe: "You said: Maybe",
  pass: "You said: Pass",
};

export const FightOfferCard = memo(function FightOfferCard({
  announcement,
  offer,
}: Props) {
  const { profile, userId } = useUser();
  const { toast } = useToast();
  const setInterest = useMutation(api.fight_offers.setInterest);

  const handleSignal = useCallback(
    async (signal: "yes" | "maybe" | "pass") => {
      triggerHaptic(ImpactStyle.Light);
      try {
        await setInterest({
          offerId: offer.id as Id<"fight_offers">,
          signal,
        });
      } catch (err: any) {
        logger.warn("FightOfferCard: setInterest failed", err);
        toast({
          title: "Couldn't save",
          description: err?.message ?? "Try again in a sec.",
          variant: "destructive",
        });
      }
    },
    [offer.id, setInterest, toast],
  );

  // Truth signal: where is the fighter relative to the offer's weight class.
  // Pulled from UserContext.profile so there's no extra query. If we don't
  // have a current weight yet, hide the line rather than show "—".
  const truthLine = useMemo(() => {
    const current = profile?.current_weight_kg;
    if (current == null) return null;
    const delta = +(current - offer.weight_class_kg).toFixed(1);
    const weeks = weeksBetween(offer.fight_date);
    if (delta <= 0) return `Inside class · safe cut${weeks > 0 ? ` · ${weeks}w out` : ""}`;
    return `You're ${delta.toFixed(1)} kg over${weeks > 0 ? ` · ${weeks}w out` : ""}`;
  }, [profile?.current_weight_kg, offer.weight_class_kg, offer.fight_date]);

  const isPicked = !!(
    offer.status === "filled" &&
    offer.selected_fighter_user_id &&
    userId &&
    offer.selected_fighter_user_id === userId
  );

  return (
    <div className="card-surface rounded-xs border border-border p-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
          <Trophy className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-primary/80 font-semibold leading-none mb-0.5">
            Fight Offer · {announcement.gym_name}
          </p>
          <p className="text-[11px] text-muted-foreground/80 leading-none">
            from {announcement.sender_name}
          </p>
        </div>
        {offer.status === "withdrawn" && (
          <span className="px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground text-[9px] uppercase tracking-wider font-semibold">
            Withdrawn
          </span>
        )}
        {offer.status === "filled" && (
          <span className="px-2 py-0.5 rounded-full bg-func-recovery-green/15 text-func-recovery-green text-[9px] uppercase tracking-wider font-semibold">
            Filled
          </span>
        )}
      </div>

      {/* Date + weight class hero */}
      <div className="flex items-baseline gap-3 mb-1">
        <span className="text-[20px] font-semibold tabular-nums leading-none">
          {formatOfferDate(offer.fight_date)}
        </span>
        <span className="text-[16px] font-semibold tabular-nums leading-none text-primary">
          {offer.weight_class_kg.toFixed(1)}kg
        </span>
      </div>

      {/* Event meta line */}
      {(offer.event_name || offer.location || offer.opponent_name) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-foreground/80 mb-1.5">
          {offer.event_name && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3 text-muted-foreground" />
              {offer.event_name}
            </span>
          )}
          {offer.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3 text-muted-foreground" />
              {offer.location}
            </span>
          )}
          {offer.opponent_name && (
            <span className="inline-flex items-center gap-1">
              <Swords className="h-3 w-3 text-muted-foreground" />
              vs {offer.opponent_name}
            </span>
          )}
        </div>
      )}

      {/* Pitch (announcement body) */}
      {announcement.body && (
        <p className="text-[13px] text-foreground/90 leading-snug whitespace-pre-wrap break-words mb-2">
          {announcement.body}
        </p>
      )}

      {/* Attached media — appears between the pitch and the interest
          controls so it's the "look at this" beat right before the ask. */}
      {announcement.media_url && (
        <div className="rounded-xs overflow-hidden bg-muted/30 border border-border/40 mb-2">
          {announcement.media_kind === "video" ? (
            <video
              src={announcement.media_url}
              controls
              playsInline
              preload="metadata"
              className="w-full max-h-[320px] object-contain bg-black"
            />
          ) : (
            <img
              src={announcement.media_url}
              alt=""
              className="w-full max-h-[320px] object-contain"
            />
          )}
        </div>
      )}

      {/* Interest controls / status */}
      {offer.status === "open" ? (
        <>
          {offer.my_signal == null ? (
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => handleSignal("yes")}
                className="h-10 rounded-xs bg-primary text-primary-foreground text-[13px] font-semibold active:scale-[0.97] transition-transform"
              >
                ✓ I'm in
              </button>
              <button
                type="button"
                onClick={() => handleSignal("maybe")}
                className="h-10 rounded-xs bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-foreground/85 text-[13px] font-semibold active:scale-[0.97] transition-transform"
              >
                Maybe
              </button>
              <button
                type="button"
                onClick={() => handleSignal("pass")}
                className="h-10 rounded-xs bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-muted-foreground/80 text-[13px] font-semibold active:scale-[0.97] transition-transform"
              >
                Pass
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                  offer.my_signal === "yes"
                    ? "bg-primary/15 text-primary"
                    : offer.my_signal === "maybe"
                    ? "bg-func-warning-yellow/15 text-func-warning-yellow"
                    : "bg-muted/40 text-muted-foreground"
                }`}
              >
                {SIGNAL_LABEL[offer.my_signal]}
              </span>
              <button
                type="button"
                onClick={() => handleSignal("yes")}
                className="text-[11px] text-primary font-semibold active:opacity-70"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => handleSignal("maybe")}
                className="text-[11px] text-func-warning-yellow font-semibold active:opacity-70"
              >
                Maybe
              </button>
              <button
                type="button"
                onClick={() => handleSignal("pass")}
                className="text-[11px] text-muted-foreground font-semibold active:opacity-70"
              >
                Pass
              </button>
            </div>
          )}
          {truthLine && (
            <p className="text-[11px] text-muted-foreground/80 mt-1.5">{truthLine}</p>
          )}
        </>
      ) : offer.status === "filled" ? (
        <p
          className={`text-[12px] font-medium mt-1 ${
            isPicked ? "text-func-recovery-green" : "text-muted-foreground/80"
          }`}
        >
          {isPicked
            ? "You're up — fight camp opened"
            : "Filled — good luck to the chosen fighter"}
        </p>
      ) : (
        <p className="text-[12px] text-muted-foreground/70 mt-1">
          This offer was withdrawn.
        </p>
      )}
    </div>
  );
});
