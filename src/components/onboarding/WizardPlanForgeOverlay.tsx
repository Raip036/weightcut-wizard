import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Sparkles } from "lucide-react";
import wizardImg from "@/assets/thoughtful_wizard.png";
import { cn } from "@/lib/utils";

interface WizardPlanForgeOverlayProps {
  isFighter?: boolean;
  currentWeightKg?: number;
  goalWeightKg?: number;
  /** ISO date (fighters: fight day; others: target date). */
  targetDate?: string;
  /** Plan length; derived from targetDate when omitted. */
  weeks?: number;
}

const SPARKLES: Array<{ className: string; delay: number; size: number }> = [
  { className: "absolute -top-1 left-2", delay: 0, size: 13 },
  { className: "absolute -top-2 right-3", delay: 0.7, size: 16 },
  { className: "absolute top-2 -right-1", delay: 1.2, size: 11 },
  { className: "absolute top-1 -left-2", delay: 0.4, size: 12 },
];

function isNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Onboarding plan-generation loader. While the AI builds the plan (~10-20s),
 * the athlete's real numbers (weight delta, weeks, goal, date) fly in as
 * glowing tokens and assemble beneath the wizard, with a staged progress
 * narrative, so the wait reads as "the wizard is forging YOUR plan" rather
 * than a dead spinner. Respects reduced-motion (tokens settle instantly,
 * loops freeze, captions still advance).
 */
export function WizardPlanForgeOverlay({
  isFighter,
  currentWeightKg,
  goalWeightKg,
  targetDate,
  weeks,
}: WizardPlanForgeOverlayProps) {
  const prefersReduced = useReducedMotion();
  const [stage, setStage] = useState(0);

  const stages = useMemo(
    () =>
      isFighter
        ? ["Crunching your numbers", "Mapping your weeks", "Plotting fight week", "Sealing the plan"]
        : ["Crunching your numbers", "Mapping your weeks", "Dialing in your macros", "Sealing the plan"],
    [isFighter],
  );

  useEffect(() => {
    const id = setInterval(
      () => setStage((s) => Math.min(s + 1, stages.length - 1)),
      1500,
    );
    return () => clearInterval(id);
  }, [stages.length]);

  // Build the stat tokens from whatever real numbers we have.
  const chips = useMemo(() => {
    const out: Array<{ key: string; text: string }> = [];
    if (isNum(currentWeightKg) && isNum(goalWeightKg)) {
      const delta = currentWeightKg - goalWeightKg;
      const sign = delta >= 0 ? "−" : "+";
      out.push({ key: "delta", text: `${sign}${Math.abs(delta).toFixed(1)} kg` });
    }
    const wk =
      isNum(weeks) && weeks > 0
        ? Math.round(weeks)
        : targetDate
          ? Math.max(
              1,
              Math.ceil(
                (Date.parse(targetDate) - Date.now()) / (7 * 86400000),
              ),
            )
          : null;
    if (isNum(wk) && wk > 0) out.push({ key: "weeks", text: `${wk} weeks` });
    if (isNum(goalWeightKg)) out.push({ key: "goal", text: `→ ${goalWeightKg.toFixed(1)} kg` });
    if (targetDate && Number.isFinite(Date.parse(targetDate))) {
      const d = new Date(targetDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      out.push({ key: "date", text: `${isFighter ? "🥊 " : ""}${d}` });
    }
    return out;
  }, [currentWeightKg, goalWeightKg, targetDate, weeks, isFighter]);

  const progressPct = ((stage + 1) / stages.length) * 100;

  return (
    <div
      className="w-full flex flex-col items-center gap-3 py-2"
      role="status"
      aria-live="polite"
      aria-label="Generating your plan"
    >
      {/* Wizard + twinkling sparkles. */}
      <div className="relative">
        {SPARKLES.map((s, i) => (
          <motion.div
            key={i}
            aria-hidden
            className={cn(
              s.className,
              "z-20 text-amber-300 drop-shadow-[0_0_6px_rgba(251,191,36,0.55)]",
            )}
            animate={
              prefersReduced
                ? { opacity: 0.7 }
                : { opacity: [0.2, 1, 0.2], scale: [0.8, 1.1, 0.8] }
            }
            transition={
              prefersReduced
                ? { duration: 0 }
                : { duration: 1.8, ease: "easeInOut", repeat: Infinity, delay: s.delay }
            }
          >
            <Sparkles size={s.size} strokeWidth={2.25} />
          </motion.div>
        ))}
        <motion.img
          src={wizardImg}
          alt=""
          draggable={false}
          className="h-[92px] w-[92px] object-contain select-none pointer-events-none"
          animate={prefersReduced ? undefined : { rotate: [-4, 4, -4], y: [0, -3, 0] }}
          transition={
            prefersReduced
              ? undefined
              : {
                  rotate: { duration: 2.6, ease: "easeInOut", repeat: Infinity },
                  y: { duration: 2.2, ease: "easeInOut", repeat: Infinity },
                }
          }
          style={{ transformOrigin: "50% 85%" }}
        />
      </div>

      {/* Stat tokens flying in + assembling. */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-[300px]">
          {chips.map((c, i) => (
            <motion.span
              key={c.key}
              initial={prefersReduced ? false : { opacity: 0, y: 14, scale: 0.7 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={
                prefersReduced
                  ? { duration: 0 }
                  : { delay: 0.15 + i * 0.18, type: "spring", stiffness: 300, damping: 18 }
              }
              className="inline-flex items-center rounded-full bg-primary/12 ring-1 ring-primary/25 px-2.5 py-1 text-[12px] font-bold text-primary tabular-nums"
            >
              {c.text}
            </motion.span>
          ))}
        </div>
      )}

      {/* Staged progress bar. */}
      <div className="w-full max-w-[260px] h-1 rounded-full bg-muted/30 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary/50 to-primary"
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>

      {/* Stage caption rotator. */}
      <div className="h-4 flex items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={stage}
            initial={prefersReduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReduced ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
            className="text-[12px] font-medium text-foreground/90"
          >
            {stages[stage]}…
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

export default WizardPlanForgeOverlay;
