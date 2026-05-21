import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { ShareButton } from "@/components/share/ShareButton";
import { ShareCardDialog } from "@/components/share/ShareCardDialog";
import { FightFormScoreCard } from "@/components/share/cards/FightFormScoreCard";
import { FightFormTrendSparkline } from "./FightFormTrendSparkline";
import type { FightFormLabel, FightFormState, ScoringPhase, SubScoreKey, SubScore as SubScoreType } from "@/scoring/types";

type SubScore = { value: number; weight: number; reason: string };
export type FightFormTrendPoint = { date: string; score: number; state: FightFormState };

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
  appliedCeiling: { ruleId: string; cap: number } | null;
  trend?: FightFormTrendPoint[] | null;
};

const LABEL_ACCENT: Record<string, { stroke: string; fill: string }> = {
  sharp: { stroke: "stroke-func-recovery-green", fill: "fill-func-recovery-green" },
  sharpening: { stroke: "stroke-func-warning-yellow", fill: "fill-func-warning-yellow" },
  off_pace: { stroke: "stroke-func-carbs-orange", fill: "fill-func-carbs-orange" },
  at_risk: { stroke: "stroke-func-danger-red", fill: "fill-func-danger-red" },
};

const SUBSCORE_LABEL: Record<string, string> = {
  trainingLoad: "Training Load",
  sleep: "Sleep",
  weightCut: "Weight Cut",
  wellness: "Wellness",
  nutritionAdherence: "Nutrition",
};

const LABEL_DISPLAY: Record<string, string> = {
  sharp: "Sharp",
  sharpening: "Sharpening",
  off_pace: "Off Pace",
  at_risk: "At Risk",
};

/**
 * One plain sentence per metric explaining what the current score means.
 * Tiers: 80+ strong, 60-79 okay, 40-59 light, <40 dragging it down.
 * No symbols, no jargon, no em-dashes.
 */
function summarizeSubScore(key: string, value: number): string {
  const tier = value >= 80 ? "high" : value >= 60 ? "mid" : value >= 40 ? "low" : "vlow";
  switch (key) {
    case "trainingLoad":
      if (tier === "high") return "Your training is dialed in for this phase of camp.";
      if (tier === "mid") return "Training is on track but could use a bit more consistency.";
      if (tier === "low") return "Training is lighter than expected for this phase.";
      return "Training has dropped off and is dragging your score down.";
    case "sleep":
      if (tier === "high") return "You are well rested and recovering properly.";
      if (tier === "mid") return "Sleep is decent but there is still room to improve.";
      if (tier === "low") return "Sleep is short and recovery is taking a hit.";
      return "Sleep debt is pulling your score down. Earlier nights this week.";
    case "weightCut":
      if (tier === "high") return "Weight is moving at a safe, fight ready pace.";
      if (tier === "mid") return "Weight pace is okay but watch the trend this week.";
      if (tier === "low") return "Weight is moving too slow or too fast for this stage.";
      return "Weight pace is off plan and needs adjusting.";
    case "wellness":
      if (tier === "high") return "You feel strong, fresh, and ready to train.";
      if (tier === "mid") return "Wellness is steady. Keep logging your daily check in.";
      if (tier === "low") return "You feel beaten up. A real recovery day will help.";
      return "Wellness is low. Stress, soreness, or mood is bringing it down.";
    case "nutritionAdherence":
      if (tier === "high") return "Meals are matching your targets consistently.";
      if (tier === "mid") return "Nutrition is on track most days. Tighten up a few.";
      if (tier === "low") return "Meals are drifting from your targets.";
      return "Nutrition is well off target. Hitting calories and macros will lift this fast.";
    default:
      if (tier === "high") return "Looking strong.";
      if (tier === "mid") return "Holding steady.";
      if (tier === "low") return "Needs some attention.";
      return "Pulling your score down.";
  }
}

function campPaceCopy(weeksAhead: number): string {
  if (weeksAhead === 0) return "On schedule";
  const n = Math.abs(weeksAhead);
  const unit = n === 1 ? "week" : "weeks";
  return weeksAhead > 0
    ? `${n.toFixed(0)} ${unit} ahead of schedule`
    : `${n.toFixed(0)} ${unit} behind schedule`;
}

function phaseCopy(phase: string | null): string | null {
  if (!phase) return null;
  if (phase === "fightWeek") return "Fight week";
  if (phase === "peak") return "Peak phase";
  if (phase === "build") return "Build phase";
  return phase;
}

export function FightFormScoreSheet(p: Props) {
  const [shareOpen, setShareOpen] = useState(false);
  const [shareVariant, setShareVariant] = useState<"dark" | "transparent">("dark");
  return (
    <Sheet open={p.open} onOpenChange={(v) => !v && p.onClose()}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        {/* Title is absolutely centered on the sheet itself; share button
            floats over the left edge and the Sheet's built-in close X floats
            over the right. Centering is independent of either button's width
            so the title sits dead-center in the dialog. */}
        <SheetHeader className="relative flex items-center justify-center min-h-9 space-y-0">
          <SheetTitle className="text-2xl text-center">Fight Form Score</SheetTitle>
          <div className="absolute left-0 top-1/2 -translate-y-1/2">
            <ShareButton onClick={() => { setShareVariant("dark"); setShareOpen(true); }} />
          </div>
        </SheetHeader>

        <div className="mt-4 flex flex-col items-center text-center">
          <span className="display-number text-7xl leading-none">{p.score}</span>
          <div className="section-header mt-2">{LABEL_DISPLAY[p.label] ?? p.label}</div>
          {p.campAge && (
            <div className="text-xs text-muted-foreground mt-2">
              {campPaceCopy(p.campAge.weeksAhead)}
            </div>
          )}
          {phaseCopy(p.phase) && p.daysToFight != null && (
            <div className="text-xs text-muted-foreground">
              {phaseCopy(p.phase)} · {p.daysToFight} days to fight
            </div>
          )}
        </div>

        {p.subScores && (
          <div className="mt-6 space-y-3">
            <div className="section-header">What's driving your score</div>
            {Object.entries(p.subScores)
              .sort(([, a], [, b]) => b.value * b.weight - a.value * a.weight)
              .map(([key, sub]) => {
                const isLimiter = key === p.topLimiter;
                const isDriver = key === p.topDriver;
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        <span>{SUBSCORE_LABEL[key] ?? key}</span>
                        {isDriver && (
                          <span className="text-[10px] uppercase tracking-wide font-semibold text-func-recovery-green">
                            Driver
                          </span>
                        )}
                        {isLimiter && (
                          <span className="text-[10px] uppercase tracking-wide font-semibold text-func-warning-yellow">
                            Limiter
                          </span>
                        )}
                      </span>
                      <span className="display-number text-sm">{sub.value}</span>
                    </div>
                    <Progress value={sub.value} className="h-1.5 mt-1" />
                    <p className="text-xs text-muted-foreground mt-1 leading-snug">
                      {summarizeSubScore(key, sub.value)}
                    </p>
                  </div>
                );
              })}
          </div>
        )}

        {p.trend && p.trend.length > 0 && (
          <div className="mt-6 space-y-2">
            <div className="section-header">14-day trend</div>
            <div className="h-12">
              <FightFormTrendSparkline
                points={p.trend}
                accentClass={(() => {
                  const accent = LABEL_ACCENT[p.label];
                  return accent ? `${accent.stroke} ${accent.fill}` : undefined;
                })()}
              />
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
                aspect={aspect}
                transparent={transparent}
              />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 10 }}>
                <button
                  onClick={() => setShareVariant("dark")}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    color: shareVariant === "dark" ? "#ffffff" : "rgba(255,255,255,0.35)",
                    transition: "color 0.2s",
                  }}
                >
                  Dark
                </button>
                <div style={{ display: "flex", gap: 6 }}>
                  {(["dark", "transparent"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setShareVariant(v)}
                      aria-label={`${v} style`}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        background: shareVariant === v ? "#ffffff" : "rgba(255,255,255,0.3)",
                        transition: "background 0.2s",
                      }}
                    />
                  ))}
                </div>
                <button
                  onClick={() => setShareVariant("transparent")}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    color: shareVariant === "transparent" ? "#ffffff" : "rgba(255,255,255,0.35)",
                    transition: "color 0.2s",
                  }}
                >
                  Transparent
                </button>
              </div>
            </div>
          );
        }}
      </ShareCardDialog>
    </Sheet>
  );
}

