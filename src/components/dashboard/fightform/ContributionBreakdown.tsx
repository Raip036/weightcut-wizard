import { motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import type {
  ContributionBreakdown as Breakdown,
  PillarContribution,
} from "@/scoring/contributions";
import type { SubScoreKey } from "@/scoring/types";
import { SUBSCORE_ICON, SUBSCORE_LABEL, ceilingLabel } from "./constants";

/**
 * Per-pillar segment / dot colour. One distinct hue per pillar drawn from the
 * functional palette so the segmented bar, legend dots and any sibling
 * component that wants pillar colour all agree. Exported for reuse.
 */
export const PILLAR_COLOR: Record<SubScoreKey, string> = {
  trainingLoad: "bg-func-protein-blue",
  sleep: "bg-func-fats-purple",
  weightCut: "bg-func-carbs-orange",
  wellness: "bg-func-recovery-green",
  nutritionAdherence: "bg-func-warning-yellow",
  recovery: "bg-func-danger-red",
};

interface Props {
  /** Output of `computeContributions()`. */
  breakdown: Breakdown;
  /** The final shown score (post EMA / ceiling). */
  displayedScore: number;
  appliedCeiling?: { ruleId: string; cap: number } | null;
  onPillarTap: (key: SubScoreKey) => void;
}

/**
 * The contribution breakdown, a segmented bar where each active pillar fills a
 * slice proportional to its `contributionPts`, a tappable legend, dimmed
 * "log to unlock" rows for inactive pillars, and a subtle honesty note when the
 * displayed score has been smoothed or capped away from the raw composite.
 *
 * Pure presentational: all data arrives via props.
 */
export function ContributionBreakdown({
  breakdown,
  displayedScore,
  appliedCeiling,
  onPillarTap,
}: Props) {
  const { pillars, inactive, rawScore } = breakdown;

  // Segment widths are proportional to contributionPts so the bar fills and the
  // slices sum to rawScore. Guard against a degenerate zero-sum.
  const totalPts = pillars.reduce((sum, p) => sum + p.contributionPts, 0);
  const widthPct = (p: PillarContribution): number =>
    totalPts > 0 ? (p.contributionPts / totalPts) * 100 : 0;

  const showHonesty = displayedScore !== rawScore;

  return (
    <div className="mt-6 space-y-3" data-tutorial="fight-form-driving-section">
      <div className="section-header px-1">What's driving your score</div>

      {/* ── 1. Segmented bar ─────────────────────────────────────────── */}
      {pillars.length > 0 && (
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/30">
          {pillars.map((p) => (
            <motion.div
              key={p.key}
              className={cn("h-full", PILLAR_COLOR[p.key])}
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              style={{ width: `${widthPct(p)}%`, transformOrigin: "left" }}
            />
          ))}
        </div>
      )}

      {/* ── 2. Legend, one tappable row per active pillar ───────────── */}
      {pillars.length > 0 && (
        <ul className="space-y-0.5">
          {pillars.map((p) => (
            <motion.li
              key={p.key}
              role="button"
              tabIndex={0}
              whileTap={{ scale: 0.98 }}
              onClick={() => onPillarTap(p.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPillarTap(p.key);
                }
              }}
              className="flex cursor-pointer items-center gap-2.5 rounded-xs px-1 py-2 text-left transition-colors active:bg-muted/20"
            >
              <span
                aria-hidden
                className={cn("h-2.5 w-2.5 shrink-0 rounded-full", PILLAR_COLOR[p.key])}
              />
              <Icon
                name={SUBSCORE_ICON[p.key] ?? "ellipseOutline"}
                size={15}
                className="shrink-0 text-foreground"
              />
              <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-foreground">
                {SUBSCORE_LABEL[p.key] ?? p.key}
              </span>
              <span className="shrink-0 text-right text-[11px] font-medium tabular-nums text-muted-foreground">
                <span className="font-semibold text-foreground/90">
                  +{p.contributionPts} pts
                </span>{" "}
                · {p.effectiveWeightPct}% weight
              </span>
            </motion.li>
          ))}
        </ul>
      )}

      {/* ── 3. Inactive pillars, dimmed "log to unlock" rows ────────── */}
      {inactive.length > 0 && (
        <>
          <div className="h-px w-full bg-border/40" aria-hidden />
          <ul className="space-y-0.5">
            {inactive.map((key) => (
              <motion.li
                key={key}
                role="button"
                tabIndex={0}
                whileTap={{ scale: 0.98 }}
                onClick={() => onPillarTap(key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPillarTap(key);
                  }
                }}
                className="flex cursor-pointer items-center gap-2.5 rounded-xs px-1 py-2 text-left opacity-50 transition-opacity active:opacity-70"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-muted-foreground/40"
                />
                <Icon
                  name={SUBSCORE_ICON[key] ?? "ellipseOutline"}
                  size={15}
                  className="shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-muted-foreground">
                  {SUBSCORE_LABEL[key] ?? key}
                </span>
                <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                  Log to unlock
                </span>
              </motion.li>
            ))}
          </ul>
        </>
      )}

      {/* ── 4. Honesty note, smoothing / ceiling transparency ───────── */}
      {showHonesty && (
        <p className="px-1 text-[11px] leading-snug text-muted-foreground/80">
          {appliedCeiling
            ? `Capped at ${appliedCeiling.cap} (${ceilingLabel(appliedCeiling.ruleId)})`
            : `Smoothed to ${displayedScore}`}
        </p>
      )}
    </div>
  );
}
