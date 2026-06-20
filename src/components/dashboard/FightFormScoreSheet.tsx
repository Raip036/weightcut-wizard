import { useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ShareButton } from "@/components/share/ShareButton";
import { ShareCardDialog } from "@/components/share/ShareCardDialog";
import { FightFormScoreCard } from "@/components/share/cards/FightFormScoreCard";
import { FightFormTrendSparkline } from "./FightFormTrendSparkline";
import { type TrendPoint } from "./FightFormSubScoreTile";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import { triggerHapticSelection } from "@/lib/haptics";
import { useUser } from "@/contexts/UserContext";
import { computeContributions, mergeRecoveryDimension } from "@/scoring/contributions";
import {
  SUBSCORE_LABEL,
  SUBSCORE_ICON,
  LABEL_ACCENT,
  ceilingLabel,
} from "./fightform/constants";
import { pillarAdvice } from "./fightform/pillarAdvice";
import { openSettings, type SettingsFocus } from "@/lib/openSettings";
import { ScoreHero } from "./fightform/ScoreHero";
import { ContributionBreakdown } from "./fightform/ContributionBreakdown";
import { PillarDetailDialog } from "./fightform/PillarDetailDialog";
import { CoachingCard } from "./fightform/CoachingCard";
import type { FightFormCoachContext } from "@/hooks/dashboard/useFightFormCoach";
import type {
  FightFormLabel,
  FightFormState,
  ScoringPhase,
  SubScore as SubScoreType,
  SubScoreKey,
} from "@/scoring/types";

type SubScore = {
  value: number;
  weight: number;
  reason: string;
  meta?: Record<string, number | string>;
};
export type FightFormTrendPoint = { date: string; score: number; state: FightFormState };

type Cap = { ruleId: string; cap: number };

export type LoggedTodayMap = {
  training: boolean;
  sleep: boolean;
  weight: boolean;
  wellness: boolean;
  meals: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  score: number;
  label: string;
  phase: string | null;
  daysToFight: number | null;
  campAge: { weeksAhead: number } | null;
  subScores: Record<string, SubScore> | null;
  topDriver: string | null;
  topLimiter: string | null;
  appliedCeiling: Cap | null;
  /**
   * Optional list of ALL currently-active ceilings (not just the tightest).
   * When provided and length > 1, the sheet renders a multi-cap section.
   * When omitted or length <= 1, falls back to the single `appliedCeiling`.
   */
  activeCeilings?: Cap[] | null;
  trend?: FightFormTrendPoint[] | null;
  // Optional decoration props — all degrade cleanly when missing.
  // `subScoreTrend` powers the per-pillar drill-down sparkline; `loggedToday`
  // drives the calibration teaser's ✓ chips; `calibration` populates the
  // "Unlocks in N days" headline.
  yesterdaySubScores?: Record<string, number>;
  subScoreTrend?: Record<string, TrendPoint[]>;
  loggedToday?: LoggedTodayMap;
  calibration?: { current: number; needed: number };
  // Confidence transparency props (Task 5 / Plan 4)
  state?: string;
  activePillars?: number;
  totalPillars?: number;
};

const LABEL_DISPLAY: Record<string, string> = {
  sharp: "Sharp",
  sharpening: "Sharpening",
  off_pace: "Off Pace",
  at_risk: "At Risk",
};

// Maps a sub-score key → the corresponding `loggedToday` boolean, so the
// calibration teaser can show ✓/Not yet without the parent having to remap.
const SUBSCORE_TO_LOGGED: Record<string, keyof LoggedTodayMap> = {
  trainingLoad: "training",
  sleep: "sleep",
  weightCut: "weight",
  wellness: "wellness",
  nutritionAdherence: "meals",
};

// Sub-score categories rendered as locked rows in the calibration teaser.
// This is the 4-item calibration list ONLY — distinct from the shared
// 6-item `SUBSCORE_ORDER` in fightform/constants. `nutritionAdherence` and
// `recovery` are intentionally excluded from the calibration teaser.
const CALIBRATION_PILLARS: string[] = [
  "trainingLoad",
  "sleep",
  "weightCut",
  "wellness",
];

export function FightFormScoreSheet(p: Props) {
  const [shareOpen, setShareOpen] = useState(false);
  const [shareVariant, setShareVariant] = useState<"dark" | "transparent">("dark");
  const [selectedPillar, setSelectedPillar] = useState<SubScoreKey | null>(null);
  const navigate = useNavigate();
  const { userId } = useUser();
  // Active camp name is threaded into the shareable card so the rendered
  // image identifies which camp the score belongs to. Skip until userId
  // resolves, matching the pattern used in Dashboard / Camp / Goals.
  const activeCamp = useQuery(api.fight_camp.getActiveCamp, userId ? {} : "skip");

  // Resolve the cap list — see the prop docs above.
  const caps: Cap[] =
    p.activeCeilings && p.activeCeilings.length > 0
      ? p.activeCeilings
      : p.appliedCeiling
        ? [p.appliedCeiling]
        : [];
  const tightestRuleId =
    caps.length === 0
      ? null
      : caps.reduce((min, c) => (c.cap < min.cap ? c : min), caps[0]).ruleId;

  const isCalibrating = !p.subScores || Object.keys(p.subScores).length === 0;

  // Per-pillar contribution decomposition — primary unlocked view.
  const phase = (p.phase as ScoringPhase | null) ?? null;
  const breakdown = computeContributions(
    p.subScores as Record<string, SubScoreType> | null,
    phase,
  );

  // The recovery dimension is shown as ONE pillar keyed `wellness` (the
  // self-report check-in with HealthKit HRV/RHR folded in). `mergedSubs` is the
  // same fold the breakdown uses, so the drill-down reads the blended value.
  const mergedSubs = mergeRecoveryDimension(
    p.subScores as Record<string, SubScoreType> | null,
  );
  // HealthKit recovery is active when the raw `recovery` sub-score carries
  // weight — drives the "Apple Health connected / paused" notice in the dialog.
  const healthKitActive = (p.subScores?.recovery?.weight ?? 0) > 0;
  // Any engine key that resolves to the merged recovery dimension. `recovery`
  // (HealthKit) is folded into `wellness` for display, so remap it.
  const displayKey = (k: SubScoreKey): SubScoreKey =>
    k === "recovery" ? "wellness" : k;

  const handleNavigate = (route: string) => {
    // Close the per-pillar drill-down dialog AND the score sheet first so
    // neither overlaps whatever opens next.
    setSelectedPillar(null);
    p.onClose();
    if (route.startsWith("settings:")) {
      const focus = route.slice("settings:".length) as SettingsFocus;
      // Wait for the bottom sheet's close animation (~250ms) to finish before
      // opening the Apple Health settings sheet, so the two never overlap.
      window.setTimeout(() => openSettings(focus), 280);
      return;
    }
    navigate(route);
  };

  const openPillar = (key: SubScoreKey) => {
    triggerHapticSelection();
    setSelectedPillar(key);
  };

  // Calibration headline string.
  const calibHeadline = (() => {
    if (!p.calibration) return "Calibrating your score";
    const remaining = Math.max(0, p.calibration.needed - p.calibration.current);
    if (remaining === 0) return "Computing your first score…";
    if (remaining === 1) return "Unlocks in 1 day";
    return `Unlocks in ${remaining} days`;
  })();

  // Sub-score → accent for the 14-day overall sparkline.
  const accent = LABEL_ACCENT[p.label];
  const accentForLabel = accent ? `${accent.stroke} ${accent.fill}` : undefined;

  // Confidence band — shown when some pillars are excluded or data is stale.
  const showConfidenceBand =
    p.activePillars != null &&
    p.totalPillars != null &&
    p.totalPillars > 0 &&
    (p.activePillars < p.totalPillars || p.state === "stale");
  const confidenceFillPct = showConfidenceBand
    ? Math.round((p.activePillars! / p.totalPillars!) * 100)
    : 0;

  // Limiter focus — concise, deterministic headline + tap into the dialog.
  // Remap the engine key so a `recovery` limiter opens the merged recovery
  // pillar (keyed `wellness`) rather than a dialog with no data to show.
  const limiterKey = p.topLimiter ? displayKey(p.topLimiter as SubScoreKey) : null;
  const limiterSub = limiterKey ? mergedSubs[limiterKey] : null;
  const limiterHeadline =
    limiterKey && limiterSub
      ? pillarAdvice(limiterKey, limiterSub as SubScoreType, phase).headline
      : null;

  // Coach context — built from the deterministic numbers the sheet already has.
  const coachContext: FightFormCoachContext = {
    score: p.score,
    label: p.label,
    phase: p.phase,
    daysToFight: p.daysToFight,
    topDriver: p.topDriver,
    topLimiter: p.topLimiter,
    ceilings: p.activeCeilings ?? (p.appliedCeiling ? [p.appliedCeiling] : []),
    pillars: breakdown.pillars.map((pillar) => ({
      key: pillar.key,
      label: SUBSCORE_LABEL[pillar.key] ?? pillar.key,
      value: pillar.value,
      weightPct: pillar.effectiveWeightPct,
      contributionPts: pillar.contributionPts,
      reason: mergedSubs[pillar.key]?.reason ?? "",
    })),
  };

  const selectedSub = selectedPillar ? mergedSubs[selectedPillar] ?? null : null;
  const selectedContribution = selectedPillar
    ? breakdown.pillars.find((pillar) => pillar.key === selectedPillar) ?? null
    : null;

  return (
    <Sheet open={p.open} onOpenChange={(v) => !v && p.onClose()}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        {/* Title is absolutely centered on the sheet itself; share button
            floats over the left edge and the Sheet's built-in close X floats
            over the right. */}
        <SheetHeader className="relative flex items-center justify-center min-h-9 space-y-0">
          <SheetTitle className="text-2xl text-center">Fight Form Score</SheetTitle>
          <div className="absolute left-0 top-1/2 -translate-y-1/2">
            <ShareButton onClick={() => { setShareVariant("dark"); setShareOpen(true); }} />
          </div>
        </SheetHeader>

        <ScoreHero
          score={p.score}
          label={p.label}
          phase={p.phase}
          daysToFight={p.daysToFight}
          campAge={p.campAge}
        />

        {/* Limiter focus — pinned beneath the hero so the user sees the most
            actionable thing first. One-line headline that taps into the
            limiter's drill-down dialog. Unlocked state only. */}
        {!isCalibrating && limiterKey && limiterHeadline && (
          <button
            type="button"
            onClick={() => openPillar(limiterKey)}
            className="mt-5 w-full flex items-center gap-2.5 rounded-xs border border-primary/20 bg-primary/5 px-3 py-3 text-left active:bg-primary/10 transition-colors"
          >
            <Icon
              name={SUBSCORE_ICON[limiterKey] ?? "ellipseOutline"}
              size={18}
              className="text-primary shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] uppercase tracking-wide font-semibold text-primary/80">
                Focus · {SUBSCORE_LABEL[limiterKey] ?? limiterKey}
              </span>
              <span className="block text-body-sm font-medium text-foreground/90 leading-snug">
                {limiterHeadline}
              </span>
            </span>
            <Icon
              name="chevronForwardOutline"
              size={14}
              className="text-muted-foreground/60 shrink-0"
            />
          </button>
        )}

        {caps.length > 0 && (
          <div className="mt-6 space-y-2 rounded-xs border border-func-warning-yellow/30 bg-func-warning-yellow/[0.05] px-3 py-2.5">
            <div className="section-header text-func-warning-yellow">
              {caps.length === 1
                ? "Score capped"
                : `Score capped by ${caps.length} rules`}
            </div>
            <ul className="space-y-1.5">
              {caps
                .slice()
                .sort((a, b) => a.cap - b.cap)
                .map((c) => {
                  const isTightest = c.ruleId === tightestRuleId;
                  return (
                    <li
                      key={c.ruleId}
                      className="flex items-center justify-between text-xs"
                    >
                      <span
                        className={
                          isTightest && caps.length > 1
                            ? "font-semibold text-foreground"
                            : "text-foreground/85"
                        }
                      >
                        {ceilingLabel(c.ruleId)}
                        {isTightest && caps.length > 1 && (
                          <span className="ml-1.5 text-[10px] uppercase tracking-wide font-semibold text-func-warning-yellow">
                            Tightest
                          </span>
                        )}
                      </span>
                      <span className="display-number text-sm tabular-nums">
                        cap {c.cap}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        )}

        {/* ─── Calibration (locked) state ────────────────────────────── */}
        {isCalibrating && (
          <div className="mt-6 space-y-3">
            <div className="rounded-xs border border-sky-400/20 bg-sky-400/[0.05] px-3 py-3 text-center">
              <p className="text-body-sm font-semibold text-foreground">{calibHeadline}</p>
              <p className="text-micro text-muted-foreground mt-1 leading-snug">
                Log any 3 days of signals to unlock your score. We'll then
                show your daily breakdown across these 5 areas.
              </p>
            </div>

            <ul className="space-y-1.5">
              {CALIBRATION_PILLARS.map((key) => {
                const loggedKey = SUBSCORE_TO_LOGGED[key];
                const logged = p.loggedToday ? p.loggedToday[loggedKey] : false;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-2.5 rounded-xs border border-border/40 bg-muted/20 px-3 py-2.5 opacity-80"
                  >
                    <Icon
                      name={SUBSCORE_ICON[key] ?? "ellipseOutline"}
                      size={16}
                      className="text-muted-foreground shrink-0"
                    />
                    <span className="flex-1 text-body-sm font-medium text-foreground/80">
                      {SUBSCORE_LABEL[key] ?? key}
                    </span>
                    {p.loggedToday && (
                      <span
                        className={cn(
                          "text-[10px] font-semibold px-1.5 py-0.5 rounded-full border leading-none",
                          logged
                            ? "text-func-recovery-green bg-func-recovery-green/10 border-func-recovery-green/30"
                            : "text-muted-foreground bg-muted/30 border-border/40",
                        )}
                      >
                        {logged ? "Logged today ✓" : "Not yet"}
                      </span>
                    )}
                    <Icon
                      name="lockClosedOutline"
                      size={14}
                      className="text-muted-foreground/60 shrink-0"
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* ─── Unlocked state ────────────────────────────────────────── */}
        {!isCalibrating && p.subScores && (
          <>
            {showConfidenceBand && (
              <div className="mt-6 rounded-xs border border-border/40 bg-muted/15 p-2.5 space-y-1.5">
                <p className="text-[12px] font-semibold text-foreground/90 leading-snug">
                  Based on {p.activePillars} of {p.totalPillars} signals
                </p>
                <div className="h-1 w-full rounded-full bg-muted/40 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-func-recovery-green"
                    style={{ width: `${confidenceFillPct}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Pillars you haven't logged aren't counting toward today's number — your score isn't penalised, it's just based on less.
                </p>
              </div>
            )}

            <ContributionBreakdown
              breakdown={breakdown}
              displayedScore={p.score}
              appliedCeiling={p.appliedCeiling}
              onPillarTap={openPillar}
            />

            <CoachingCard context={coachContext} onNavigate={handleNavigate} />
          </>
        )}

        {/* Overall 14-day trend — supporting reference below the primary
            content. */}
        {p.trend && p.trend.length > 0 && (
          <div className="mt-6 space-y-2">
            <div className="section-header">14-day trend</div>
            <div className="h-12">
              <FightFormTrendSparkline points={p.trend} accentClass={accentForLabel} />
            </div>
          </div>
        )}

      </SheetContent>

      <ShareCardDialog
        open={shareOpen}
        onOpenChange={(v) => { setShareOpen(v); if (v) setShareVariant("dark"); }}
        transparent={shareVariant === "transparent"}
        showSwipeHint
        title="Share Fight Form Score"
        shareTitle="Fight Form Score"
        shareText={`My Fight Form Score is ${p.score}: ${LABEL_DISPLAY[p.label] ?? p.label}`}
      >
        {({ cardRef, aspect, transparent }) => {
          let touchStartX = 0;
          const flash = (el: HTMLElement | null) => {
            if (!el) return;
            el.classList.remove("share-variant-flash");
            void el.offsetWidth;
            el.classList.add("share-variant-flash");
          };
          const labelBtnStyle = (v: "dark" | "transparent"): CSSProperties => ({
            background: "none", border: "none", padding: 0, cursor: "pointer",
            fontSize: 12, fontWeight: 600,
            color: shareVariant === v ? "#ffffff" : "rgba(255,255,255,0.35)",
            transition: "color 0.2s",
          });
          return (
            <div
              onTouchStart={(e) => { touchStartX = e.touches[0].clientX; }}
              onTouchEnd={(e) => {
                const delta = e.changedTouches[0].clientX - touchStartX;
                if (Math.abs(delta) > 40) {
                  setShareVariant((v) => v === "dark" ? "transparent" : "dark");
                  flash(e.currentTarget as HTMLElement);
                }
              }}
            >
              <FightFormScoreCard
                ref={cardRef}
                score={p.score}
                label={(p.label as FightFormLabel) ?? "off_pace"}
                phase={(p.phase as ScoringPhase | null) ?? null}
                daysToFight={p.daysToFight}
                campAge={p.campAge}
                subScores={p.subScores as Record<SubScoreKey, SubScoreType> | null}
                campName={activeCamp?.name ?? null}
                aspect={aspect}
                transparent={transparent}
              />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 10 }}>
                <button onClick={() => setShareVariant("dark")} style={labelBtnStyle("dark")}>
                  Dark
                </button>
                <div style={{ display: "flex", gap: 6 }}>
                  {(["dark", "transparent"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setShareVariant(v)}
                      aria-label={`${v} style`}
                      style={{
                        width: 8, height: 8, borderRadius: 4, border: "none", padding: 0,
                        cursor: "pointer",
                        background: shareVariant === v ? "#ffffff" : "rgba(255,255,255,0.3)",
                        transition: "background 0.2s",
                      }}
                    />
                  ))}
                </div>
                <button onClick={() => setShareVariant("transparent")} style={labelBtnStyle("transparent")}>
                  Transparent
                </button>
              </div>
            </div>
          );
        }}
      </ShareCardDialog>

      {/* Per-pillar drill-down dialog — opened from the contribution
          breakdown / limiter focus above. Centred modal so the parent
          Sheet's scroll position is preserved on close. */}
      <PillarDetailDialog
        open={!!selectedPillar && !!selectedSub}
        onClose={() => setSelectedPillar(null)}
        pillarKey={selectedPillar}
        sub={(selectedSub as SubScoreType | null) ?? null}
        contribution={selectedContribution}
        phase={p.phase}
        trend={selectedPillar ? p.subScoreTrend?.[selectedPillar] : undefined}
        onNavigate={handleNavigate}
        healthKitActive={healthKitActive}
      />
    </Sheet>
  );
}
