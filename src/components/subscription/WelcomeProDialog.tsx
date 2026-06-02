import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Crown, Infinity as InfinityIcon, Utensils, Swords } from "lucide-react";
import wizardImg from "@/assets/wizard_3D.png";
import { useProfile } from "@/contexts/UserContext";
import { celebrateSuccess } from "@/lib/haptics";
import { cn } from "@/lib/utils";

interface WelcomeProDialogProps {
  open: boolean;
  onClose: () => void;
}

const UNLOCKS: Array<{ icon: typeof Crown; label: string }> = [
  { icon: InfinityIcon, label: "Unlimited AI — no daily cap" },
  { icon: Utensils, label: "Every meal analyzed" },
  { icon: Swords, label: "AI cut plans & daily missions" },
];

// Rising "magic motes" — tiny blue specks that drift up from the bottom and
// fade out before the text zone. Fixed positions so they don't re-randomize.
const MOTES: Array<{ left: string; size: number; dur: number; delay: number }> = [
  { left: "12%", size: 4, dur: 6.0, delay: 0 },
  { left: "27%", size: 3, dur: 7.5, delay: 1.3 },
  { left: "44%", size: 5, dur: 6.8, delay: 0.6 },
  { left: "61%", size: 3, dur: 8.0, delay: 2.1 },
  { left: "76%", size: 4, dur: 7.0, delay: 1.6 },
  { left: "90%", size: 3, dur: 6.4, delay: 0.9 },
];

function isNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * "Welcome to Pro" — the Ascension cutscene. Plays exactly once after a
 * genuine upgrade (gated server-side in SubscriptionContext). Beats:
 *   0.0s  aurora rises from black
 *   0.8s  the wizard floats up
 *   1.6s  a gold orb passes from the wizard into a Pro crest (+ haptic)
 *   2.3s  "Welcome to Pro" + a ring radiates out
 *   3.2s  CTA settles
 * Reduced-motion: composes straight to the final frame with one gentle haptic.
 */
export function WelcomeProDialog({ open, onClose }: WelcomeProDialogProps) {
  const prefersReduced = useReducedMotion();
  const { profile } = useProfile();
  // phase: 0 rising · 1 crest/haptic · 2 title · 3 unlocks+cta
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

  const { headline, cutLine } = useMemo(() => {
    const first = profile?.display_name?.trim().split(/\s+/)[0];
    const name = first ? first.charAt(0).toUpperCase() + first.slice(1) : null;
    const cw = profile?.current_weight_kg;
    const gw = profile?.goal_weight_kg;
    const td = profile?.target_date;
    let cut: string | null = null;
    if (isNum(cw) && isNum(gw) && cw > gw) {
      const delta = (cw - gw).toFixed(1);
      const datePart =
        td && Number.isFinite(Date.parse(td))
          ? ` by ${new Date(td).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
          : "";
      cut = `${delta} kg to ${gw.toFixed(1)} kg${datePart}. Let's make it clean.`;
    }
    return {
      headline: name ? `${name}, your AI corner is open.` : "Your AI corner is open.",
      cutLine: cut,
    };
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
    <div className="fixed inset-0 z-[10005] flex flex-col items-center justify-center px-7 text-center overflow-hidden bg-background">
      {/* Aurora rising from black. */}
      <motion.div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, hsl(var(--primary) / 0.10) 55%, hsl(217 91% 58% / 0.20) 80%, hsl(213 94% 68% / 0.28) 100%)",
        }}
        initial={prefersReduced ? false : { opacity: 0, y: 80 }}
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
      {/* Soft top glow halo behind the wizard. */}
      <motion.div
        aria-hidden
        className="absolute left-1/2 top-[18%] h-64 w-64 -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, hsl(213 94% 68% / 0.22) 0%, hsl(var(--primary) / 0.16) 40%, transparent 70%)",
        }}
        animate={
          prefersReduced ? { opacity: 0.6 } : { opacity: [0.4, 0.75, 0.4], scale: [0.95, 1.05, 0.95] }
        }
        transition={prefersReduced ? { duration: 0 } : { duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Rising magic motes — ambient, drift up and fade before the text. */}
      {!prefersReduced && (
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-2/3 overflow-hidden pointer-events-none"
        >
          {MOTES.map((m, i) => (
            <motion.span
              key={i}
              className="absolute bottom-0 rounded-full bg-blue-300/70"
              style={{
                left: m.left,
                width: m.size,
                height: m.size,
                filter: "blur(0.5px)",
                boxShadow: "0 0 7px hsl(213 94% 70% / 0.7)",
              }}
              initial={{ opacity: 0, y: 0 }}
              animate={{ opacity: [0, 0.7, 0], y: [-12, -260] }}
              transition={{ duration: m.dur, delay: m.delay, repeat: Infinity, ease: "easeOut" }}
            />
          ))}
        </div>
      )}

      {/* Skip */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-[calc(env(safe-area-inset-top,0px)+1rem)] right-4 z-10 text-[12px] font-semibold text-muted-foreground/60 active:text-foreground transition-colors"
      >
        Skip
      </button>

      <div className="relative z-10 flex flex-col items-center max-w-[340px] w-full">
        {/* Wizard floats up. */}
        <motion.img
          src={wizardImg}
          alt=""
          draggable={false}
          className="h-[120px] w-[120px] object-contain select-none pointer-events-none"
          initial={prefersReduced ? false : { opacity: 0, y: 24 }}
          animate={
            prefersReduced
              ? { opacity: 1, y: 0 }
              : { opacity: 1, y: phase >= 1 ? -2 : 0 }
          }
          transition={{ duration: 0.8, delay: prefersReduced ? 0 : 0.6, ease: "easeOut" }}
        />

        {/* Gold orb travels down into the crest (skipped on reduced motion). */}
        {!prefersReduced && phase === 0 && (
          <motion.div
            aria-hidden
            className="absolute top-[96px] h-5 w-5 rounded-full"
            style={{ background: "hsl(213 94% 70%)", boxShadow: "0 0 18px 6px hsl(217 91% 58% / 0.75)" }}
            initial={{ opacity: 0, y: -6, scale: 0.5 }}
            animate={{ opacity: [0, 1, 1, 0], y: [-6, 30, 44, 48], scale: [0.5, 1, 1.2, 0.4] }}
            transition={{ duration: 1.0, delay: 0.7, ease: "easeIn" }}
          />
        )}

        {/* Pro crest — mints when the orb lands. */}
        <div className="relative mt-3 h-[88px] w-[88px] flex items-center justify-center">
          {/* Slow-rotating god-ray sheen radiating from the crest. Masked to a
              soft band so it glows around the crown without reaching the text.
              Holds off until the "Welcome to Pro" title has appeared. */}
          {!prefersReduced && phase >= 2 && (
            <motion.div
              aria-hidden
              className="absolute left-1/2 top-1/2 h-[116px] w-[116px] -translate-x-1/2 -translate-y-1/2"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0deg, hsl(213 94% 68% / 0.24) 9deg, transparent 24deg, transparent 81deg, hsl(217 91% 60% / 0.2) 90deg, transparent 105deg, transparent 171deg, hsl(213 94% 68% / 0.24) 180deg, transparent 195deg, transparent 261deg, hsl(217 91% 60% / 0.2) 270deg, transparent 285deg, transparent 360deg)",
                maskImage:
                  "radial-gradient(circle, transparent 54%, black 70%, transparent 88%)",
                WebkitMaskImage:
                  "radial-gradient(circle, transparent 54%, black 70%, transparent 88%)",
              }}
              initial={{ opacity: 0, rotate: 0 }}
              animate={{ opacity: 1, rotate: 360 }}
              transition={{
                opacity: { duration: 0.6 },
                rotate: { duration: 18, ease: "linear", repeat: Infinity },
              }}
            />
          )}
          {/* Radiating ring on reveal. */}
          {!prefersReduced && phase >= 2 && (
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full ring-2 ring-primary/50"
              initial={{ opacity: 0.6, scale: 1 }}
              animate={{ opacity: 0, scale: 2 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
          )}
          <motion.div
            className="relative h-[72px] w-[72px] rounded-full flex items-center justify-center"
            style={{
              background:
                "linear-gradient(145deg, hsl(213 94% 70%) 0%, hsl(217 91% 56%) 55%, hsl(221 83% 46%) 100%)",
              boxShadow: "0 0 28px hsl(217 91% 58% / 0.5), inset 0 1px 1px rgba(255,255,255,0.45)",
            }}
            initial={prefersReduced ? false : { opacity: 0, scale: 0.5, rotate: -90 }}
            animate={
              phase >= 1 || prefersReduced
                ? { opacity: 1, scale: 1, rotate: 0 }
                : { opacity: 0, scale: 0.5, rotate: -90 }
            }
            transition={{ type: "spring", stiffness: 260, damping: 16 }}
          >
            <Crown className="h-9 w-9 text-background" strokeWidth={2} fill="currentColor" />
            {/* gloss sweep */}
            {!prefersReduced && phase >= 1 && (
              <span aria-hidden className="absolute inset-0 rounded-full overflow-hidden">
                <motion.span
                  className="absolute top-0 -left-1/2 h-full w-1/2 bg-white/35"
                  style={{ transform: "skewX(-20deg)" }}
                  initial={{ x: "-120%" }}
                  animate={{ x: "320%" }}
                  transition={{ duration: 0.7, delay: 0.2, ease: "easeOut" }}
                />
              </span>
            )}
          </motion.div>
        </div>

        {/* Title. */}
        <motion.h1
          {...reveal(phase >= 2)}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="mt-5 text-[26px] font-extrabold tracking-tight leading-tight text-foreground"
        >
          Welcome to{" "}
          <span
            style={{
              background: "linear-gradient(90deg, hsl(213 94% 72%), hsl(217 91% 52%))",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Pro
          </span>
        </motion.h1>

        {/* Personalized subline. */}
        <motion.p
          {...reveal(phase >= 2)}
          transition={{ duration: 0.5, delay: prefersReduced ? 0 : 0.1, ease: "easeOut" }}
          className="mt-1.5 text-[14px] text-foreground/85 leading-snug"
        >
          {headline}
        </motion.p>
        {cutLine && (
          <motion.p
            {...reveal(phase >= 2)}
            transition={{ duration: 0.5, delay: prefersReduced ? 0 : 0.18, ease: "easeOut" }}
            className="mt-1 text-[12.5px] text-muted-foreground leading-snug"
          >
            {cutLine}
          </motion.p>
        )}

        {/* Unlock lines. */}
        <div className="mt-5 w-full space-y-2">
          {UNLOCKS.map((u, i) => {
            const Icon = u.icon;
            return (
              <motion.div
                key={u.label}
                initial={prefersReduced ? false : { opacity: 0, x: -10 }}
                animate={
                  phase >= 3 || prefersReduced
                    ? { opacity: 1, x: 0 }
                    : { opacity: 0, x: -10 }
                }
                transition={{ duration: 0.4, delay: prefersReduced ? 0 : i * 0.12, ease: "easeOut" }}
                className="flex items-center gap-2.5 rounded-xl bg-card/50 ring-1 ring-primary/15 px-3.5 py-2.5 text-left"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                  <Icon className="h-4 w-4 text-blue-300" strokeWidth={2.25} />
                </span>
                <span className="text-[13px] font-medium text-foreground/90">{u.label}</span>
              </motion.div>
            );
          })}
        </div>

        {/* CTA. */}
        <motion.button
          type="button"
          onClick={onClose}
          {...reveal(phase >= 3, 16)}
          transition={{ duration: 0.5, delay: prefersReduced ? 0 : 0.45, ease: "easeOut" }}
          className={cn(
            "mt-6 w-full h-12 rounded-2xl text-[15px] font-bold text-primary-foreground",
            "bg-gradient-to-r from-primary to-secondary active:scale-[0.98] transition-transform",
          )}
          style={{ boxShadow: "0 0 24px hsl(var(--primary) / 0.35)" }}
        >
          Enter the inner circle
        </motion.button>
      </div>
    </div>
  );
}
