import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { WizardCharacter } from "@/tutorial/WizardCharacter";

/**
 * Trend-aware result screen shown after a wellness check-in is saved. Turns the
 * raw Hooper score into a personalised "readiness" readout: a count-up number,
 * how today compares to the user's recent baseline, a mini sparkline, and a
 * single tailored recovery tip keyed off the weakest answer. Purely
 * presentational; the mutation already ran in the parent.
 */

export interface WellnessAnswers {
  sleep_quality: number; // 1..7, higher better
  fatigue_level: number; // 1..7, higher worse
  soreness_level: number; // 1..7, higher worse
  stress_level: number; // 1..7, higher worse
}

interface WellnessResultProps {
  hooper: number; // today's Hooper index (4..28)
  recent: Array<{ date: string; hooper: number }>; // prior history, ascending
  recentAvg: number | null;
  answers: WellnessAnswers;
  sorenessAreas: string[];
  onDone: () => void;
}

// Hooper (4..28, higher = fresher) → readiness 0..100. Mirrors the wellness
// sub-score map in src/scoring (`(hooper - 4) * 4.2`, clamped).
function hooperToReadiness(h: number): number {
  return Math.round(Math.max(0, Math.min(100, (h - 4) * 4.2)));
}

function readinessTone(r: number): { text: string; label: string } {
  if (r >= 66) return { text: "text-func-recovery-green", label: "Fresh" };
  if (r >= 33) return { text: "text-func-warning-yellow", label: "Moderate" };
  return { text: "text-func-danger-red", label: "Run down" };
}

/** The single most-limiting dimension drives the tip. */
function tailoredTip(a: WellnessAnswers, sorenessAreas: string[]): { icon: IonIconName; text: string } {
  const badness = {
    sleep: (7 - a.sleep_quality) / 6,
    soreness: (a.soreness_level - 1) / 6,
    stress: (a.stress_level - 1) / 6,
    fatigue: (a.fatigue_level - 1) / 6,
  };
  const worst = (Object.keys(badness) as Array<keyof typeof badness>).reduce((m, k) =>
    badness[k] > badness[m] ? k : m,
  );
  if (badness[worst] < 0.34) {
    return { icon: "flashOutline", text: "Body's primed. Green light to push the pace today." };
  }
  switch (worst) {
    case "soreness": {
      const where = sorenessAreas.length ? sorenessAreas.join(" & ").toLowerCase() : "muscles";
      return { icon: "bodyOutline", text: `${where} are sore. Lead with mobility and hit your protein target today.` };
    }
    case "sleep":
      return { icon: "moonOutline", text: "Short on sleep. Keep intensity moderate and aim for an earlier night." };
    case "stress":
      return { icon: "leafOutline", text: "Stress is up. Favour technique work over hard sparring and breathe between rounds." };
    case "fatigue":
    default:
      return { icon: "batteryHalfOutline", text: "Legs feel heavy. An easy flush session will serve you better than grinding." };
  }
}

function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || target <= 0) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);
  return value;
}

/** Compact baseline-comparison sentence. */
function baselineCopy(
  todayReadiness: number,
  recent: Array<{ date: string; hooper: number }>,
  recentAvg: number | null,
): { text: string; up: boolean | null } {
  if (recent.length === 0 || recentAvg == null) {
    return { text: "First check-in logged. Your baseline starts building now.", up: null };
  }
  const avgReadiness = hooperToReadiness(recentAvg);
  const delta = todayReadiness - avgReadiness;
  // Freshest in a while?
  const maxRecent = Math.max(...recent.map((r) => hooperToReadiness(r.hooper)));
  if (todayReadiness >= maxRecent && recent.length >= 2) {
    return { text: `Freshest you've been in ${recent.length + 1} days.`, up: true };
  }
  if (Math.abs(delta) <= 4) {
    return { text: "Right in line with your recent average.", up: null };
  }
  return delta > 0
    ? { text: `Up ${delta} vs your recent average, trending fresh.`, up: true }
    : { text: `Down ${Math.abs(delta)} vs your recent average, ease in today.`, up: false };
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 100;
  const h = 28;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(1, max - min);
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((p - min) / range) * h;
    return { x, y };
  });
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-7 w-full overflow-visible">
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary/70"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last.x} cy={last.y} r={2.6} className="fill-primary" />
    </svg>
  );
}

export function WellnessResult({
  hooper,
  recent,
  recentAvg,
  answers,
  sorenessAreas,
  onDone,
}: WellnessResultProps) {
  const prefersReduced = useReducedMotion();
  const readiness = hooperToReadiness(hooper);
  const tone = readinessTone(readiness);
  const counted = useCountUp(readiness);
  const tip = tailoredTip(answers, sorenessAreas);
  const baseline = baselineCopy(readiness, recent, recentAvg);
  const sparkPoints = [...recent.map((r) => hooperToReadiness(r.hooper)), readiness];

  const spring = { type: "spring" as const, stiffness: 260, damping: 24 };

  return (
    <motion.div
      key="wellness-result"
      initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring}
      className="flex flex-col items-center gap-4 px-1 text-center"
    >
      {/* Celebrating / empathising mascot */}
      <div className="h-[120px] w-[120px] -mb-2">
        <WizardCharacter pose={readiness >= 66 ? "celebrate" : "idle"} />
      </div>

      {/* Readiness hero */}
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 10, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.1, ...spring }}
        className="flex flex-col items-center"
      >
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70">
          Today's readiness
        </span>
        <div className="flex items-end gap-1.5 mt-1">
          <span className={`text-[64px] leading-none font-display font-bold tabular-nums ${tone.text}`}>
            {counted}
          </span>
          <span className="text-[13px] text-muted-foreground/70 mb-2.5">/ 100</span>
        </div>
        <span className={`text-[16px] font-semibold ${tone.text}`}>{tone.label}</span>
      </motion.div>

      {/* Baseline comparison + sparkline */}
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, ...spring }}
        className="w-full rounded-2xl border border-border/40 bg-muted/15 px-4 py-3 space-y-2"
      >
        <div className="flex items-center justify-center gap-1.5">
          {baseline.up !== null && (
            <Icon
              name={baseline.up ? "trendingUpOutline" : "trendingDownOutline"}
              size={14}
              className={baseline.up ? "text-func-recovery-green" : "text-func-warning-yellow"}
            />
          )}
          <p className="text-[13px] font-medium text-foreground/85">{baseline.text}</p>
        </div>
        {sparkPoints.length >= 2 && <Sparkline points={sparkPoints} />}
      </motion.div>

      {/* Tailored tip */}
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, ...spring }}
        className="w-full rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3 flex items-start gap-2.5 text-left"
      >
        <div className="rounded-full bg-primary/15 p-1.5 shrink-0">
          <Icon name={tip.icon} size={16} className="text-primary" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-primary/80 font-semibold mb-0.5">
            Today's focus
          </div>
          <p className="text-[13px] leading-snug text-foreground/85">{tip.text}</p>
        </div>
      </motion.div>

      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, ...spring }}
        className="w-full pt-1"
      >
        <Button onClick={onDone} className="w-full rounded-xl h-12 font-semibold">
          Done
        </Button>
      </motion.div>
    </motion.div>
  );
}
