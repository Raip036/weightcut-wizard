import { memo } from "react";
import { motion } from "motion/react";
import { Sparkles, Zap, Activity, BedDouble, Sun } from "lucide-react";
import type { AllMetrics, PersonalBaseline } from "@/utils/performanceEngine";

type Verdict = "push" | "steady" | "easy" | "recover";

interface DailyVerdictProps {
  metrics: AllMetrics;
  baseline: PersonalBaseline | null;
  checkedInToday: boolean;
}

const VERDICT_COPY: Record<Verdict, { headline: string; icon: typeof Zap; color: string; bg: string; ring: string }> = {
  push:    { headline: "Push today",     icon: Zap,        color: "text-func-recovery-green", bg: "bg-func-recovery-green/15", ring: "ring-func-recovery-green/30" },
  steady:  { headline: "Steady session", icon: Activity,   color: "text-blue-300",    bg: "bg-blue-500/15",    ring: "ring-blue-500/30" },
  easy:    { headline: "Take it light",  icon: Sun,        color: "text-func-warning-yellow",   bg: "bg-func-warning-yellow/15",   ring: "ring-func-warning-yellow/30" },
  recover: { headline: "Recover today",  icon: BedDouble,  color: "text-func-danger-red",     bg: "bg-func-danger-red/15",     ring: "ring-func-danger-red/30" },
};

/**
 * Combine readiness, overtraining risk, and load zone into a single
 * actionable verdict. Order matters; the harshest signal wins:
 *   1. critical OT or strained readiness → recover
 *   2. high OT or overreaching load → easy
 *   3. mid-band readiness → steady
 *   4. high readiness + clean OT → push
 *
 * Load-zone inputs are only honoured once `loadConfidence.isReliable` is true,
 * otherwise an artificially-high ACWR from cold-start data would incorrectly
 * push the verdict toward "easy" after the user's very first logged session.
 */
function deriveVerdict(metrics: AllMetrics): Verdict {
  const { readiness, overtrainingRisk, loadZone, loadConfidence } = metrics;
  const loadReliable = loadConfidence.isReliable;

  if (overtrainingRisk.zone === "critical") return "recover";
  if (readiness.label === "strained") return "recover";
  if (overtrainingRisk.zone === "high") return "easy";
  if (loadReliable && loadZone.zone === "overreaching") return "easy";
  if (readiness.label === "recovering") return "easy";
  if (
    readiness.score >= 75 &&
    overtrainingRisk.zone === "low" &&
    (!loadReliable || loadZone.zone !== "overreaching")
  ) {
    return "push";
  }
  return "steady";
}

/** One short sentence explaining the verdict, plain English, no jargon. */
function whyLine(metrics: AllMetrics, checkedInToday: boolean): string {
  const { readiness, overtrainingRisk, loadZone, weeklySessionCount, loadConfidence } = metrics;
  const loadReliable = loadConfidence.isReliable;

  if (overtrainingRisk.zone === "critical") {
    return "Your body is showing real signs of doing too much. Take today off. It will pay off the rest of the week.";
  }
  if (overtrainingRisk.zone === "high") {
    return "You've been pushing hard. Keep today light or skill-based instead of going all out.";
  }
  if (readiness.label === "strained") {
    return "You're really run down. Focus on sleep, food, and stretching today. Train again tomorrow.";
  }
  if (readiness.label === "recovering") {
    return "Your body is still catching up from recent training. A moderate session is the smart call today.";
  }
  if (loadReliable && loadZone.zone === "overreaching") {
    return "You've trained much harder than usual this week. Take it easier today so your body can adapt.";
  }
  if (loadReliable && loadZone.zone === "detraining") {
    return `Only ${weeklySessionCount} session${weeklySessionCount === 1 ? "" : "s"} this week. A solid session today will get you back into rhythm.`;
  }
  if (readiness.label === "peaked") {
    return "Everything is looking good. This is a great day to push the intensity.";
  }
  if (!loadReliable) {
    return "Still learning your normal training pattern. Train how your body feels today and check back in after a few more sessions.";
  }
  if (!checkedInToday) {
    return "Based on your recent training. Do a quick check-in for a more personalised read.";
  }
  return "Your training and recovery are well balanced. A normal session is the right call.";
}

export const DailyVerdictCard = memo(function DailyVerdictCard({ metrics, checkedInToday }: DailyVerdictProps) {
  const rawVerdict = deriveVerdict(metrics);
  // When load confidence is too low, the why-line falls back to a cautious
  // "still learning your normal training pattern" message. The headline must
  // match; claiming "Push today" or "Recover today" alongside that copy is
  // jarring. Force the neutral "Steady session" headline so they line up.
  const verdict: Verdict = !metrics.loadConfidence.isReliable ? "steady" : rawVerdict;
  const copy = VERDICT_COPY[verdict];
  const Icon = copy.icon;
  const why = whyLine(metrics, checkedInToday);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 22, stiffness: 280 }}
      className={`card-surface rounded-xs p-4 border border-border ring-1 ${copy.ring}`}
    >
      <div className="flex items-center gap-3">
        <div className={`h-12 w-12 rounded-xs flex items-center justify-center ${copy.bg}`}>
          <Icon className={`h-6 w-6 ${copy.color}`} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/70">
            Today's call
          </p>
          <h2 className="text-[20px] font-bold tracking-tight text-foreground leading-tight">
            {copy.headline}
          </h2>
        </div>
        <div className="flex flex-col items-end leading-none">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Readiness</span>
          <span className="text-[22px] font-bold tabular-nums text-foreground">{metrics.readiness.score}</span>
        </div>
      </div>
      <p className="text-[13px] text-foreground/85 leading-snug mt-2.5">
        {why}
      </p>
    </motion.div>
  );
});

interface BaselineConfidencePillProps {
  baseline: PersonalBaseline | null;
  totalCheckInDays: number;
}

/**
 * Tiered confidence pill so the user can see the score moving from generic
 * advice toward something tuned to their normal patterns.
 *
 *   day 0-6   → "Learning your patterns"
 *   day 7-13  → "Tuning to you"
 *   day 14+   → "Tuned to you"
 *
 * Bumped to a richer signal when the baseline has filled its 14d hooper mean
 * (the strictest gate the engine uses for personalisation): that tells us the
 * "full personal" path is active inside computeAllMetrics regardless of the
 * raw check-in count we passed in.
 */
export const BaselineConfidencePill = memo(function BaselineConfidencePill({
  baseline,
  totalCheckInDays,
}: BaselineConfidencePillProps) {
  const baselineUnlocked = baseline?.hooper_mean_14d != null;
  const days = baselineUnlocked ? Math.max(totalCheckInDays, 14) : totalCheckInDays;

  let label: string;
  let detail: string;
  let tone: string;
  if (days >= 14) {
    label = "Tuned to you";
    detail = `${days} days of data feeding your baseline`;
    tone = "bg-func-recovery-green/15 text-func-recovery-green border-func-recovery-green/30";
  } else if (days >= 7) {
    label = "Tuning to you";
    detail = `${days} of 14 days. Personal baseline weighting in.`;
    tone = "bg-blue-500/15 text-blue-300 border-blue-500/30";
  } else {
    label = "Learning your patterns";
    detail = `${days} of 14 days. Using a generic baseline for now.`;
    tone = "bg-func-warning-yellow/15 text-func-warning-yellow border-func-warning-yellow/30";
  }

  return (
    <div className={`inline-flex flex-col items-start gap-0.5 w-full rounded-xs border px-3 py-2 ${tone}`}>
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5" />
        <span className="text-[12px] font-semibold tracking-tight">{label}</span>
      </div>
      <span className="text-[11px] text-foreground/70">{detail}</span>
    </div>
  );
});
