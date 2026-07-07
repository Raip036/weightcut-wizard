// WorkoutRecapCutscene: the premium full-screen "win moment" that replaces the
// plain gym finish flow. Reuses the app's reference "Aurora Wizard" aesthetic
// (WizardAuroraBackground + wizard_3D, modelled on CampCompleteCutscene): a 3D
// wizard floating over a rising blue aurora with drifting motes, a one-shot
// success haptic, the session's headline stats, and three CTAs (Share / Add a
// photo / Done). The old media-attach step is folded in as the "Add a photo"
// CTA rather than auto-opening on finish.
//
// Perf: only transform + opacity are animated on device; WizardAuroraBackground
// owns the aurora + motes (no manual blur added here). Reduced motion collapses
// to a calm static state with the same stats.
import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Camera, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";
import { formatVolume } from "@/lib/gymCalculations";
import wizard from "@/assets/wizard_3D.png";
import type { ExerciseGroup } from "@/pages/gym/types";

const BLUE = "217 91% 58%";
const hsl = (a = 1) => `hsl(${BLUE} / ${a})`;

/** Snapshot of the just-finished session, captured in ActiveSessionView BEFORE
 *  `finishSession` clears the active workout. `finishSession` returns only
 *  { ok, calendarEntryId }, so the enriched stats must be snapshotted here. */
export interface WorkoutRecapStats {
  sessionType: string;
  /** ISO date (yyyy-mm-dd) of the session, used by the share card. */
  date: string;
  durationMinutes: number;
  /** Total working-set volume in kg (the premium "effort" number). */
  totalVolume: number;
  /** Completed working sets (warmups excluded). */
  completedSets: number;
  exerciseCount: number;
  /** Unique, human-readable muscle groups trained (spaces, not underscores). */
  muscleGroups: string[];
  /** Number of this session's sets that set a new personal record. */
  prCount: number;
  /** Retained so the Share CTA can render the existing GymSessionCard. */
  exerciseGroups: ExerciseGroup[];
}

interface WorkoutRecapCutsceneProps {
  stats: WorkoutRecapStats;
  /** Only true when finishSession returned a calendar entry to attach media to. */
  canAddPhoto: boolean;
  onShare: () => void;
  onAddPhoto: () => void;
  onDone: () => void;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function WorkoutRecapCutscene({
  stats,
  canAddPhoto,
  onShare,
  onAddPhoto,
  onDone,
}: WorkoutRecapCutsceneProps): JSX.Element {
  const prefersReduced = useReducedMotion();

  const hasVolume = stats.totalVolume > 0;
  const headline = hasVolume
    ? `You moved ${formatVolume(stats.totalVolume)} kg.`
    : "Session in the books.";
  const subLine = `${stats.sessionType} · ${stats.durationMinutes} min · ${stats.completedSets} ${stats.completedSets === 1 ? "set" : "sets"}`;
  const prLine =
    stats.prCount > 0
      ? stats.prCount === 1
        ? "1 new personal record"
        : `${stats.prCount} new personal records`
      : null;
  const musclesLine =
    stats.muscleGroups.length > 0
      ? stats.muscleGroups.map(titleCase).join(" · ")
      : null;

  // Defensive un-stick: a Radix/vaul overlay underneath can leave
  // `document.body { pointer-events: none }` stuck. This takeover is a sibling
  // of <body> so it INHERITS that frozen state and every button reads as
  // pointer-events:none. The root forces pointer-events:auto on itself, and we
  // also clear a stuck body value here. Scoped to mount; never re-applied.
  useEffect(() => {
    if (document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
  }, []);

  // NOTE: the success haptic fires once, from useGymSessions.finishSession
  // (covers every finish path, not just this recap-shown one). Don't add a
  // second celebrateSuccess() here — it would double-fire.

  const stat = (label: string, value: string) => (
    <div className="rounded-2xl border border-border/50 bg-white/[0.03] p-3 text-center">
      <div className="display-number text-[26px] font-extrabold tabular-nums leading-none text-foreground">
        {value}
      </div>
      <div className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
    </div>
  );

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={headline}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[10010] flex flex-col items-center justify-center overflow-hidden bg-background px-7 pointer-events-auto"
      style={{
        pointerEvents: "auto",
        paddingTop: "calc(env(safe-area-inset-top) + 24px)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)",
      }}
    >
      {/* Aurora + rising motes (transform/opacity only, reduced-motion aware). */}
      <WizardAuroraBackground intensity="full" />

      {/* Haloed, bobbing wizard. Halo is a soft radial gradient (no blur added). */}
      <div className="relative z-10 flex items-center justify-center" style={{ height: 148 }}>
        {!prefersReduced && (
          <motion.div
            aria-hidden
            className="absolute rounded-full"
            style={{
              width: 190,
              height: 190,
              background: `radial-gradient(circle, ${hsl(0.4)} 0%, ${hsl(0.12)} 42%, transparent 70%)`,
            }}
            animate={{ opacity: [0.5, 0.85, 0.5], scale: [0.95, 1.06, 0.95] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <motion.img
          src={wizard}
          alt=""
          draggable={false}
          style={{ width: 124, height: 124, objectFit: "contain", position: "relative", zIndex: 2 }}
          initial={prefersReduced ? false : { scale: 0.85, opacity: 0 }}
          animate={
            prefersReduced ? { y: 0, scale: 1, opacity: 1 } : { y: [0, -9, 0], scale: 1, opacity: 1 }
          }
          transition={{
            y: { duration: 3.4, repeat: Infinity, ease: "easeInOut" },
            scale: { type: "spring", damping: 18, stiffness: 240 },
            opacity: { duration: 0.4 },
          }}
        />
      </div>

      {/* Kicker + headline + subcopy. */}
      <motion.p
        initial={prefersReduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.4 }}
        className="relative z-10 mt-5 text-[11px] uppercase tracking-[0.24em] font-bold"
        style={{ color: hsl() }}
      >
        Workout complete
      </motion.p>
      <motion.h2
        initial={prefersReduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.45 }}
        className="relative z-10 mt-2 text-center text-[26px] font-black tracking-tight text-foreground leading-tight max-w-[20rem]"
      >
        {headline}
      </motion.h2>
      <motion.p
        initial={prefersReduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.26, duration: 0.45 }}
        className="relative z-10 mt-2 text-center text-[13px] font-semibold text-muted-foreground"
      >
        {subLine}
      </motion.p>

      {/* PR celebration pill. */}
      {prLine && (
        <motion.div
          initial={prefersReduced ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.34, type: "spring", damping: 16, stiffness: 260 }}
          className="relative z-10 mt-3 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-bold"
          style={{ background: hsl(0.16), color: hsl() }}
        >
          <span aria-hidden>🏆</span>
          {prLine}
        </motion.div>
      )}

      {/* Stat grid. */}
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.36, duration: 0.45 }}
        className="relative z-10 mt-5 grid w-full max-w-[22rem] grid-cols-2 gap-2.5"
      >
        {stat("Volume", hasVolume ? `${formatVolume(stats.totalVolume)} kg` : "BW")}
        {stat("Sets", String(stats.completedSets))}
        {stat("Duration", `${stats.durationMinutes}m`)}
        {stat("Exercises", String(stats.exerciseCount))}
      </motion.div>

      {/* Muscles trained. */}
      {musclesLine && (
        <motion.p
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.44, duration: 0.45 }}
          className="relative z-10 mt-3 text-center text-[11px] font-semibold text-muted-foreground/80 max-w-[22rem]"
        >
          {musclesLine}
        </motion.p>
      )}

      {/* CTAs. */}
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.45 }}
        className="relative z-10 mt-6 w-full max-w-[22rem] flex flex-col gap-2.5"
      >
        <Button onClick={onShare} className="h-12 w-full rounded-2xl text-[15px] font-bold">
          <Share2 className="h-4 w-4" />
          Share workout
        </Button>
        {canAddPhoto && (
          <Button
            variant="outline"
            onClick={onAddPhoto}
            className="h-12 w-full rounded-2xl text-[14px] font-semibold"
          >
            <Camera className="h-4 w-4" />
            Add a photo
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={onDone}
          className="h-11 w-full rounded-2xl text-[14px] font-semibold text-muted-foreground"
        >
          Done
        </Button>
      </motion.div>
    </motion.div>
  );
}
