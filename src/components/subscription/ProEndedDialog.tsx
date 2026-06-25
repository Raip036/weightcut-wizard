import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Crown, Lock } from "lucide-react";
import wizardImg from "@/assets/wizard_3D.png";
import { useProfile } from "@/contexts/UserContext";
import { useClearStuckPointerEvents } from "@/hooks/useClearStuckPointerEvents";
import { celebrateSuccess } from "@/lib/haptics";
import { cn } from "@/lib/utils";

interface ProEndedDialogProps {
  open: boolean;
  onClose: () => void;
  onReactivate: () => void;
}

// Now-locked unlocks: the same three benefits as the welcome, struck through.
const LOCKED: string[] = [
  "Unlimited AI, no daily cap",
  "Every meal analyzed",
  "AI cut plans and daily missions",
];

// Falling "spent motes": the same blue specks as the welcome, but they drift
// DOWN and fade — the inverse of the welcome's rising motes. Fixed positions so
// they don't re-randomize.
const MOTES: Array<{ left: string; size: number; dur: number; delay: number }> = [
  { left: "12%", size: 4, dur: 6.0, delay: 0 },
  { left: "27%", size: 3, dur: 7.5, delay: 1.3 },
  { left: "44%", size: 5, dur: 6.8, delay: 0.6 },
  { left: "61%", size: 3, dur: 8.0, delay: 2.1 },
  { left: "76%", size: 4, dur: 7.0, delay: 1.6 },
  { left: "90%", size: 3, dur: 6.4, delay: 0.9 },
];

/**
 * "Pro ended": the Dimmed Mirror cutscene. The visual inverse of
 * WelcomeProDialog ("Ascension") — the same blue world, powered down. Plays
 * exactly once after a genuine lapse (gated server-side in SubscriptionContext).
 * Beats (reverse ascension):
 *   0.0s  dim aurora settles
 *   0.8s  the wizard dims and settles
 *   1.6s  the crest powers down to slate (+ a soft haptic)
 *   2.3s  "Your AI corner has closed" + subline
 *   3.2s  locked list + CTA settle
 * Reduced-motion: composes straight to the final frame with one gentle haptic.
 */
export function ProEndedDialog({ open, onClose, onReactivate }: ProEndedDialogProps) {
  const prefersReduced = useReducedMotion();
  const { profile } = useProfile();
  // Clear any stuck `body { pointer-events: none }` left by a badly-closed
  // Radix/vaul overlay so this full-screen dialog's buttons aren't frozen.
  useClearStuckPointerEvents();
  // phase: 0 dimming · 1 crest powers down/haptic · 2 title · 3 locked+cta
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!open) {
      setPhase(0);
      return;
    }
    if (prefersReduced) {
      setPhase(3);
      celebrateSuccess();
      return;
    }
    const timers = [
      setTimeout(() => setPhase(1), 1600),
      setTimeout(() => celebrateSuccess(), 1650),
      setTimeout(() => setPhase(2), 2300),
      setTimeout(() => setPhase(3), 3200),
    ];
    return () => timers.forEach(clearTimeout);
  }, [open, prefersReduced]);

  // Optional personalized line: whole days from now to a valid FUTURE
  // target_date. Omitted entirely if missing, invalid, or in the past.
  const fightLine = useMemo(() => {
    const td = profile?.target_date;
    if (!td) return null;
    const parsed = Date.parse(td);
    if (!Number.isFinite(parsed)) return null;
    const days = Math.ceil((parsed - Date.now()) / 86_400_000);
    if (days <= 0) return null;
    const noun = days === 1 ? "1 day" : `${days} days`;
    return `Your fight is in ${noun}. Don't lose your edge.`;
  }, [profile]);

  if (!open) return null;

  const reveal = (visible: boolean, fromY = 12) =>
    prefersReduced
      ? { initial: false as const, animate: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: fromY },
          animate: visible ? { opacity: 1, y: 0 } : { opacity: 0, y: fromY },
        };

  return (
    <div
      className="fixed inset-0 z-[10005] flex flex-col items-center justify-center px-7 text-center overflow-hidden bg-background pointer-events-auto"
      style={{ pointerEvents: "auto" }}
    >
      {/* Aurora, receded: the same gradient as the welcome, roughly half opacity. */}
      <motion.div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, hsl(var(--primary) / 0.05) 55%, hsl(217 91% 58% / 0.10) 80%, hsl(213 94% 68% / 0.14) 100%)",
        }}
        initial={prefersReduced ? false : { opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0, scale: prefersReduced ? 1 : [1, 1.06, 1] }}
        transition={
          prefersReduced
            ? { duration: 0 }
            : {
                opacity: { duration: 1, ease: "easeOut" },
                y: { duration: 1, ease: "easeOut" },
                scale: { duration: 7, ease: "easeInOut", repeat: Infinity },
              }
        }
      />
      {/* Faint, dimmed top glow halo behind the wizard. */}
      <motion.div
        aria-hidden
        className="absolute left-1/2 top-[18%] h-64 w-64 -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, hsl(213 94% 68% / 0.11) 0%, hsl(var(--primary) / 0.08) 40%, transparent 70%)",
        }}
        animate={
          prefersReduced ? { opacity: 0.4 } : { opacity: [0.25, 0.45, 0.25], scale: [0.95, 1.05, 0.95] }
        }
        transition={prefersReduced ? { duration: 0 } : { duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Falling motes: ambient blue specks that drift down and fade. */}
      {!prefersReduced && (
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-2/3 overflow-hidden pointer-events-none"
        >
          {MOTES.map((m, i) => (
            <motion.span
              key={i}
              className="absolute top-0 rounded-full bg-blue-300/60"
              style={{
                left: m.left,
                width: m.size,
                height: m.size,
                filter: "blur(0.5px)",
                boxShadow: "0 0 7px hsl(213 94% 70% / 0.55)",
              }}
              initial={{ opacity: 0, y: 0 }}
              animate={{ opacity: [0, 0.6, 0], y: [-12, 260] }}
              transition={{ duration: m.dur, delay: m.delay, repeat: Infinity, ease: "easeIn" }}
            />
          ))}
        </div>
      )}

      {/* Not now */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-[calc(env(safe-area-inset-top,0px)+1rem)] right-4 z-10 text-[12px] font-semibold text-muted-foreground/60 active:text-foreground transition-colors"
      >
        Not now
      </button>

      <div className="relative z-10 flex flex-col items-center max-w-[340px] w-full">
        {/* Wizard, dimmed. */}
        <motion.img
          src={wizardImg}
          alt=""
          draggable={false}
          className="h-[120px] w-[120px] object-contain select-none pointer-events-none"
          style={{ filter: "grayscale(0.35) brightness(0.82)" }}
          initial={prefersReduced ? false : { opacity: 0, y: 24 }}
          animate={
            prefersReduced
              ? { opacity: 1, y: 0 }
              : { opacity: 1, y: phase >= 1 ? -2 : 0 }
          }
          transition={{ duration: 0.8, delay: prefersReduced ? 0 : 0.6, ease: "easeOut" }}
        />

        {/* Crest: settles from a lit state down to slate as it "powers down". */}
        <div className="relative mt-3 h-[88px] w-[88px] flex items-center justify-center">
          <motion.div
            className="relative h-[72px] w-[72px] rounded-full flex items-center justify-center ring-1 ring-primary/20"
            style={{
              background: "linear-gradient(145deg, #3a4250 0%, #252b36 60%, #1a1f29 100%)",
              boxShadow:
                "0 0 16px hsl(213 94% 68% / 0.18), inset 0 1px 1px rgba(255,255,255,0.15)",
            }}
            initial={prefersReduced ? false : { opacity: 0, scale: 0.92 }}
            animate={
              phase >= 1 || prefersReduced
                ? { opacity: 1, scale: 1 }
                : { opacity: 0.5, scale: 0.96 }
            }
            transition={{ duration: 0.7, ease: "easeOut" }}
          >
            <Crown className="h-9 w-9 text-[#7d8696]" strokeWidth={2} fill="currentColor" />
          </motion.div>
        </div>

        {/* Title. */}
        <motion.h1
          {...reveal(phase >= 2)}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="mt-5 text-[26px] font-extrabold tracking-tight leading-tight text-foreground"
        >
          Your AI corner has{" "}
          <span
            style={{
              background: "linear-gradient(90deg, hsl(213 94% 72%), hsl(217 91% 52%))",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            closed
          </span>
        </motion.h1>

        {/* Subline. */}
        <motion.p
          {...reveal(phase >= 2)}
          transition={{ duration: 0.5, delay: prefersReduced ? 0 : 0.1, ease: "easeOut" }}
          className="mt-1.5 text-[14px] text-foreground/85 leading-snug"
        >
          Your Pro access ended today.
        </motion.p>
        {fightLine && (
          <motion.p
            {...reveal(phase >= 2)}
            transition={{ duration: 0.5, delay: prefersReduced ? 0 : 0.18, ease: "easeOut" }}
            className="mt-1 text-[12.5px] italic text-muted-foreground leading-snug"
          >
            {fightLine}
          </motion.p>
        )}

        {/* Locked lines. */}
        <div className="mt-5 w-full space-y-2">
          {LOCKED.map((label, i) => (
            <motion.div
              key={label}
              initial={prefersReduced ? false : { opacity: 0, x: -10 }}
              animate={
                phase >= 3 || prefersReduced
                  ? { opacity: 1, x: 0 }
                  : { opacity: 0, x: -10 }
              }
              transition={{ duration: 0.4, delay: prefersReduced ? 0 : i * 0.12, ease: "easeOut" }}
              className="flex items-center gap-2.5 rounded-xl bg-card/50 ring-1 ring-primary/15 px-3.5 py-2.5 text-left"
            >
              <Lock className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2.25} />
              <span className="text-[13px] font-medium text-foreground/55 line-through">
                {label}
              </span>
            </motion.div>
          ))}
        </div>

        {/* Primary CTA. */}
        <motion.button
          type="button"
          onClick={onReactivate}
          {...reveal(phase >= 3, 16)}
          transition={{ duration: 0.5, delay: prefersReduced ? 0 : 0.45, ease: "easeOut" }}
          className={cn(
            "mt-6 w-full h-12 rounded-2xl text-[15px] font-bold text-primary-foreground",
            "bg-gradient-to-r from-primary to-secondary active:scale-[0.98] transition-transform",
          )}
          style={{ boxShadow: "0 0 24px hsl(var(--primary) / 0.35)" }}
        >
          Reactivate Pro
        </motion.button>

        {/* Secondary ghost dismiss. */}
        <motion.button
          type="button"
          onClick={onClose}
          {...reveal(phase >= 3, 16)}
          transition={{ duration: 0.5, delay: prefersReduced ? 0 : 0.55, ease: "easeOut" }}
          className="mt-3 w-full h-11 rounded-2xl text-[14px] font-semibold text-muted-foreground active:text-foreground transition-colors"
        >
          Continue with free
        </motion.button>
      </div>
    </div>
  );
}
