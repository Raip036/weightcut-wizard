import { useState, useMemo, useEffect, useRef } from "react";
import { Brain, ChevronDown, ChevronUp, Check, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "motion/react";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { triggerHapticSelection, celebrateSuccess } from "@/lib/haptics";
import type { WellnessCheckIn as WellnessCheckInData } from "@/utils/performanceEngine";
import { logger } from "@/lib/logger";

interface WellnessCheckInProps {
  userId: string;
  onSubmit: (checkIn: WellnessCheckInData) => void;
  isSubmitting?: boolean;
  streak?: number;
}

/**
 * Five-step labelled scale per question, one card at a time. Tap a chip and
 * the card auto-advances. Numeric values map 1:1 to the original Hooper 1-7
 * scale (with the middle chip landing on 4) so the performanceEngine still
 * receives the shape it always has.
 *
 * Convention: SLEEP is "higher = better" (matches the survey wording). The
 * other three are "higher = worse" — we keep the raw direction so the
 * existing math doesn't change. The colour ramp is *always* green→red from
 * good to bad regardless of value direction.
 */
type Chip = { label: string; value: number; tone: "good" | "okay" | "warn" | "bad" | "verybad" };

// Sleep: 1 (worst) → 7 (best). Five chips left→right run worst→best.
const SLEEP_CHIPS: Chip[] = [
  { label: "Barely",  value: 1, tone: "verybad" },
  { label: "Poor",    value: 3, tone: "bad" },
  { label: "OK",      value: 4, tone: "okay" },
  { label: "Good",    value: 6, tone: "warn" },
  { label: "Great",   value: 7, tone: "good" },
];

// Fatigue, soreness, stress: 1 = best (fresh/none/calm), 7 = worst.
// Five chips left→right run best→worst so layout matches sleep visually.
const FATIGUE_CHIPS: Chip[] = [
  { label: "Fresh",   value: 1, tone: "good" },
  { label: "Good",    value: 3, tone: "warn" },
  { label: "OK",      value: 4, tone: "okay" },
  { label: "Tired",   value: 5, tone: "bad" },
  { label: "Drained", value: 7, tone: "verybad" },
];

const SORENESS_CHIPS: Chip[] = [
  { label: "None",    value: 1, tone: "good" },
  { label: "Mild",    value: 3, tone: "warn" },
  { label: "Some",    value: 4, tone: "okay" },
  { label: "Sore",    value: 5, tone: "bad" },
  { label: "Wrecked", value: 7, tone: "verybad" },
];

const STRESS_CHIPS: Chip[] = [
  { label: "Calm",     value: 1, tone: "good" },
  { label: "Easy",     value: 3, tone: "warn" },
  { label: "OK",       value: 4, tone: "okay" },
  { label: "Tense",    value: 5, tone: "bad" },
  { label: "Frazzled", value: 7, tone: "verybad" },
];

const QUESTIONS = [
  { key: "sleep_quality" as const,  prompt: "How did you sleep?",      chips: SLEEP_CHIPS,    short: "Sleep" },
  { key: "fatigue_level" as const,  prompt: "How does your body feel?", chips: FATIGUE_CHIPS, short: "Body" },
  { key: "soreness_level" as const, prompt: "How sore are you?",        chips: SORENESS_CHIPS, short: "Sore" },
  { key: "stress_level" as const,   prompt: "How's your stress?",       chips: STRESS_CHIPS,  short: "Stress" },
] as const;

function toneClasses(tone: Chip["tone"], active: boolean): string {
  if (!active) {
    return "bg-muted/40 text-foreground/75 active:bg-muted/60 border-transparent ring-1 ring-white/10";
  }
  switch (tone) {
    case "good":    return "bg-emerald-800/60 text-emerald-50 border-emerald-700";
    case "warn":    return "bg-teal-800/60 text-teal-50 border-teal-700";
    case "okay":    return "bg-amber-800/60 text-amber-50 border-amber-700";
    case "bad":     return "bg-orange-900/60 text-orange-50 border-orange-800";
    case "verybad": return "bg-rose-900/60 text-rose-50 border-rose-800";
  }
}

/**
 * Count-up hook. Drives a number from 0 → target over `duration` ms using
 * requestAnimationFrame so it's smooth and pauses correctly when the tab
 * is backgrounded. Respects `prefers-reduced-motion` — if the user has it
 * on, we skip the animation and return the final value immediately.
 */
function useCountUp(target: number, duration = 600): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target <= 0) {
      setValue(0);
      return;
    }
    const reduce = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out cubic for a snappy finish
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return value;
}

export function WellnessCheckIn({ userId, onSubmit, isSubmitting, streak }: WellnessCheckInProps) {
  void userId; // userId is now derived from Convex auth; kept for backward compat.
  const upsertCheckin = useMutation(api.wellness.upsertCheckin);

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

  const streakValue = useCountUp(streak ?? 0, 600);
  const showStreak = typeof streak === "number" && streak >= 1;

  const onSummary = step >= QUESTIONS.length;
  const currentQ = onSummary ? null : QUESTIONS[step];

  const hooperIndex = useMemo(
    () => answers.sleep_quality + (8 - answers.stress_level) + (8 - answers.fatigue_level) + (8 - answers.soreness_level),
    [answers],
  );
  const hooperLabel = hooperIndex >= 22 ? "Great" : hooperIndex >= 16 ? "Good" : hooperIndex >= 10 ? "Fair" : "Poor";
  const hooperColor = hooperIndex >= 22 ? "text-func-recovery-green" : hooperIndex >= 16 ? "text-blue-400" : hooperIndex >= 10 ? "text-func-warning-yellow" : "text-func-danger-red";
  const hooperVerdict = hooperIndex >= 22
    ? "Locked in — push today."
    : hooperIndex >= 16
      ? "Solid base — train smart."
      : hooperIndex >= 10
        ? "Run easy and watch fatigue."
        : "Recover hard today.";

  const pickChip = (key: string, value: number) => {
    triggerHapticSelection();
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setDirection(1);
    setTimeout(() => setStep((s) => s + 1), 200);
  };

  const handleBack = () => {
    triggerHapticSelection();
    setDirection(-1);
    setStep((s) => Math.max(0, s - 1));
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

    // Local date — must match the dashboard's TodayStrip query so the
    // Wellness pill lights up immediately, even just past local midnight.
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
        hooperIndex,
      });
      celebrateSuccess();
    } catch (err) {
      logger.error("Failed to persist wellness check-in", err);
    }
    onSubmit(checkInData);
  };

  return (
    <div className="space-y-3 select-none">
      {/* Streak chip — only when streak >= 1 */}
      {showStreak && (
        <div className="flex justify-center">
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="inline-flex items-center gap-1.5 rounded-full bg-func-carbs-orange/15 text-func-carbs-orange border border-func-carbs-orange/30 px-3 py-1 text-[12px] font-semibold tabular-nums"
            aria-label={`${streak}-day check-in streak`}
          >
            <Flame className="h-3.5 w-3.5" />
            <span>{streakValue}-day streak</span>
          </motion.div>
        </div>
      )}

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-1.5">
        {QUESTIONS.map((_, i) => {
          const isCompleted = i < step;
          const isActive = i === step;
          return (
            <motion.div
              key={i}
              layout
              transition={{ type: "spring", damping: 26, stiffness: 320 }}
              className={`h-1.5 rounded-full transition-colors duration-300 ${
                isActive
                  ? "w-6 bg-primary"
                  : isCompleted
                    ? "w-1.5 bg-func-recovery-green/80"
                    : "w-1.5 bg-muted-foreground/40"
              }`}
            />
          );
        })}
        <motion.div
          layout
          transition={{ type: "spring", damping: 26, stiffness: 320 }}
          className={`h-1.5 rounded-full transition-colors duration-300 ${
            onSummary ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/40"
          }`}
        />
      </div>

      <div className="relative min-h-[230px]">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          {currentQ && (
            <motion.div
              key={`q-${step}`}
              custom={direction}
              initial={{ opacity: 0, x: direction === 1 ? 10 : -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction === 1 ? -10 : 10 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 flex flex-col items-center justify-center text-center gap-4 px-1"
            >
              <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/70">
                {step + 1} of {QUESTIONS.length}
              </p>
              <h3 className="text-[20px] font-bold tracking-tight text-foreground">
                {currentQ.prompt}
              </h3>
              <div className="flex w-full flex-col sm:flex-row gap-2 mt-1">
                {currentQ.chips.map((c) => {
                  const active = answers[currentQ.key] === c.value;
                  return (
                    <motion.button
                      key={c.value}
                      type="button"
                      onClick={() => pickChip(currentQ.key, c.value)}
                      whileTap={{ scale: 0.92 }}
                      animate={active ? { scale: [1, 1.03, 1] } : { scale: 1 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className={`flex-1 min-h-[56px] rounded-xl text-[14px] font-semibold tracking-tight border transition-colors ${toneClasses(c.tone, active)}`}
                      aria-label={c.label}
                      aria-pressed={active}
                    >
                      {c.label}
                    </motion.button>
                  );
                })}
              </div>
              {step > 0 && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="text-[11px] text-muted-foreground/60 active:text-foreground transition-colors mt-1"
                >
                  Back
                </button>
              )}
            </motion.div>
          )}

          {onSummary && (
            <motion.div
              key="summary"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 flex flex-col gap-3 px-1"
            >
              {/* Headline: big Hooper number + label + verdict */}
              <div className="flex flex-col items-center text-center gap-0.5 pt-1">
                <span className={`text-[56px] leading-none font-display font-bold tabular-nums ${hooperColor}`}>
                  {hooperIndex}
                </span>
                <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70 mt-1">
                  of 28
                </span>
                <span className={`text-[16px] font-semibold mt-1 ${hooperColor}`}>
                  {hooperLabel}
                </span>
                <p className="text-[13px] text-foreground/70 mt-0.5">
                  {hooperVerdict}
                </p>
              </div>

              <p className="text-[11px] text-muted-foreground/70 inline-flex items-center justify-center gap-1.5">
                <Check className="h-3 w-3 text-func-recovery-green" /> Tap any answer to edit
              </p>

              {/* Tap-to-edit recap row */}
              <div className="grid grid-cols-4 gap-1.5">
                {QUESTIONS.map((q, idx) => {
                  const c = q.chips.find((chip) => chip.value === answers[q.key]);
                  return (
                    <motion.button
                      key={q.key}
                      type="button"
                      onClick={() => { triggerHapticSelection(); setDirection(-1); setStep(idx); }}
                      whileTap={{ scale: 0.94 }}
                      className={`card-surface rounded-xl py-2 flex flex-col items-center gap-0.5 transition-colors border ${
                        c ? toneClasses(c.tone, true) : "border-transparent"
                      }`}
                      aria-label={`Edit ${q.prompt}`}
                    >
                      <span className="text-[12px] font-bold tracking-tight">{c?.label ?? "—"}</span>
                      <span className="text-[9px] uppercase tracking-wide text-foreground/60">
                        {q.short}
                      </span>
                    </motion.button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setShowOptional((v) => !v)}
                className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground/80 active:text-foreground transition-colors mt-1"
              >
                {showOptional ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showOptional ? "Hide extra detail" : "Add extra detail (optional)"}
              </button>

              <AnimatePresence initial={false}>
                {showOptional && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2.5 pt-1">
                      <OptionalRow
                        label="Sleep hours"
                        value={optional.sleep_hours}
                        suffix="h"
                        options={[5, 6, 7, 8, 9]}
                        onPick={(v) => setOptional((p) => ({ ...p, sleep_hours: v }))}
                      />
                      <OptionalScaleRow
                        label="Hydration"
                        value={optional.hydration_feeling}
                        leftHint="Dry"
                        rightHint="Hydrated"
                        onPick={(v) => setOptional((p) => ({ ...p, hydration_feeling: v }))}
                      />
                      <OptionalScaleRow
                        label="Appetite"
                        value={optional.appetite_level}
                        leftHint="None"
                        rightHint="Hungry"
                        onPick={(v) => setOptional((p) => ({ ...p, appetite_level: v }))}
                      />
                      <OptionalScaleRow
                        label="Energy"
                        value={optional.energy_level}
                        leftHint="Empty"
                        rightHint="Full"
                        onPick={(v) => setOptional((p) => ({ ...p, energy_level: v }))}
                      />
                      <OptionalScaleRow
                        label="Motivation"
                        value={optional.motivation_level}
                        leftHint="Low"
                        rightHint="High"
                        onPick={(v) => setOptional((p) => ({ ...p, motivation_level: v }))}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <Button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="w-full rounded-xl h-12 font-semibold gap-2 mt-1"
              >
                <Brain className="h-4 w-4" />
                {isSubmitting ? "Analyzing..." : "Get coach advice"}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
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
        <span className="text-[11px] font-bold text-foreground/55 tabular-nums">
          {value != null ? `${value}${suffix ?? ""}` : "—"}
        </span>
      </div>
      <div className="flex gap-1">
        {options.map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => { triggerHapticSelection(); onPick(opt); }}
              className={`flex-1 h-8 rounded-xs text-[12px] font-semibold tabular-nums transition-colors ${
                active ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground/80 active:bg-muted/60"
              }`}
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
        <span className="text-[11px] font-bold text-foreground/55 tabular-nums">
          {value != null ? `${value}/5` : "—"}
        </span>
      </div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((v) => {
          const active = value === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => { triggerHapticSelection(); onPick(v); }}
              className={`flex-1 h-8 rounded-xs text-[12px] font-semibold tabular-nums transition-colors ${
                active ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground/80 active:bg-muted/60"
              }`}
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
