// WP-T19: NoFightCampEmptyState
// Full-page premium "aurora wizard" empty state shown on the Weight Protocol
// page when the user has no active fight camp. It is returned as the WHOLE
// page (see WeightProtocol.tsx), so it owns the full-height layout, ambient
// backdrop and a floating 3D wizard hero, mirroring ProUpsellScreen /
// reference_aurora_wizard_loader. The CTA links to /fight-camps where the
// user sets their fight, which is what conjures their day-by-day plan.
//
// Visual language (shared with ProUpsellScreen):
//   - WizardAuroraBackground: full-height blue aurora wash + drifting motes
//   - Floating wizard_3D hero with a radiant aura + slow rotating god-ray
//   - Staggered fade/slide reveals, value bullets, a shimmering primary CTA
//   - All ambient motion is gated behind useReducedMotion (iOS perf)
//   - Haptic selection on tap
import { motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import wizardImg from "@/assets/wizard_3D.png";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";
import { triggerHapticSelection } from "@/lib/haptics";
import { cn } from "@/lib/utils";

export interface NoFightCampEmptyStateProps {
  /** Override the default navigation to `/fight-camps`. */
  onSetFightDate?: () => void;
  className?: string;
}

// What the user unlocks the moment they set a fight. Kept short and concrete
// so the value reads at a glance.
const PERKS: string[] = [
  "A day-by-day cut: carbs, water and sodium tapered for you",
  "A post weigh-in rehydration timeline and ORS recipe",
  "Auto-adjusts every time you log your weight",
];

export function NoFightCampEmptyState({
  onSetFightDate,
  className,
}: NoFightCampEmptyStateProps) {
  const prefersReduced = useReducedMotion();
  const navigate = useNavigate();

  const handleTap = () => {
    triggerHapticSelection();
    if (onSetFightDate) {
      onSetFightDate();
      return;
    }
    navigate("/fight-camps");
  };

  const reveal = (delay: number, fromY = 12) =>
    prefersReduced
      ? { initial: false as const, animate: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: fromY },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.5, delay, ease: "easeOut" as const },
        };

  const perkBase = 0.42;
  const ctaDelay = perkBase + PERKS.length * 0.09 + 0.08;

  return (
    <motion.section
      role="region"
      aria-label="No active fight camp"
      initial={prefersReduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: prefersReduced ? 0 : 0.45, ease: "easeOut" }}
      className={cn(
        // `min-h-full` fills the scroll container and grows with content; the
        // generous bottom padding clears the floating bottom nav.
        "relative min-h-full w-full flex flex-col items-center justify-center bg-background text-center",
        "px-6 pt-[calc(2.5rem+env(safe-area-inset-top,0px))] pb-[calc(7rem+env(safe-area-inset-bottom,0px))]",
        className,
      )}
    >
      {/* ── Ambient backdrop: aurora wash + drifting motes ─────────────── */}
      <WizardAuroraBackground />

      {/* ── Content ───────────────────────────────────────────────────── */}
      <div className="relative z-10 flex w-full max-w-[340px] flex-col items-center">
        {/* Floating wizard hero with a radiant aura + slow god-ray. */}
        <div className="relative flex items-center justify-center">
          <motion.div
            aria-hidden
            className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full"
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
              prefersReduced
                ? { duration: 0 }
                : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }
            }
          />

          {!prefersReduced && (
            <motion.div
              aria-hidden
              className="absolute left-1/2 top-1/2 h-[210px] w-[210px] -translate-x-1/2 -translate-y-1/2"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0deg, hsl(213 94% 68% / 0.20) 9deg, transparent 26deg, transparent 81deg, hsl(217 91% 60% / 0.16) 90deg, transparent 107deg, transparent 171deg, hsl(213 94% 68% / 0.20) 180deg, transparent 197deg, transparent 261deg, hsl(217 91% 60% / 0.16) 270deg, transparent 287deg, transparent 360deg)",
                maskImage: "radial-gradient(circle, transparent 50%, black 66%, transparent 84%)",
                WebkitMaskImage: "radial-gradient(circle, transparent 50%, black 66%, transparent 84%)",
              }}
              initial={{ opacity: 0, rotate: 0 }}
              animate={{ opacity: 1, rotate: 360 }}
              transition={{
                opacity: { duration: 0.8 },
                rotate: { duration: 20, ease: "linear", repeat: Infinity },
              }}
            />
          )}

          <motion.img
            src={wizardImg}
            alt=""
            draggable={false}
            className="relative h-[120px] w-[120px] select-none object-contain pointer-events-none"
            initial={prefersReduced ? false : { opacity: 0, y: 12, scale: 0.92 }}
            animate={
              prefersReduced
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 1, y: [0, -8, 0], scale: 1 }
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

        {/* Eyebrow. */}
        <motion.span
          {...reveal(0.15)}
          className="mt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary"
        >
          Weight Protocol
        </motion.span>

        {/* Headline. */}
        <motion.h1
          {...reveal(0.24)}
          className="mt-3 text-[26px] font-extrabold leading-tight tracking-tight text-foreground"
        >
          Make weight, without the guesswork
        </motion.h1>

        {/* Blurb. */}
        <motion.p
          {...reveal(0.32)}
          className="mt-2.5 text-[14px] leading-snug text-muted-foreground"
        >
          Set your fight and the wizard maps your whole cut to the gram, tuned
          to your weight, training load, and past camps.
        </motion.p>

        {/* Value bullets. */}
        <div className="mt-5 w-full space-y-2.5">
          {PERKS.map((perk, i) => (
            <motion.div
              key={perk}
              {...reveal(perkBase + i * 0.09, 10)}
              className="flex items-center gap-3 rounded-xl bg-card/50 px-3.5 py-2.5 text-left ring-1 ring-primary/15"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                <Check className="h-4 w-4 text-primary" strokeWidth={2.5} />
              </span>
              <span className="text-[13px] font-medium text-foreground/90">{perk}</span>
            </motion.div>
          ))}
        </div>

        {/* Primary CTA → set the fight date. */}
        <motion.button
          {...reveal(ctaDelay, 16)}
          type="button"
          onClick={handleTap}
          className={cn(
            "relative mt-7 h-12 w-full overflow-hidden rounded-2xl text-[15px] font-bold text-primary-foreground",
            "bg-gradient-to-r from-primary to-secondary transition-transform active:scale-[0.98]",
          )}
          style={{ boxShadow: "0 0 24px hsl(var(--primary) / 0.35)" }}
        >
          <span className="relative z-10 inline-flex items-center justify-center gap-1.5">
            Set fight date
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
      </div>
    </motion.section>
  );
}
