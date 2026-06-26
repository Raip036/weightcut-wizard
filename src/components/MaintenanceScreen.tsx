import { motion, useReducedMotion } from "motion/react";
import wizardImg from "@/assets/wizard_3D.png";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";
import { useClearStuckPointerEvents } from "@/hooks/useClearStuckPointerEvents";

interface MaintenanceScreenProps {
  /** Optional admin-supplied message shown beneath the default sub line. */
  message?: string | null;
}

/**
 * Full-screen "Under maintenance" takeover. Mounted ABOVE the router/auth by
 * {@link MaintenanceGate}, so when the Convex `getMaintenance.enabled` flag is
 * on, this replaces the ENTIRE app — no route, no auth, nothing else reachable.
 *
 * Visual language mirrors {@link ProUpsellScreen} (wizard hero + headline) but
 * with NO buttons and NO dismiss. iOS-safe: all ambient motion comes from
 * {@link WizardAuroraBackground} (GPU transform/opacity only); no new blur()/
 * backdrop-filter is introduced here.
 */
export function MaintenanceScreen({ message }: MaintenanceScreenProps) {
  // Immune to a stuck `body { pointer-events: none }` left by a Radix/vaul
  // overlay that closed badly right before maintenance flipped on.
  useClearStuckPointerEvents();

  const prefersReduced = useReducedMotion();

  const reveal = (delay: number, fromY = 12) =>
    prefersReduced
      ? { initial: false as const, animate: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: fromY },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.5, delay, ease: "easeOut" as const },
        };

  return (
    <div
      className="fixed inset-0 z-[100000] flex flex-col items-center justify-center overflow-hidden bg-background px-7 text-center pointer-events-auto"
      style={{ pointerEvents: "auto" }}
    >
      {/* Animated aurora backdrop — pointer-events-none absolute inset-0 layer. */}
      <WizardAuroraBackground radialGlow />

      {/* ── Content ───────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center w-full max-w-[340px]">
        {/* Wizard hero — gentle float (optional, GPU transform only). */}
        <motion.img
          src={wizardImg}
          alt=""
          draggable={false}
          className="relative h-[120px] w-[120px] object-contain select-none pointer-events-none"
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

        {/* Headline. */}
        <motion.h1
          {...reveal(0.24)}
          className="mt-6 text-[24px] font-extrabold tracking-tight leading-tight text-foreground"
        >
          Under maintenance
        </motion.h1>

        {/* Default sub line. */}
        <motion.p
          {...reveal(0.32)}
          className="mt-2 text-[14px] leading-snug text-muted-foreground"
        >
          The Wizard is tuning things up. We&apos;ll be right back.
        </motion.p>

        {/* Optional admin message. */}
        {message ? (
          <motion.p
            {...reveal(0.4)}
            className="mt-3 text-[13px] leading-snug text-muted-foreground/80"
          >
            {message}
          </motion.p>
        ) : null}
      </div>
    </div>
  );
}

export default MaintenanceScreen;
