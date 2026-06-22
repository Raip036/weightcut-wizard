/**
 * AthleteHero — top-of-page glass card. Anchors the page on the person:
 * avatar with a tier-coloured readiness ring, name + handle + class, then
 * a one-liner stat row (fight countdown + weight delta) and a pill row
 * for cut category / phase / alert dot.
 *
 * The ring colour tracks the Fight Form label (sharp / sharpening /
 * off_pace / at_risk). When the score is calibrating or missing, the
 * ring stays neutral so the page never reads "alert" without evidence.
 *
 * Whimsy: when readiness < 40 or there are < 3 days until the fight,
 * the ring runs a slow breath pulse so the coach's eye is pulled in.
 * Respects prefers-reduced-motion (pulse goes off, opacity stays solid).
 */
import { memo, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AthleteAvatar } from "@/components/coach/AthleteAvatar";
import type { FightFormDetail } from "@/hooks/coach/useAthleteDetail";
import { isScoredState } from "@/lib/fightFormState";

const RING_STROKE: Record<FightFormDetail["label"], string> = {
  sharp: "hsl(var(--func-recovery-green))",
  sharpening: "hsl(var(--func-warning-yellow))",
  off_pace: "hsl(var(--func-carbs-orange))",
  at_risk: "hsl(var(--func-danger-red))",
};

interface Props {
  name: string;
  avatarUrl: string | null;
  athleteType: string | null;
  goalType: string | null;
  currentWeightKg: number | null;
  targetWeightKg: number | null;
  targetDate: string | null;
  membershipGym: string | null;
  fightForm: FightFormDetail | null;
}

function daysUntil(targetDate: string | null): number | null {
  if (!targetDate) return null;
  const ms = new Date(targetDate).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

function formatFightDate(targetDate: string): string {
  return new Date(targetDate).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * Pure SVG ring around the avatar — sized to wrap the 80px avatar with a
 * 6px gap and 4px stroke. Strokes in tier colour at progress = score/100;
 * neutral muted track underneath.
 */
function AvatarRing({
  size,
  stroke,
  progress,
  pulsing,
  reduced,
}: {
  size: number;
  stroke: string;
  progress: number;
  pulsing: boolean;
  reduced: boolean | null;
}) {
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - Math.max(0, Math.min(1, progress)));
  const shouldPulse = pulsing && !reduced;
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="absolute inset-0 pointer-events-none"
      aria-hidden
      animate={
        shouldPulse
          ? { opacity: [0.65, 1, 0.65], scale: [1, 1.015, 1] }
          : undefined
      }
      transition={
        shouldPulse
          ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
          : undefined
      }
      style={{ transformOrigin: "center" }}
    >
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted) / 0.35)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      </g>
    </motion.svg>
  );
}

export const AthleteHero = memo(function AthleteHero({
  name,
  avatarUrl,
  athleteType: _athleteType,
  goalType: _goalType,
  currentWeightKg,
  targetWeightKg,
  targetDate,
  membershipGym,
  fightForm,
}: Props) {
  const reduced = useReducedMotion();
  const days = useMemo(() => daysUntil(targetDate), [targetDate]);

  const ringStroke =
    fightForm && isScoredState(fightForm.state)
      ? RING_STROKE[fightForm.label]
      : "hsl(var(--muted-foreground) / 0.6)";
  const ringProgress =
    fightForm && isScoredState(fightForm.state) ? fightForm.score / 100 : 0;

  const alertReadiness =
    fightForm && isScoredState(fightForm.state) && fightForm.score < 40;
  const alertCountdown = days != null && days >= 0 && days < 3;
  const showAlert = alertReadiness || alertCountdown;
  const pulseRing = showAlert;

  // Weight delta (current → target). Negative means we still need to drop.
  const delta =
    currentWeightKg != null && targetWeightKg != null
      ? +(currentWeightKg - targetWeightKg).toFixed(1)
      : null;
  const deltaPct =
    delta != null && targetWeightKg && targetWeightKg > 0
      ? Math.abs((delta / targetWeightKg) * 100)
      : null;

  // Subline shows the gym affiliation only — athlete-type / goal-type
  // text was removed per design (kept noisy and was redundant with
  // the rest of the page chrome). `membershipGym` is rendered below.
  const subline: string | null = null;

  const fightLine = (() => {
    if (!targetDate || days == null) return null;
    if (days < 0) return "Fight passed";
    if (days === 0) return `Fight today · ${formatFightDate(targetDate)}`;
    if (days === 1) return `Fight tomorrow · ${formatFightDate(targetDate)}`;
    return `Fight in ${days} days · ${formatFightDate(targetDate)}`;
  })();

  // Weight block — broken into structured fields rendered as a small
  // stat grid so start → goal weight + delta read clearly without
  // squashing into one dense line.
  const weightBlock = (() => {
    if (currentWeightKg == null && targetWeightKg == null) return null;
    return {
      current: currentWeightKg,
      target: targetWeightKg,
      deltaKg: delta,
      deltaPct,
    };
  })();

  // Avatar + ring sizing — the SVG sits in a wrapper sized to leave a
  // small gap between stroke and avatar edge.
  const ringSize = 88;
  const avatarSize = 72;

  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: "easeOut" }}
      className="glass-card card-glow p-4 sm:p-5"
      aria-label="Athlete summary"
    >
      <div className="flex items-start gap-4">
        <div
          className="relative flex-shrink-0"
          style={{ width: ringSize, height: ringSize }}
        >
          <AvatarRing
            size={ringSize}
            stroke={ringStroke}
            progress={ringProgress}
            pulsing={pulseRing}
            reduced={reduced}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <AthleteAvatar
              avatarUrl={avatarUrl}
              name={name}
              size={avatarSize}
            />
          </div>
        </div>

        <div className="flex-1 min-w-0 pt-1">
          <p className="text-[22px] font-semibold leading-tight break-words">
            {name || "Athlete"}
          </p>
          {(subline || membershipGym) && (
            <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">
              {subline}
              {subline && membershipGym ? " · " : ""}
              {membershipGym}
            </p>
          )}
        </div>
      </div>

      {fightLine && (
        <p className="mt-3 text-[13px] tabular-nums leading-snug">
          {fightLine}
        </p>
      )}

      {/* Weight block — start → goal as a clear 3-column stat row
          rather than a single dense sentence. */}
      {weightBlock && (
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-border/40 bg-muted/10 px-3 py-2.5">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
              Start
            </p>
            <p className="mt-0.5 text-[15px] font-bold tabular-nums leading-tight">
              {weightBlock.current != null
                ? `${weightBlock.current.toFixed(1)} kg`
                : "-"}
            </p>
          </div>
          <div className="text-center border-x border-border/30">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
              Goal
            </p>
            <p className="mt-0.5 text-[15px] font-bold tabular-nums leading-tight">
              {weightBlock.target != null
                ? `${weightBlock.target.toFixed(1)} kg`
                : "-"}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
              Δ
            </p>
            <p
              className={`mt-0.5 text-[15px] font-bold tabular-nums leading-tight ${
                weightBlock.deltaKg == null
                  ? "text-muted-foreground"
                  : weightBlock.deltaKg > 0
                    ? "text-func-warning-yellow"
                    : weightBlock.deltaKg < 0
                      ? "text-func-recovery-green"
                      : "text-foreground"
              }`}
            >
              {weightBlock.deltaKg == null
                ? "-"
                : `${weightBlock.deltaKg > 0 ? "+" : ""}${weightBlock.deltaKg.toFixed(1)} kg`}
            </p>
            {weightBlock.deltaPct != null && weightBlock.deltaKg != null && weightBlock.deltaKg !== 0 && (
              <p className="text-[10px] tabular-nums text-muted-foreground/80">
                {weightBlock.deltaPct.toFixed(1)}%
              </p>
            )}
          </div>
        </div>
      )}
    </motion.section>
  );
});
