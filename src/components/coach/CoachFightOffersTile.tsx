/**
 * Coach-dashboard tile listing the gym's fight offers. Sits inside each
 * gym's card, between the "New announcement" CTA and the athletes list,
 * and only renders when there's at least one offer in the gym.
 *
 * Open offers float to the top of the list; filled and withdrawn offers
 * collapse into a quieter row beneath. Tapping any row opens the detail
 * sheet for that offer.
 */
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Trophy, ChevronRight } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { FightOfferDetailSheet } from "./FightOfferDetailSheet";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";

interface Props {
  gymId: string;
}

function formatShortDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function CoachFightOffersTile({ gymId }: Props) {
  const offers = useQuery(api.fight_offers.listForGym, {
    gymId: gymId as Id<"gyms">,
    limit: 20,
  });
  const [selectedOfferId, setSelectedOfferId] = useState<Id<"fight_offers"> | null>(null);

  // Sort: open first (newest → oldest), then filled / withdrawn at the bottom.
  const sorted = useMemo(() => {
    if (!offers) return [];
    const open = offers.filter((o) => o.status === "open");
    const rest = offers.filter((o) => o.status !== "open");
    return [...open, ...rest];
  }, [offers]);

  if (!offers || offers.length === 0) return null;

  const openCount = offers.filter((o) => o.status === "open").length;

  return (
    <>
      <section className="card-surface rounded-xs border border-border overflow-hidden">
        <header className="flex items-center gap-2 px-3 pt-3 pb-2">
          <div className="h-6 w-6 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Trophy className="h-3 w-3 text-primary" />
          </div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground/80 font-semibold">
            Fight offers
          </p>
          {openCount > 0 && (
            <span className="ml-auto text-[10px] tabular-nums text-primary font-semibold">
              {openCount} open
            </span>
          )}
        </header>

        <div className="divide-y divide-border/40 border-t border-border/40">
          {sorted.map((o) => {
            const totalSignals = o.counts.yes + o.counts.maybe + o.counts.pass;
            const isOpen = o.status === "open";
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  triggerHaptic(ImpactStyle.Light);
                  setSelectedOfferId(o.id as Id<"fight_offers">);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 min-h-[56px] text-left active:bg-muted/30 transition-colors ${
                  isOpen ? "" : "opacity-70"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[14px] font-semibold tabular-nums leading-tight">
                      {formatShortDate(o.fight_date)}
                    </span>
                    <span className="text-[12px] font-semibold tabular-nums leading-tight text-primary">
                      {o.weight_class_kg.toFixed(1)}kg
                    </span>
                    {o.status === "filled" && (
                      <span className="text-[9px] uppercase tracking-wider font-semibold text-emerald-400">
                        Filled
                      </span>
                    )}
                    {o.status === "withdrawn" && (
                      <span className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/70">
                        Withdrawn
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] mt-0.5 tabular-nums">
                    {o.event_name && (
                      <span className="text-muted-foreground/80 truncate max-w-[180px]">
                        {o.event_name}
                      </span>
                    )}
                    {totalSignals === 0 ? (
                      <span className="text-muted-foreground/60">No responses yet</span>
                    ) : (
                      <>
                        <span className="text-emerald-400 font-semibold">
                          {o.counts.yes} yes
                        </span>
                        {o.counts.maybe > 0 && (
                          <span className="text-amber-400 font-semibold">
                            {o.counts.maybe} maybe
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
              </button>
            );
          })}
        </div>
      </section>

      <FightOfferDetailSheet
        offerId={selectedOfferId}
        open={!!selectedOfferId}
        onOpenChange={(o) => {
          if (!o) setSelectedOfferId(null);
        }}
      />
    </>
  );
}
