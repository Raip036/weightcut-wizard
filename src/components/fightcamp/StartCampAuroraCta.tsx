// StartCampAuroraCta
// Premium blue "aurora wizard" call-to-action shown when a user has NO active
// fight camp. Tapping it runs the caller's `onStart` (which should funnel
// through the `MULTIPLE_FIGHT_CAMPS` gate: eligible users open the new-camp
// wizard, free users hit the aurora `CampLimitProGate` paywall, which is the
// conversion moment). Copy is aspirational, not lock-first, so it pulls every
// user in and reveals Pro at the value-moment tap.
//
// Two variants, one component:
//   - "compact" → slim card for the Dashboard camp-status slot (wizard + line
//     + glowing CTA). Highest-traffic surface.
//   - "hero"    → tall centered card with floating wizard, god-ray, value
//     bullets + CTA, for the empty Camp tab. Highest-intent surface.
//
// Shares the app's reference aurora language (WizardAuroraBackground +
// wizard_3D + glowing gradient pill). All ambient motion is gated behind
// useReducedMotion for iOS perf.
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import wizardImg from "@/assets/wizard_3D.png";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";
import { triggerHapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";

const CARD_BG =
  "linear-gradient(165deg, hsl(217 55% 13% / 0.55) 0%, hsl(222 47% 7% / 0.7) 60%)";

export interface StartCampAuroraCtaProps {
  variant?: "compact" | "hero";
  /** Tap handler. Caller funnels this through the camp-creation Pro gate. */
  onStart: () => void;
  className?: string;
}

export function StartCampAuroraCta({
  variant = "compact",
  onStart,
  className,
}: StartCampAuroraCtaProps) {
  const prefersReduced = useReducedMotion();
  const isHero = variant === "hero";

  const handleTap = () => {
    triggerHapticSelection();
    onStart();
  };

  const cta = (
    <motion.button
      type="button"
      onClick={handleTap}
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: isHero ? 0.24 : 0.12, ease: "easeOut" }}
      className={cn(
        "relative mt-4 h-12 w-full overflow-hidden rounded-2xl text-[15px] font-bold text-primary-foreground",
        "bg-gradient-to-r from-primary to-secondary transition-transform active:scale-[0.98]",
      )}
      style={{ boxShadow: "0 0 24px hsl(var(--primary) / 0.35)" }}
    >
      <span className="relative z-10 inline-flex items-center justify-center gap-1.5">
        Start a fight camp
        <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
      </span>
      {!prefersReduced && (
        <motion.span
          aria-hidden
          className="absolute inset-y-0 -left-1/3 w-1/3 bg-white/25"
          style={{ transform: "skewX(-20deg)" }}
          initial={{ x: "-120%" }}
          animate={{ x: "440%" }}
          transition={{ duration: 1.1, ease: "easeOut", repeat: Infinity, repeatDelay: 2.8, delay: 1.1 }}
        />
      )}
    </motion.button>
  );

  // ── Compact: slim horizontal card for the Dashboard camp-status slot ──
  if (!isHero) {
    return (
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className={cn(
          "relative overflow-hidden rounded-2xl border border-primary/25 p-4",
          className,
        )}
        style={{ background: CARD_BG }}
      >
        <WizardAuroraBackground intensity="subtle" />
        <div className="relative z-10">
          <div className="flex items-center gap-3.5">
            {/* Haloed wizard */}
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
              {!prefersReduced && (
                <motion.div
                  aria-hidden
                  className="absolute rounded-full"
                  style={{
                    width: 72,
                    height: 72,
                    background:
                      "radial-gradient(circle, hsl(213 94% 68% / 0.4) 0%, hsl(var(--primary) / 0.12) 45%, transparent 70%)",
                    filter: "blur(5px)",
                  }}
                  animate={{ opacity: [0.5, 0.85, 0.5], scale: [0.95, 1.06, 0.95] }}
                  transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
              <motion.img
                src={wizardImg}
                alt=""
                draggable={false}
                className="relative h-12 w-12 select-none object-contain pointer-events-none"
                style={{ filter: "drop-shadow(0 0 12px hsl(213 94% 68% / 0.4))" }}
                animate={prefersReduced ? { y: 0 } : { y: [0, -4, 0] }}
                transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>

            <div className="min-w-0">
              <p className="text-[15px] font-bold leading-tight text-foreground">
                Line up your next fight
              </p>
              <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
                A fresh AI cut + weigh-in plan, tuned to your next bout.
              </p>
            </div>
          </div>

          {cta}
        </div>
      </motion.div>
    );
  }

  // ── Hero: tall centered card for the empty Camp tab ──────────────────
  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-primary/25 px-5 pb-5 pt-6 text-center",
        className,
      )}
      style={{ background: CARD_BG }}
    >
      <WizardAuroraBackground radialGlow />
      <div className="relative z-10 mx-auto flex max-w-[320px] flex-col items-center">
        {/* Floating wizard hero with aura + slow god-ray */}
        <div className="relative flex items-center justify-center">
          <motion.div
            aria-hidden
            className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background:
                "radial-gradient(circle, hsl(213 94% 68% / 0.22) 0%, hsl(var(--primary) / 0.14) 42%, transparent 70%)",
            }}
            animate={
              prefersReduced
                ? { opacity: 0.6 }
                : { opacity: [0.4, 0.72, 0.4], scale: [0.95, 1.06, 0.95] }
            }
            transition={
              prefersReduced ? { duration: 0 } : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }
            }
          />
          {!prefersReduced && (
            <motion.div
              aria-hidden
              className="absolute left-1/2 top-1/2 h-[150px] w-[150px] -translate-x-1/2 -translate-y-1/2"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0deg, hsl(213 94% 68% / 0.20) 9deg, transparent 26deg, transparent 81deg, hsl(217 91% 60% / 0.16) 90deg, transparent 107deg, transparent 171deg, hsl(213 94% 68% / 0.20) 180deg, transparent 197deg, transparent 261deg, hsl(217 91% 60% / 0.16) 270deg, transparent 287deg, transparent 360deg)",
                maskImage: "radial-gradient(circle, transparent 50%, black 66%, transparent 84%)",
                WebkitMaskImage: "radial-gradient(circle, transparent 50%, black 66%, transparent 84%)",
              }}
              initial={{ opacity: 0, rotate: 0 }}
              animate={{ opacity: 1, rotate: 360 }}
              transition={{ opacity: { duration: 0.8 }, rotate: { duration: 20, ease: "linear", repeat: Infinity } }}
            />
          )}
          <motion.img
            src={wizardImg}
            alt=""
            draggable={false}
            className="relative h-[88px] w-[88px] select-none object-contain pointer-events-none"
            initial={prefersReduced ? false : { opacity: 0, y: 10, scale: 0.92 }}
            animate={
              prefersReduced ? { opacity: 1, y: 0, scale: 1 } : { opacity: 1, y: [0, -7, 0], scale: 1 }
            }
            transition={
              prefersReduced
                ? { duration: 0 }
                : {
                    opacity: { duration: 0.6, ease: "easeOut" },
                    scale: { type: "spring", stiffness: 220, damping: 18 },
                    y: { duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.6 },
                  }
            }
          />
        </div>

        <motion.h2
          initial={prefersReduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.12, ease: "easeOut" }}
          className="mt-3 text-[22px] font-extrabold leading-tight tracking-tight text-foreground"
        >
          No camp on the books
        </motion.h2>
        <motion.p
          initial={prefersReduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.18, ease: "easeOut" }}
          className="mt-2 text-[13.5px] leading-snug text-muted-foreground"
        >
          Set your next fight and the wizard maps your whole cut to the gram.
        </motion.p>

        {cta}
      </div>
    </motion.div>
  );
}

export default StartCampAuroraCta;
