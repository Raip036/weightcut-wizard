import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { triggerHapticSelection, celebrateSuccess } from "@/lib/haptics";
import type { WellnessCheckIn as WellnessCheckInData } from "@/utils/performanceEngine";
import { logger } from "@/lib/logger";
import { WizardCharacter } from "@/tutorial/WizardCharacter";
import type { WizardPose } from "@/tutorial/types";
import { WellnessResult } from "./WellnessResult";

type MascotMood = "idle" | "happy" | "concerned" | "thinking";

interface WellnessCheckInProps {
  userId: string;
  onSubmit: (checkIn: WellnessCheckInData) => void;
  isSubmitting?: boolean;
  streak?: number;
}

/**
 * Adaptive 4-tap wellness check-in. Four core questions (sleep / body /
 * soreness / stress) each auto-advance on tap. A concerning answer inserts ONE
 * targeted follow-up so a good day stays four taps but a rough one captures the
 * detail that improves the recovery read. After submitting, a trend-aware
 * result screen (`WellnessResult`) shows the personalised readiness number.
 *
 * Convention: SLEEP is "higher = better"; the other three are "higher = worse".
 * Numeric values map 1:1 to the Hooper 1-7 scale (middle chip = 4). The Hooper
 * index (`sleep + (8-stress) + (8-fatigue) + (8-soreness)`, range 4-28, higher
 * = fresher) is what feeds the fight-form-score ring.
 */
type Chip = { label: string; value: number; tone: "good" | "okay" | "warn" | "bad" | "verybad" };

const SLEEP_CHIPS: Chip[] = [
  { label: "Barely", value: 1, tone: "verybad" },
  { label: "Poor", value: 3, tone: "bad" },
  { label: "OK", value: 4, tone: "okay" },
  { label: "Good", value: 6, tone: "warn" },
  { label: "Great", value: 7, tone: "good" },
];

const FATIGUE_CHIPS: Chip[] = [
  { label: "Fresh", value: 1, tone: "good" },
  { label: "Good", value: 3, tone: "warn" },
  { label: "OK", value: 4, tone: "okay" },
  { label: "Tired", value: 5, tone: "bad" },
  { label: "Drained", value: 7, tone: "verybad" },
];

const SORENESS_CHIPS: Chip[] = [
  { label: "None", value: 1, tone: "good" },
  { label: "Mild", value: 3, tone: "warn" },
  { label: "Some", value: 4, tone: "okay" },
  { label: "Sore", value: 5, tone: "bad" },
  { label: "Wrecked", value: 7, tone: "verybad" },
];

const STRESS_CHIPS: Chip[] = [
  { label: "Calm", value: 1, tone: "good" },
  { label: "Easy", value: 3, tone: "warn" },
  { label: "OK", value: 4, tone: "okay" },
  { label: "Tense", value: 5, tone: "bad" },
  { label: "Frazzled", value: 7, tone: "verybad" },
];

const QUESTIONS = [
  { key: "sleep_quality" as const, prompt: "How did you sleep?", chips: SLEEP_CHIPS, short: "Sleep" },
  { key: "fatigue_level" as const, prompt: "How does your body feel?", chips: FATIGUE_CHIPS, short: "Body" },
  { key: "soreness_level" as const, prompt: "How sore are you?", chips: SORENESS_CHIPS, short: "Sore" },
  { key: "stress_level" as const, prompt: "How's your stress?", chips: STRESS_CHIPS, short: "Stress" },
] as const;

const SORENESS_AREAS = ["Legs", "Back", "Arms", "All over"];

/* ─── Adaptive screen model ──────────────────────────────────────────────
 * The flow is a list of screens derived from the current answers. A core
 * question that's answered "concerning" appends ONE follow-up right after it.
 * Defaults sit at the neutral middle (4), so follow-ups only appear once the
 * user actively picks an extreme — a good day never sees them. */
type Screen =
  | { id: string; kind: "core"; qIndex: number }
  | { id: string; kind: "followup"; ftype: "sleepHours" | "sorenessArea" | "energy" };

function buildScreens(answers: Record<string, number>): Screen[] {
  const screens: Screen[] = [];
  QUESTIONS.forEach((q, qIndex) => {
    screens.push({ id: q.key, kind: "core", qIndex });
    const v = answers[q.key];
    if (q.key === "sleep_quality" && v <= 3) screens.push({ id: "f-sleep", kind: "followup", ftype: "sleepHours" });
    if (q.key === "fatigue_level" && v >= 5) screens.push({ id: "f-fatigue", kind: "followup", ftype: "energy" });
    if (q.key === "soreness_level" && v >= 5) screens.push({ id: "f-soreness", kind: "followup", ftype: "sorenessArea" });
  });
  return screens;
}

function toneClasses(tone: Chip["tone"], active: boolean): string {
  if (!active) {
    return "bg-muted/40 text-foreground/75 active:bg-muted/60 border-transparent ring-1 ring-white/10";
  }
  switch (tone) {
    case "good": return "bg-muted/40 text-func-recovery-green border-func-recovery-green/60";
    case "warn": return "bg-muted/40 text-func-recovery-green border-func-recovery-green/40";
    case "okay": return "bg-muted/40 text-primary border-primary/50";
    case "bad": return "bg-muted/40 text-func-warning-yellow border-func-warning-yellow/50";
    case "verybad": return "bg-muted/40 text-func-danger-red border-func-danger-red/60";
  }
}

function useCountUp(target: number, duration = 600): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (target <= 0) {
      setValue(0);
      return;
    }
    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
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

const REACTION: Record<Exclude<MascotMood, "idle">, string[]> = {
  happy: ["Strong.", "Love it.", "Good signs.", "Nice."],
  concerned: ["Noted — we'll adjust.", "Thanks for the honesty.", "Good to know.", "Got it."],
  thinking: ["Okay.", "Mm-hm.", "Right.", "Logged."],
};

export function WellnessCheckIn({ userId, onSubmit, isSubmitting, streak }: WellnessCheckInProps) {
  void userId; // userId is now derived from Convex auth; kept for backward compat.
  const upsertCheckin = useMutation(api.wellness.upsertCheckin);
  const context = useQuery(api.wellness.getCheckinContext, {});
  const prefersReducedMotion = useReducedMotion();

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [answers, setAnswers] = useState<Record<string, number>>({
    sleep_quality: 4,
    fatigue_level: 4,
    soreness_level: 4,
    stress_level: 4,
  });
  const [showOptional, setShowOptional] = useState(false);
  const [optional, setOptional] = useState({
    sleep_hours: null as number | null,
    hydration_feeling: null as number | null,
    appetite_level: null as number | null,
    energy_level: null as number | null,
    motivation_level: null as number | null,
  });
  const [sorenessAreas, setSorenessAreas] = useState<string[]>([]);
  const [hasInteracted, setHasInteracted] = useState(false);

  const [phase, setPhase] = useState<"survey" | "result">("survey");
  const [savedData, setSavedData] = useState<WellnessCheckInData | null>(null);

  const streakValue = useCountUp(streak ?? 0, 600);
  const showStreak = typeof streak === "number" && streak >= 1;

  const [mascotMood, setMascotMood] = useState<MascotMood>("idle");
  const [mascotPose, setMascotPose] = useState<WizardPose>("wave");
  const mascotResetRef = useRef<number | null>(null);

  // Settle the entrance wave into the idle bob after it plays once.
  useEffect(() => {
    const t = window.setTimeout(() => setMascotPose("idle"), 900);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => () => {
    if (mascotResetRef.current != null) window.clearTimeout(mascotResetRef.current);
  }, []);

  const reactToChip = (questionKey: string, value: number) => {
    let mood: MascotMood;
    if (questionKey === "sleep_quality") {
      mood = value >= 5 ? "happy" : value <= 3 ? "concerned" : "thinking";
    } else {
      mood = value <= 3 ? "happy" : value >= 5 ? "concerned" : "thinking";
    }
    setMascotMood(mood);
    if (mascotResetRef.current != null) window.clearTimeout(mascotResetRef.current);
    mascotResetRef.current = window.setTimeout(() => setMascotMood("idle"), 1400);
  };

  const screens = useMemo(() => buildScreens(answers), [answers]);
  const onSummary = step >= screens.length;
  const currentScreen = onSummary ? null : screens[step];

  const hooperIndex = useMemo(
    () => answers.sleep_quality + (8 - answers.stress_level) + (8 - answers.fatigue_level) + (8 - answers.soreness_level),
    [answers],
  );
  const hooperLabel = hooperIndex >= 22 ? "Great" : hooperIndex >= 16 ? "Good" : hooperIndex >= 10 ? "Fair" : "Poor";
  const hooperColor = hooperIndex >= 22 ? "text-func-recovery-green" : hooperIndex >= 16 ? "text-primary" : hooperIndex >= 10 ? "text-func-warning-yellow" : "text-func-danger-red";
  const hooperVerdict = hooperIndex >= 22
    ? "Locked in — push today."
    : hooperIndex >= 16
      ? "Solid base — train smart."
      : hooperIndex >= 10
        ? "Run easy and watch fatigue."
        : "Recover hard today.";

  // Context-aware mascot line. The opener references yesterday's hardest
  // session when it was a genuinely hard day; after that it's a short reaction.
  const mascotLine = useMemo(() => {
    if (!hasInteracted) {
      const t = context?.lastTraining;
      if (t && t.rpe >= 7) {
        const label = (t.sessionTag ?? t.sessionType) || "training";
        return `Big ${label.toLowerCase()} session yesterday.`;
      }
      if (context?.yesterday?.hooper != null && context.yesterday.hooper <= 12) {
        return "You were run down yesterday — let's see today.";
      }
      return "Morning — let's see how you're recovering.";
    }
    if (mascotMood === "idle") return "";
    const opts = REACTION[mascotMood];
    return opts[step % opts.length];
  }, [hasInteracted, mascotMood, step, context]);

  const advance = () => {
    setDirection(1);
    setTimeout(() => setStep((s) => s + 1), 200);
  };

  const pickChip = (key: string, value: number) => {
    triggerHapticSelection();
    setHasInteracted(true);
    reactToChip(key, value);
    setAnswers((prev) => ({ ...prev, [key]: value }));
    advance();
  };

  const pickSleepHours = (v: number) => {
    triggerHapticSelection();
    setOptional((p) => ({ ...p, sleep_hours: v }));
    advance();
  };
  const pickEnergy = (v: number) => {
    triggerHapticSelection();
    setMascotMood(v >= 4 ? "happy" : v <= 2 ? "concerned" : "thinking");
    setOptional((p) => ({ ...p, energy_level: v }));
    advance();
  };
  const pickSorenessArea = (area: string) => {
    triggerHapticSelection();
    setSorenessAreas([area]);
    advance();
  };

  const handleBack = () => {
    triggerHapticSelection();
    setDirection(-1);
    setStep((s) => Math.max(0, s - 1));
  };

  const goToCore = (qKey: string) => {
    triggerHapticSelection();
    const idx = screens.findIndex((s) => s.kind === "core" && QUESTIONS[s.qIndex].key === qKey);
    if (idx >= 0) {
      setDirection(-1);
      setStep(idx);
    }
  };

  const handleSubmit = async () => {
    const checkInData: WellnessCheckInData = {
      sleep_quality: answers.sleep_quality,
      stress_level: answers.stress_level,
      fatigue_level: answers.fatigue_level,
      soreness_level: answers.soreness_level,
      energy_level: optional.energy_level,
      motivation_level: optional.motivation_level,
      sleep_hours: optional.sleep_hours,
      hydration_feeling: optional.hydration_feeling,
      appetite_level: optional.appetite_level,
      hooper_index: hooperIndex,
    };
    const _now = new Date();
    const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;
    try {
      await upsertCheckin({
        date: today,
        sleepQuality: answers.sleep_quality,
        fatigueLevel: answers.fatigue_level,
        sorenessLevel: answers.soreness_level,
        stressLevel: answers.stress_level,
        energyLevel: optional.energy_level ?? undefined,
        motivationLevel: optional.motivation_level ?? undefined,
        sleepHours: optional.sleep_hours ?? undefined,
        hydrationFeeling: optional.hydration_feeling ?? undefined,
        appetiteLevel: optional.appetite_level ?? undefined,
        sorenessAreas: sorenessAreas.length ? sorenessAreas : undefined,
        hooperIndex,
      });
      celebrateSuccess();
    } catch (err) {
      logger.error("Failed to persist wellness check-in", err);
    }
    setSavedData(checkInData);
    setMascotPose(hooperIndex >= 16 ? "celebrate" : "idle");
    setPhase("result");
  };

  // ─── Result screen ────────────────────────────────────────────────────
  if (phase === "result") {
    return (
      <WellnessResult
        hooper={hooperIndex}
        recent={context?.recent ?? []}
        recentAvg={context?.recentAvg ?? null}
        answers={{
          sleep_quality: answers.sleep_quality,
          fatigue_level: answers.fatigue_level,
          soreness_level: answers.soreness_level,
          stress_level: answers.stress_level,
        }}
        sorenessAreas={sorenessAreas}
        onDone={() => savedData && onSubmit(savedData)}
      />
    );
  }

  const totalDots = screens.length + 1; // +1 for the summary step

  return (
    <div className="space-y-3 select-none">
      {showStreak && (
        <div className="flex justify-center">
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="inline-flex items-center gap-1.5 rounded-full text-func-carbs-orange border border-func-carbs-orange/30 px-3 py-1 text-[12px] font-semibold tabular-nums"
            aria-label={`${streak}-day check-in streak`}
          >
            <Icon name="flameOutline" size={14} className="text-func-carbs-orange" />
            <span>{streakValue}-day streak</span>
          </motion.div>
        </div>
      )}

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-1.5">
        {Array.from({ length: totalDots }).map((_, i) => {
          const isCompleted = i < step;
          const isActive = i === step;
          return (
            <motion.div
              key={i}
              layout
              transition={{ type: "spring", damping: 26, stiffness: 320 }}
              className={`h-1.5 rounded-full transition-colors duration-300 ${
                isActive ? "w-6 bg-primary" : isCompleted ? "w-1.5 bg-func-recovery-green/80" : "w-1.5 bg-muted-foreground/40"
              }`}
            />
          );
        })}
      </div>

      {/* Animated mascot + contextual line — hidden on summary to keep it focused */}
      {!onSummary && (
        <div className="flex flex-col items-center -mb-1">
          <motion.div
            aria-hidden="true"
            animate={
              prefersReducedMotion
                ? mascotMood === "idle"
                  ? { opacity: 1 }
                  : { opacity: [1, 0.7, 1] }
                : mascotMood === "happy"
                  ? { scale: [1, 1.08, 1], rotate: [-2, 2, 0] }
                  : mascotMood === "concerned"
                    ? { rotate: [0, -3, 3, 0], scale: [1, 0.96, 1] }
                    : mascotMood === "thinking"
                      ? { rotate: [0, 3, -3, 0] }
                      : { scale: 1, rotate: 0 }
            }
            transition={{ duration: 0.6, ease: "easeInOut" }}
            className="h-[96px] flex items-center justify-center"
            style={{ willChange: "transform" }}
          >
            <div className="scale-[0.66] origin-center">
              <WizardCharacter pose={mascotPose} />
            </div>
          </motion.div>
          <AnimatePresence mode="wait">
            {mascotLine && (
              <motion.p
                key={mascotLine}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: 0.22 }}
                className="text-[12px] text-muted-foreground/80 font-medium h-4"
              >
                {mascotLine}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="relative min-h-[230px]">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          {currentScreen?.kind === "core" && (
            <CoreQuestionCard
              key={`q-${currentScreen.id}`}
              q={QUESTIONS[currentScreen.qIndex]}
              answer={answers[QUESTIONS[currentScreen.qIndex].key]}
              direction={direction}
              prefersReducedMotion={!!prefersReducedMotion}
              showBack={step > 0}
              onPick={pickChip}
              onBack={handleBack}
            />
          )}

          {currentScreen?.kind === "followup" && (
            <FollowUpCard
              key={`f-${currentScreen.id}`}
              ftype={currentScreen.ftype}
              direction={direction}
              prefersReducedMotion={!!prefersReducedMotion}
              sleepHours={optional.sleep_hours}
              energy={optional.energy_level}
              sorenessAreas={sorenessAreas}
              onPickSleepHours={pickSleepHours}
              onPickEnergy={pickEnergy}
              onPickSorenessArea={pickSorenessArea}
              onBack={handleBack}
            />
          )}

          {onSummary && (
            <motion.div
              key="summary"
              initial={prefersReducedMotion ? false : { opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: -14 }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              className="absolute inset-0 flex flex-col gap-3 px-1"
            >
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.05, type: "spring", stiffness: 260, damping: 22 }}
                className="flex flex-col items-center text-center gap-0.5 pt-1"
              >
                <span className={`text-[56px] leading-none font-display font-bold tabular-nums ${hooperColor}`}>
                  {hooperIndex}
                </span>
                <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70 mt-1">of 28</span>
                <span className={`text-[16px] font-semibold mt-1 ${hooperColor}`}>{hooperLabel}</span>
                <p className="text-[13px] text-foreground/70 mt-0.5">{hooperVerdict}</p>
              </motion.div>

              <p className="text-[11px] text-muted-foreground/70 inline-flex items-center justify-center gap-1.5">
                <Icon name="checkmarkOutline" size={12} className="text-func-recovery-green" /> Tap any answer to edit
              </p>

              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12, type: "spring", stiffness: 260, damping: 24 }}
                className="grid grid-cols-4 gap-1.5"
              >
                {QUESTIONS.map((q, idx) => {
                  const c = q.chips.find((chip) => chip.value === answers[q.key]);
                  return (
                    <motion.button
                      key={q.key}
                      type="button"
                      onClick={() => goToCore(q.key)}
                      initial={prefersReducedMotion ? false : { opacity: 0, y: 6, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ delay: 0.14 + idx * 0.04, type: "spring", stiffness: 320, damping: 22 }}
                      whileTap={prefersReducedMotion ? undefined : { scale: 0.94 }}
                      className={`card-surface rounded-xl py-2 flex flex-col items-center gap-0.5 transition-colors border ${
                        c ? toneClasses(c.tone, true) : "border-transparent"
                      }`}
                      aria-label={`Edit ${q.prompt}`}
                    >
                      <span className="text-[12px] font-bold tracking-tight">{c?.label ?? "—"}</span>
                      <span className="text-[9px] uppercase tracking-wide text-foreground/60">{q.short}</span>
                    </motion.button>
                  );
                })}
              </motion.div>

              <button
                type="button"
                onClick={() => setShowOptional((v) => !v)}
                className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground/80 active:text-foreground transition-colors mt-1"
              >
                <Icon name={showOptional ? "chevronUpOutline" : "chevronDownOutline"} size={12} className="text-muted-foreground/80" />
                {showOptional ? "Hide extra detail" : "Add extra detail (optional)"}
              </button>

              <AnimatePresence initial={false}>
                {showOptional && (
                  <motion.div
                    initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2.5 pt-1">
                      <OptionalRow label="Sleep hours" value={optional.sleep_hours} suffix="h" options={[5, 6, 7, 8, 9]} onPick={(v) => setOptional((p) => ({ ...p, sleep_hours: v }))} />
                      <OptionalScaleRow label="Hydration" value={optional.hydration_feeling} leftHint="Dry" rightHint="Hydrated" onPick={(v) => setOptional((p) => ({ ...p, hydration_feeling: v }))} />
                      <OptionalScaleRow label="Appetite" value={optional.appetite_level} leftHint="None" rightHint="Hungry" onPick={(v) => setOptional((p) => ({ ...p, appetite_level: v }))} />
                      <OptionalScaleRow label="Energy" value={optional.energy_level} leftHint="Empty" rightHint="Full" onPick={(v) => setOptional((p) => ({ ...p, energy_level: v }))} />
                      <OptionalScaleRow label="Motivation" value={optional.motivation_level} leftHint="Low" rightHint="High" onPick={(v) => setOptional((p) => ({ ...p, motivation_level: v }))} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
                transition={{ delay: 0.18, type: "spring", stiffness: 320, damping: 24 }}
                className="mt-1"
              >
                <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full rounded-xl h-12 font-semibold">
                  {isSubmitting ? "Analyzing..." : "See my readiness"}
                </Button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─── Core question card ─────────────────────────────────────────────── */
function CoreQuestionCard({
  q,
  answer,
  direction,
  prefersReducedMotion,
  showBack,
  onPick,
  onBack,
}: {
  q: (typeof QUESTIONS)[number];
  answer: number;
  direction: 1 | -1;
  prefersReducedMotion: boolean;
  showBack: boolean;
  onPick: (key: string, value: number) => void;
  onBack: () => void;
}) {
  return (
    <motion.div
      custom={direction}
      initial={prefersReducedMotion ? false : { opacity: 0, x: direction === 1 ? 14 : -14 }}
      animate={{ opacity: 1, x: 0 }}
      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: direction === 1 ? -14 : 14 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="absolute inset-x-0 top-0 flex flex-col items-center justify-start text-center gap-4 px-1"
    >
      <motion.h3
        initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06, type: "spring", stiffness: 280, damping: 24 }}
        className="text-[20px] font-bold tracking-tight text-foreground"
      >
        {q.prompt}
      </motion.h3>
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, type: "spring", stiffness: 260, damping: 22 }}
        className="flex w-full flex-col sm:flex-row gap-2 mt-1"
      >
        {q.chips.map((c, chipIdx) => {
          const active = answer === c.value;
          return (
            <motion.button
              key={c.value}
              type="button"
              onClick={() => onPick(q.key, c.value)}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 8, scale: 0.96 }}
              animate={prefersReducedMotion ? { opacity: 1 } : active ? { opacity: 1, y: 0, scale: [1, 1.05, 1] } : { opacity: 1, y: 0, scale: 1 }}
              whileTap={prefersReducedMotion ? undefined : { scale: 0.92 }}
              transition={{ delay: 0.1 + chipIdx * 0.035, type: "spring", stiffness: 320, damping: 22 }}
              className={`flex-1 min-h-[56px] rounded-xl text-[14px] font-semibold tracking-tight border transition-colors ${toneClasses(c.tone, active)}`}
              aria-label={c.label}
              aria-pressed={active}
            >
              {c.label}
            </motion.button>
          );
        })}
      </motion.div>
      {showBack && (
        <button type="button" onClick={onBack} className="text-[11px] text-muted-foreground/60 active:text-foreground transition-colors mt-1">
          Back
        </button>
      )}
    </motion.div>
  );
}

/* ─── Adaptive follow-up card ────────────────────────────────────────── */
function FollowUpCard({
  ftype,
  direction,
  prefersReducedMotion,
  sleepHours,
  energy,
  sorenessAreas,
  onPickSleepHours,
  onPickEnergy,
  onPickSorenessArea,
  onBack,
}: {
  ftype: "sleepHours" | "sorenessArea" | "energy";
  direction: 1 | -1;
  prefersReducedMotion: boolean;
  sleepHours: number | null;
  energy: number | null;
  sorenessAreas: string[];
  onPickSleepHours: (v: number) => void;
  onPickEnergy: (v: number) => void;
  onPickSorenessArea: (area: string) => void;
  onBack: () => void;
}) {
  const config =
    ftype === "sleepHours"
      ? { prompt: "Roughly how many hours?", hint: "A rough number is fine." }
      : ftype === "energy"
        ? { prompt: "Energy in the tank?", hint: "Be honest — it tunes today's plan." }
        : { prompt: "Where's it worst?", hint: "Helps target your recovery." };

  return (
    <motion.div
      custom={direction}
      initial={prefersReducedMotion ? false : { opacity: 0, x: direction === 1 ? 14 : -14 }}
      animate={{ opacity: 1, x: 0 }}
      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: direction === 1 ? -14 : 14 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className="absolute inset-x-0 top-0 flex flex-col items-center justify-start text-center gap-3 px-1"
    >
      <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-primary/80">Quick follow-up</span>
      <motion.h3
        initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.04, type: "spring", stiffness: 280, damping: 24 }}
        className="text-[20px] font-bold tracking-tight text-foreground"
      >
        {config.prompt}
      </motion.h3>

      {ftype === "sleepHours" && (
        <div className="flex w-full gap-2 mt-1">
          {[4, 5, 6, 7, 8].map((h, i) => (
            <FollowUpChip key={h} idx={i} active={sleepHours === h} prefersReducedMotion={prefersReducedMotion} onClick={() => onPickSleepHours(h)}>
              {h === 4 ? "≤4" : h === 8 ? "8+" : h}h
            </FollowUpChip>
          ))}
        </div>
      )}

      {ftype === "energy" && (
        <div className="flex w-full gap-2 mt-1">
          {[1, 2, 3, 4, 5].map((v, i) => (
            <FollowUpChip key={v} idx={i} active={energy === v} prefersReducedMotion={prefersReducedMotion} onClick={() => onPickEnergy(v)}>
              {v}
            </FollowUpChip>
          ))}
        </div>
      )}

      {ftype === "sorenessArea" && (
        <div className="grid grid-cols-2 gap-2 w-full mt-1">
          {SORENESS_AREAS.map((area, i) => (
            <FollowUpChip key={area} idx={i} active={sorenessAreas.includes(area)} prefersReducedMotion={prefersReducedMotion} onClick={() => onPickSorenessArea(area)}>
              {area}
            </FollowUpChip>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/60 mt-0.5">{config.hint}</p>
      <button type="button" onClick={onBack} className="text-[11px] text-muted-foreground/60 active:text-foreground transition-colors">
        Back
      </button>
    </motion.div>
  );
}

function FollowUpChip({
  children,
  idx,
  active,
  prefersReducedMotion,
  onClick,
}: {
  children: ReactNode;
  idx: number;
  active: boolean;
  prefersReducedMotion: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileTap={prefersReducedMotion ? undefined : { scale: 0.92 }}
      transition={{ delay: 0.08 + idx * 0.04, type: "spring", stiffness: 320, damping: 22 }}
      className={`flex-1 min-h-[52px] rounded-xl text-[14px] font-semibold tracking-tight border transition-colors ${
        active ? "bg-muted/40 text-primary border-primary/50" : "bg-muted/40 text-foreground/75 active:bg-muted/60 border-transparent ring-1 ring-white/10"
      }`}
    >
      {children}
    </motion.button>
  );
}

function OptionalRow({
  label,
  value,
  suffix,
  options,
  onPick,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  options: number[];
  onPick: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-foreground/75">{label}</span>
        <span className="text-[11px] font-bold text-foreground/55 tabular-nums">{value != null ? `${value}${suffix ?? ""}` : "—"}</span>
      </div>
      <div className="flex gap-1">
        {options.map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => { triggerHapticSelection(); onPick(opt); }}
              className={`flex-1 h-8 rounded-xs text-[12px] font-semibold tabular-nums transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground/80 active:bg-muted/60"}`}
            >
              {opt}{suffix ?? ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OptionalScaleRow({
  label,
  value,
  leftHint,
  rightHint,
  onPick,
}: {
  label: string;
  value: number | null;
  leftHint: string;
  rightHint: string;
  onPick: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-foreground/75">{label}</span>
        <span className="text-[11px] font-bold text-foreground/55 tabular-nums">{value != null ? `${value}/5` : "—"}</span>
      </div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((v) => {
          const active = value === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => { triggerHapticSelection(); onPick(v); }}
              className={`flex-1 h-8 rounded-xs text-[12px] font-semibold tabular-nums transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground/80 active:bg-muted/60"}`}
            >
              {v}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between mt-0.5 px-0.5">
        <span className="text-[9px] text-muted-foreground/60">{leftHint}</span>
        <span className="text-[9px] text-muted-foreground/60">{rightHint}</span>
      </div>
    </div>
  );
}
