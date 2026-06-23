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
import { SUBSCORE_LABEL, SUBSCORE_ICON, SUBSCORE_EXPLAINER } from "./constants";
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
      {/* 1, header: icon + label + value */}
      <DialogTitle className="flex items-center gap-2 text-base">
        <Icon
          name={SUBSCORE_ICON[pillarKey] ?? "ellipseOutline"}
          size={16}
          className="text-foreground shrink-0"
        />
        <span className="truncate">{SUBSCORE_LABEL[pillarKey] ?? pillarKey}</span>
        <span className="ml-auto display-number text-2xl tabular-nums">
          {sub.value}
          <span className="text-base text-muted-foreground/70">/100</span>
        </span>
      </DialogTitle>

      {/* 2, primary explanation (engine reason) */}
      <DialogDescription className="text-foreground/85 leading-snug">
        {sub.reason}
      </DialogDescription>

      {/* 3, contribution bar (active pillars only) */}
      {contribution && (
        <div className="space-y-1">
          <div
            className="h-1.5 rounded-full bg-muted/40 overflow-hidden"
            aria-hidden
          >
            <div
              className={cn("h-full rounded-full", TIER_BAR[tier])}
              style={{ width: `${fillPct}%` }}
            />
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium tabular-nums">
            Contributing +{contribution.contributionPts} pts (
            {contribution.effectiveWeightPct}% weight this phase)
          </div>
        </div>
      )}

      {/* 4, "How this is measured" explainer */}
      {SUBSCORE_EXPLAINER[pillarKey] && (
        <div className="rounded-xs bg-muted/15 border border-border/40 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium mb-1">
            How this is measured
          </div>
          <p className="text-[12px] leading-snug text-foreground/80">
            {SUBSCORE_EXPLAINER[pillarKey]}
          </p>
        </div>
      )}

      {/* 5, per-pillar sparkline */}
      {trend && trend.length >= 2 && (
        <div className="h-16 rounded-xs bg-background/40 p-2">
          <FightFormTrendSparkline
            points={trend.map((pt) => ({
              date: pt.date,
              score: pt.value,
              state: "ok" as FightFormState,
            }))}
          />
        </div>
      )}

      {/* 6, "What you can do" */}
      <div className="space-y-2">
        <div className="section-header">What you can do</div>
        <p className="text-body-sm text-foreground/85 leading-snug">
          {advice.headline}
        </p>
        {advice.actions.length > 0 && (
          <ul className="space-y-1">
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
                      "w-full flex items-center justify-between gap-2 rounded-xs px-2 py-2 text-left text-body-sm text-foreground/90 transition-colors",
                      tappable
                        ? "active:bg-primary/10"
                        : "opacity-70 cursor-default",
                    )}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Icon
                        name="arrowForwardOutline"
                        size={14}
                        className="text-primary shrink-0"
                      />
                      <span className="truncate">{action.label}</span>
                    </span>
                    {tappable && (
                      <Icon
                        name="chevronForwardOutline"
                        size={12}
                        className="text-muted-foreground/60 shrink-0"
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
