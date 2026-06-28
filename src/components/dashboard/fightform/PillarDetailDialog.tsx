import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import type { FightFormState, SubScore, SubScoreKey } from "@/scoring/types";
import type { PillarContribution } from "@/scoring/contributions";
import { type TrendPoint } from "../FightFormSubScoreTile";
import { FightFormTrendSparkline } from "../FightFormTrendSparkline";
import { SUBSCORE_LABEL, SUBSCORE_EXPLAINER } from "./constants";
import { pillarAdvice } from "./pillarAdvice";

interface Props {
  open: boolean;
  onClose: () => void;
  pillarKey: SubScoreKey | null;
  /** value/weight/reason/meta/completeness */
  sub: SubScore | null;
  /** pts + weight%, may be null for inactive pillars. */
  contribution?: PillarContribution | null;
  phase: string | null;
  /** Optional per-pillar sparkline data. */
  trend?: TrendPoint[];
  /** Deep-link handler, navigates and closes the parent sheet. */
  onNavigate: (route: string) => void;
}

/* ── Tier helpers (local mirror of the sheet's private band → bar mapping) ── */
type Tier = "gold" | "silver" | "bronze" | "building";

function tierFor(value: number): Tier {
  if (value >= 80) return "gold";
  if (value >= 60) return "silver";
  if (value >= 40) return "bronze";
  return "building";
}

const TIER_BAR: Record<Tier, string> = {
  gold: "bg-amber-300",
  silver: "bg-slate-200",
  bronze: "bg-orange-300",
  building: "bg-muted-foreground/60",
};

// Text colour mirror of TIER_BAR, so the hero score reads its own tier at a glance.
const TIER_TEXT: Record<Tier, string> = {
  gold: "text-amber-300",
  silver: "text-slate-200",
  bronze: "text-orange-300",
  building: "text-muted-foreground",
};

/**
 * Per-pillar drill-down dialog. Deterministic + free, no AI, no fetching.
 *
 * Matches the sheet's existing `SubScoreDialog` visual language (header value,
 * engine reason, contribution bar, "How this is measured" explainer, sparkline)
 * and adds the deterministic `pillarAdvice` "What you can do" section.
 */
export function PillarDetailDialog({
  open,
  onClose,
  pillarKey,
  sub,
  contribution,
  phase,
  trend,
  onNavigate,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-5 gap-3">
        {pillarKey && sub && (
          <PillarDetailBody
            pillarKey={pillarKey}
            sub={sub}
            contribution={contribution}
            phase={phase}
            trend={trend}
            onNavigate={onNavigate}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PillarDetailBody({
  pillarKey,
  sub,
  contribution,
  phase,
  trend,
  onNavigate,
}: {
  pillarKey: SubScoreKey;
  sub: SubScore;
  contribution?: PillarContribution | null;
  phase: string | null;
  trend?: TrendPoint[];
  onNavigate: (route: string) => void;
}) {
  const tier = tierFor(sub.value);
  const fillPct = Math.max(0, Math.min(100, sub.value));
  const advice = pillarAdvice(pillarKey, sub, phase);

  return (
    <>
      {/* Header: label eyebrow + big tier-coloured score. No leading icon, and
          the score sits on its OWN line (left-aligned) so it can never tuck
          under the dialog's top-right close X. `pr-10` reserves the X's space. */}
      <div className="pr-10">
        <DialogTitle className="text-[11px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">
          {SUBSCORE_LABEL[pillarKey] ?? pillarKey}
        </DialogTitle>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className={cn("display-number text-[40px] leading-none tabular-nums", TIER_TEXT[tier])}>
            {sub.value}
          </span>
          <span className="text-[15px] text-muted-foreground/50 tabular-nums">/100</span>
        </div>
      </div>

      {/* Primary explanation (engine reason). */}
      <DialogDescription className="text-[14px] text-foreground/85 leading-snug">
        {sub.reason}
      </DialogDescription>

      {/* Contribution bar (active pillars only). */}
      {contribution && (
        <div className="space-y-1.5">
          <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden" aria-hidden>
            <div
              className={cn("h-full rounded-full", TIER_BAR[tier])}
              style={{ width: `${fillPct}%` }}
            />
          </div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 font-semibold tabular-nums">
            Contributing +{contribution.contributionPts} pts · {contribution.effectiveWeightPct}% weight this phase
          </div>
        </div>
      )}

      {/* "How this is measured" explainer — refined premium card. */}
      {SUBSCORE_EXPLAINER[pillarKey] && (
        <div className="rounded-2xl border border-border/40 bg-white/[0.02] px-4 py-3.5">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60 font-semibold mb-1.5">
            How this is measured
          </div>
          <p className="text-[13px] leading-relaxed text-foreground/75">
            {SUBSCORE_EXPLAINER[pillarKey]}
          </p>
        </div>
      )}

      {/* Per-pillar sparkline. */}
      {trend && trend.length >= 2 && (
        <div className="h-16 rounded-2xl border border-border/40 bg-white/[0.02] p-2.5">
          <FightFormTrendSparkline
            points={trend.map((pt) => ({
              date: pt.date,
              score: pt.value,
              state: "ok" as FightFormState,
            }))}
          />
        </div>
      )}

      {/* "What you can do" — headline + premium tappable action cards (no
          leading arrow icon; a single trailing chevron signals tappability). */}
      <div className="space-y-2.5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60 font-semibold">
          What you can do
        </div>
        <p className="text-[14px] text-foreground/85 leading-snug">
          {advice.headline}
        </p>
        {advice.actions.length > 0 && (
          <ul className="space-y-2">
            {advice.actions.map((action) => {
              const tappable = !!action.route;
              return (
                <li key={action.label}>
                  <button
                    type="button"
                    disabled={!tappable}
                    onClick={
                      tappable ? () => onNavigate(action.route!) : undefined
                    }
                    className={cn(
                      "w-full flex items-center justify-between gap-3 rounded-2xl border border-border/40 bg-white/[0.02] px-4 py-3 text-left transition-colors focus:outline-none focus-visible:outline-none",
                      tappable
                        ? "active:bg-primary/10"
                        : "opacity-60 cursor-default",
                    )}
                  >
                    <span className="min-w-0 text-[14px] font-medium text-foreground/90 leading-snug">
                      {action.label}
                    </span>
                    {tappable && (
                      <Icon
                        name="chevronForwardOutline"
                        size={15}
                        className="text-muted-foreground/40 shrink-0"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
