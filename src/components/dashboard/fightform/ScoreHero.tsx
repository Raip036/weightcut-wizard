import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import type { FightFormLabel } from "@/scoring/types";
import { LABEL_ACCENT } from "./constants";

/**
 * Display copy for each FightForm label. Mirrors the `LABEL_DISPLAY` map that
 * previously lived inline in `FightFormScoreSheet.tsx` so the extracted hero
 * reads identically.
 */
const LABEL_DISPLAY: Record<string, string> = {
  sharp: "Sharp",
  sharpening: "Sharpening",
  off_pace: "Off Pace",
  at_risk: "At Risk",
};

function campPaceCopy(weeksAhead: number): string {
  if (weeksAhead === 0) return "On schedule";
  const n = Math.abs(weeksAhead);
  const unit = n === 1 ? "week" : "weeks";
  return weeksAhead > 0
    ? `${n.toFixed(0)} ${unit} ahead`
    : `${n.toFixed(0)} ${unit} behind`;
}

function phaseCopy(phase: string | null): string | null {
  if (!phase) return null;
  if (phase === "fightWeek") return "Fight week";
  if (phase === "peak") return "Peak phase";
  if (phase === "build") return "Build phase";
  return phase;
}

interface Props {
  score: number;
  /** A `FightFormLabel` value ("sharp" | "sharpening" | "off_pace" | "at_risk"). */
  label: string;
  phase: string | null;
  daysToFight: number | null;
  campAge: { weeksAhead: number } | null;
}

// Ring geometry, a single progress arc whose sweep tracks the 0-100 score.
const RING_SIZE = 132;
const RING_STROKE = 8;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * The FightForm score hero, the big composite number wrapped in a tinted
 * progress ring, with the label, camp-pace line and phase/days-to-fight
 * footnotes beneath it.
 *
 * Pure presentational: every value arrives via props. The only local state is
 * a one-shot pulse that fires when `score` changes between renders (the first
 * render never pulses, matching the original sheet behaviour).
 */
export function ScoreHero({ score, label, phase, daysToFight, campAge }: Props) {
  const accent = LABEL_ACCENT[label as FightFormLabel] ?? LABEL_ACCENT.off_pace;

  // One-shot pulse when the score changes, ported from the sheet's
  // `prevScoreRef` / `scorePulseOn` logic so visual continuity is preserved.
  const prevScoreRef = useRef<number | null>(null);
  const [scorePulseOn, setScorePulseOn] = useState(false);
  useEffect(() => {
    if (prevScoreRef.current !== null && prevScoreRef.current !== score) {
      setScorePulseOn(true);
      const t = window.setTimeout(() => setScorePulseOn(false), 650);
      prevScoreRef.current = score;
      return () => window.clearTimeout(t);
    }
    prevScoreRef.current = score;
  }, [score]);

  const clamped = Math.max(0, Math.min(100, score));
  const dashOffset = RING_CIRCUMFERENCE * (1 - clamped / 100);

  const phaseLine = phaseCopy(phase);

  return (
    <div className="mt-4 flex flex-col items-center text-center">
      <div
        className="relative flex items-center justify-center"
        style={{ width: RING_SIZE, height: RING_SIZE }}
      >
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          className="-rotate-90"
          aria-hidden
        >
          {/* Track */}
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            className="stroke-muted/30"
          />
          {/* Progress arc, tinted by label accent, sweep animated in. */}
          <motion.circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            className={accent.stroke}
            strokeDasharray={RING_CIRCUMFERENCE}
            initial={{ strokeDashoffset: RING_CIRCUMFERENCE }}
            animate={{ strokeDashoffset: dashOffset }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </svg>
        <span
          className={cn(
            "absolute display-number text-5xl leading-none tabular-nums",
            scorePulseOn && "score-pulse",
          )}
        >
          {score}
        </span>
      </div>

      <div className="section-header mt-3">{LABEL_DISPLAY[label] ?? label}</div>

      {campAge && (
        <div className="text-xs text-muted-foreground mt-2">
          {campPaceCopy(campAge.weeksAhead)}
        </div>
      )}

      {phaseLine && daysToFight != null && (
        <div className="text-xs text-muted-foreground">
          {phaseLine} · {daysToFight} days to fight
        </div>
      )}
    </div>
  );
}
