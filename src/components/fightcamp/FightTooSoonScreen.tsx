/**
 * FightTooSoonScreen — full-screen "this fight is too soon" overlay.
 *
 * Shown when a requested weight cut is physically impossible: to make weight
 * the athlete would have to lose more body fat per week than is safely
 * achievable, before any water cut even begins. Rather than generating a plan
 * that puts their health at risk, we calmly explain the maths and steer them
 * toward giving the cut more time or speaking to a nutritionist or coach.
 *
 * Aesthetic mirrors the app's premium "blue wizard aurora" system (see
 * NewCampWelcomeCutscene + ProUpsellScreen): a cosmic blue vignette shell, the
 * WizardAuroraBackground ambient layer, a persistent wizard mascot up top, and
 * a single pinned gradient CTA. There is deliberately NO "generate anyway"
 * escape hatch — this is a hard stop, presented supportively.
 *
 * Rendered via a portal to document.body so the `fixed inset-0` container
 * resolves above the entire app shell. `useReducedMotion()` is honoured: big
 * entrance motion is skipped, everything stays static and legible.
 */
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { WizardCharacter } from "@/tutorial/WizardCharacter";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";
import { useClearStuckPointerEvents } from "@/hooks/useClearStuckPointerEvents";

export interface FightTooSoonScreenProps {
  /** How much fat must be lost before the water cut (kg). */
  fatLossKg: number;
  /** Whole weeks until weigh-in. */
  weeksAvailable: number;
  /** Earliest realistic timeline (whole weeks). */
  minWeeksNeeded: number;
  /** Safe max fat loss per week, ~2.5% of bodyweight (kg). */
  maxPerWeekKg: number;
  /** What the current ask implies per week (kg). */
  perWeekKg: number;
  /** Primary action label, e.g. "Adjust fight date" or "Back to my camp". */
  ctaLabel: string;
  /** Single primary action. */
  onAction: () => void;
}

// ── Stat chip ─────────────────────────────────────────────────────────
// Compact glass pill used in the stat row. Numbers are tabular so the row
// stays visually steady regardless of the digits shown.
function StatChip({ value, unit, label }: { value: string; unit: string; label: string }): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-3 text-center">
      <p className="display-number flex items-baseline justify-center gap-0.5 whitespace-nowrap leading-none tabular-nums">
        <span className="text-[18px] font-bold text-white">{value}</span>
        <span className="text-[10px] font-semibold text-white/55">{unit}</span>
      </p>
      <p className="mt-1.5 text-[9px] font-medium uppercase tracking-wider text-white/45">
        {label}
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────
export function FightTooSoonScreen({
  fatLossKg,
  weeksAvailable,
  minWeeksNeeded,
  maxPerWeekKg,
  perWeekKg,
  ctaLabel,
  onAction,
}: FightTooSoonScreenProps): JSX.Element {
  const reduced = !!useReducedMotion();
  // This overlay portals onto document.body while the NextCampFlow sheet
  // (vaul/Radix) is still open behind it, which leaves `body{pointer-events:none}`.
  // Without this, the overlay inherits it and the CTA is frozen.
  useClearStuckPointerEvents();

  // Friendly rounding for the body copy: one decimal, no trailing ".0" noise.
  const fatLossDisplay = Math.round(fatLossKg * 10) / 10;
  const weeksLabel = `${weeksAvailable} ${weeksAvailable === 1 ? "week" : "weeks"}`;

  const overlay = (
    <motion.div
      className="fixed inset-0 z-[9999] overflow-hidden text-white"
      style={{
        // Cosmic blue vignette — matches the app's dark Apple-Fitness shell.
        background:
          "radial-gradient(ellipse at 50% 22%, rgba(30,42,78,0.82) 0%, rgba(10,12,22,0.96) 56%, #020207 100%)",
        WebkitTapHighlightColor: "transparent",
        // Immune to an inherited body{pointer-events:none} from the sheet behind.
        pointerEvents: "auto",
      }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      transition={reduced ? { duration: 0.2 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Ambient animated backdrop — rising blue motes + breathing aurora. */}
      <WizardAuroraBackground radialGlow />

      {/* Persistent wizard mascot near the top (idle, calm). */}
      <div
        className="pointer-events-none absolute inset-x-0 z-10 flex justify-center"
        style={{ top: "16%" }}
      >
        <div className="relative" style={{ width: 120, height: 120 }}>
          <WizardCharacter pose="idle" />
        </div>
      </div>

      {/* Centered content block. */}
      <motion.div
        className="absolute inset-x-0 z-20 px-5 text-center"
        style={{ top: "44%" }}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={
          reduced ? { duration: 0.2 } : { delay: 0.12, duration: 0.5, ease: [0.22, 1, 0.36, 1] }
        }
      >
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.42em] text-brand-dream-cyan">
          Too soon
        </p>

        <h1
          className="display-number mx-auto max-w-[16ch] text-balance text-[34px] font-extrabold leading-[1.06] tracking-[-0.02em] text-white"
          style={{ textShadow: "0 0 40px rgba(64,104,239,0.35)" }}
        >
          This fight is too soon
        </h1>

        <div className="mx-auto mt-4 max-w-[44ch] space-y-3 text-[15px] leading-[1.6] text-white/75">
          <p>
            To make weight you would need to lose about{" "}
            <span className="font-semibold text-white/90 tabular-nums">{fatLossDisplay} kg</span> of
            body fat in only {weeksLabel}, before any water cut. That is faster than is safely
            possible.
          </p>
          <p>
            Give the cut more time, or speak to a nutritionist or coach to plan it properly.
          </p>
        </div>

        {/* Compact stat row — three glass chips. */}
        <div className="mx-auto mt-6 flex max-w-[340px] items-stretch justify-center gap-2">
          <StatChip value={`~${perWeekKg.toFixed(1)}`} unit="kg/wk" label="Need" />
          <StatChip value={`~${maxPerWeekKg.toFixed(1)}`} unit="kg/wk" label="Safe max" />
          <StatChip value={`~${minWeeksNeeded}`} unit="wks" label="Earliest" />
        </div>
      </motion.div>

      {/* Pinned bottom — single primary CTA above the safe area. */}
      <div
        className="absolute inset-x-0 z-40 px-6"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
      >
        <motion.button
          type="button"
          onClick={onAction}
          aria-label={ctaLabel}
          className="relative mx-auto flex h-[56px] w-full max-w-[420px] items-center justify-center overflow-hidden rounded-2xl text-[16px] font-bold text-white transition-transform active:scale-[0.98]"
          style={{
            background: "linear-gradient(90deg, #4068EF 0%, #2A5BDD 50%, #4AB4ED 100%)",
            boxShadow: "0 8px 32px rgba(64,104,239,0.35)",
            WebkitTapHighlightColor: "transparent",
          }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={
            reduced
              ? { duration: 0.2 }
              : { delay: 0.22, type: "spring", stiffness: 260, damping: 26 }
          }
        >
          {ctaLabel}
        </motion.button>

        <p className="mx-auto mt-3 max-w-[420px] text-center text-[12px] leading-snug text-white/40">
          We won't generate a plan that puts your health at risk.
        </p>
      </div>
    </motion.div>
  );

  return createPortal(overlay, document.body);
}

export default FightTooSoonScreen;
