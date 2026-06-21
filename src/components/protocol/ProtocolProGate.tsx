// WP: ProtocolProGate
// The single primary upgrade gate for the Weight Protocol page. Replaces the
// older lock-icon "Generate / Unlock" card. Two states:
//   • Free user    → premium upsell: shimmering crown, value perks, and a
//                    gradient "Unlock with Pro" CTA. Tapping opens the full
//                    animated explainer (WeightProtocolProDialog) via onUnlock,
//                    so the user sees what they get before the paywall.
//   • Premium user → a clean "Generate your fight plan" CTA (no crown/paywall)
//                    that fires onGenerate directly.
//
// Mirrors the premium language used by ProUpsellScreen (crown badge + gradient
// CTA + shimmer sweep) so the gate feels consistent with Recovery / Missions.
import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { ShimmerCrownBadge } from "@/components/subscription/ShimmerCrownBadge";
import { triggerHapticSelection } from "@/lib/haptics";

interface ProtocolProGateProps {
  /** Drives which CTA renders. */
  isPremium: boolean;
  /** Free users: open the "here's what you get" explainer before the paywall. */
  onUnlock: () => void;
  /** Premium users: kick off generation immediately. */
  onGenerate: () => void;
}

// Teaser perks shown inline on the gate. The full list lives in
// WeightProtocolProDialog; these three are the headline value.
const TEASER_PERKS = [
  "Hour-by-hour rehydration timeline",
  "DIY ORS recipe tuned to your body",
  "Day-by-day fight-week cut plan",
];

export function ProtocolProGate({
  isPremium,
  onUnlock,
  onGenerate,
}: ProtocolProGateProps) {
  const prefersReduced = useReducedMotion();

  // ── Premium: clean generate CTA, no crown / no paywall ──────────────
  if (isPremium) {
    return (
      <button
        type="button"
        onClick={() => {
          triggerHapticSelection();
          onGenerate();
        }}
        className="group w-full text-left card-surface rounded-2xl p-5 active:scale-[0.99] transition border border-primary/30 bg-primary/[0.04]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-primary/80">
              Ready when you are
            </p>
            {/* Bolder, sparkle-free headline. */}
            <p className="mt-1 text-[20px] font-extrabold leading-tight tracking-tight text-foreground">
              Generate your fight plan
            </p>
          </div>

          {/* Dynamic gradient "Generate" pill: shimmer sweep + breathing
              glow + a nudging arrow. Purely visual (the whole card is the
              button), so no nested-button issue. */}
          <motion.span
            className="relative shrink-0 inline-flex items-center gap-1.5 overflow-hidden rounded-full bg-gradient-to-r from-primary to-secondary px-4 py-2.5 text-[12px] font-extrabold uppercase tracking-wider text-primary-foreground"
            style={{ boxShadow: "0 8px 22px -8px hsl(var(--primary) / 0.6)" }}
            animate={
              prefersReduced
                ? undefined
                : {
                    boxShadow: [
                      "0 8px 22px -8px hsl(var(--primary) / 0.55)",
                      "0 8px 30px -6px hsl(var(--primary) / 0.85)",
                      "0 8px 22px -8px hsl(var(--primary) / 0.55)",
                    ],
                  }
            }
            transition={
              prefersReduced
                ? undefined
                : { duration: 2.6, repeat: Infinity, ease: "easeInOut" }
            }
          >
            <span className="relative z-10">Generate</span>
            <motion.span
              className="relative z-10 flex"
              animate={prefersReduced ? undefined : { x: [0, 3, 0] }}
              transition={
                prefersReduced
                  ? undefined
                  : { duration: 1.5, repeat: Infinity, repeatDelay: 1.2, ease: [0.32, 0.72, 0, 1] }
              }
            >
              <Icon name="arrowForwardOutline" size={15} />
            </motion.span>
            {/* Shimmer sweep across the pill. */}
            {!prefersReduced && (
              <motion.span
                aria-hidden
                className="absolute inset-y-0 -left-1/2 w-1/2 bg-white/25"
                style={{ transform: "skewX(-20deg)" }}
                initial={{ x: "-120%" }}
                animate={{ x: "320%" }}
                transition={{ duration: 1.1, ease: "easeOut", repeat: Infinity, repeatDelay: 2.6, delay: 0.8 }}
              />
            )}
          </motion.span>
        </div>
        <p className="mt-3 text-[12px] text-muted-foreground leading-snug">
          We'll tune the cut + rehydration timeline to your weight, training
          load, and prior camps. Takes 5-15 seconds.
        </p>
      </button>
    );
  }

  // ── Free: premium upsell with shimmering crown + perks + gradient CTA ──
  return (
    <button
      type="button"
      onClick={() => {
        triggerHapticSelection();
        onUnlock();
      }}
      className="relative w-full text-left overflow-hidden rounded-2xl border border-primary/25 bg-primary/[0.05] p-5 active:scale-[0.99] transition-transform"
    >
      {/* Soft radial wash for depth behind the crown. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-8 h-40 w-40 rounded-full"
        style={{
          background:
            "radial-gradient(circle, hsl(var(--primary) / 0.18) 0%, transparent 70%)",
        }}
      />

      <div className="relative flex items-start gap-3">
        <ShimmerCrownBadge size={44} />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary/80">
            Pro · Fight-week plan
          </p>
          <p className="mt-0.5 text-[18px] font-bold leading-tight text-foreground">
            Unlock your fight plan
          </p>
        </div>
      </div>

      <div className="relative mt-4 space-y-2">
        {TEASER_PERKS.map((perk) => (
          <div key={perk} className="flex items-center gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/20 text-primary">
              <Icon name="checkmarkOutline" size={12} />
            </span>
            <span className="text-[13px] font-medium text-foreground/90">
              {perk}
            </span>
          </div>
        ))}
      </div>

      {/* Gradient CTA with a periodic shimmer sweep (matches ProUpsellScreen). */}
      <div
        className="relative mt-5 h-12 w-full overflow-hidden rounded-xs bg-gradient-to-r from-primary to-secondary flex items-center justify-center text-primary-foreground text-[15px] font-semibold"
        style={{ boxShadow: "0 0 24px hsl(var(--primary) / 0.30)" }}
      >
        <span className="relative z-10 inline-flex items-center gap-1.5">
          Unlock with Pro
          <Icon name="arrowForwardOutline" size={16} />
        </span>
        {!prefersReduced && (
          <motion.span
            aria-hidden
            className="absolute inset-y-0 -left-1/3 w-1/3 bg-white/25"
            style={{ transform: "skewX(-20deg)" }}
            initial={{ x: "-120%" }}
            animate={{ x: "440%" }}
            transition={{
              duration: 1.1,
              ease: "easeOut",
              repeat: Infinity,
              repeatDelay: 2.8,
              delay: 1.1,
            }}
          />
        )}
      </div>
    </button>
  );
}
