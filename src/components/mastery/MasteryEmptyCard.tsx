/**
 * MasteryEmptyCard — the Pro first-run state for Technique Mastery on /camp.
 *
 * Slim, premium treatment: a compact horizontal row — the haloed, bobbing 3D
 * wizard mascot on the left over the blue animated aurora used on the Pro-gate
 * walls (WizardAuroraBackground), with condensed copy whose only job is to tell
 * the user how to get their first drills: log a session and add a "What went
 * well" note.
 *
 * iOS-safe + reduced-motion: the aurora and wizard halo self-gate; the bob
 * stops under reduced motion. No box-shadow on the card surface.
 */
import { motion, useReducedMotion } from "motion/react";
import wizard from "@/assets/wizard_3D.png";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";

interface MasteryEmptyCardProps {
  /** Eyebrow title — defaults to the feature name. */
  title?: string;
  /** Condensed instructional line. */
  body?: string;
}

export function MasteryEmptyCard({
  title = "Technique Mastery",
  body = "Log a 'To improve' note to get drills.",
}: MasteryEmptyCardProps) {
  const reduced = useReducedMotion();

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-primary/20 px-4 py-3.5">
      {/* Blue animated aurora — same premium wash as the Pro-gate walls. */}
      <WizardAuroraBackground intensity="full" />

      <div className="relative z-10 flex items-center gap-3.5">
        {/* Haloed, bobbing wizard mascot (~56px). */}
        <div
          className="relative flex shrink-0 items-center justify-center"
          style={{ width: 60, height: 60 }}
        >
          {!reduced && (
            <motion.div
              aria-hidden
              className="absolute"
              style={{
                width: 80,
                height: 80,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, hsl(var(--primary) / 0.45) 0%, hsl(var(--primary) / 0.12) 42%, transparent 70%)",
                filter: "blur(7px)",
              }}
              animate={{ opacity: [0.5, 0.85, 0.5], scale: [0.95, 1.08, 0.95] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          <motion.img
            src={wizard}
            alt=""
            draggable={false}
            style={{
              width: 56,
              height: 56,
              objectFit: "contain",
              position: "relative",
              zIndex: 2,
              filter: "drop-shadow(0 0 12px hsl(var(--primary) / 0.5))",
            }}
            animate={reduced ? { y: 0 } : { y: [0, -5, 0] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
            {title}
          </p>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
            {body}
          </p>
        </div>
      </div>
    </div>
  );
}
