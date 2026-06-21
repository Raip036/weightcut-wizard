import { motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import wizardImg from "@/assets/wizard_3D.png";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

interface ProUpsellScreenProps {
  title: string;
  blurb: string;
  /** Optional value bullets shown between the blurb and the CTA. */
  perks?: string[];
  upgradeLabel?: string;
  dismissLabel?: string;
  onUpgrade: () => void;
  onDismiss: () => void;
}

/** Fixed positions so motes don't re-randomise on every render. A full-screen
 *  field of drifting particles, à la the Welcome-to-Pro celebration. */
const MOTES: Array<{ left: string; size: number; dur: number; delay: number }> = [
  { left: "6%", size: 4, dur: 7.5, delay: 0.0 },
  { left: "17%", size: 3, dur: 9.0, delay: 1.6 },
  { left: "28%", size: 5, dur: 8.0, delay: 0.7 },
  { left: "39%", size: 3, dur: 9.5, delay: 2.4 },
  { left: "50%", size: 4, dur: 8.3, delay: 1.1 },
  { left: "61%", size: 3, dur: 9.1, delay: 0.4 },
  { left: "72%", size: 5, dur: 7.8, delay: 2.0 },
  { left: "83%", size: 3, dur: 9.3, delay: 1.0 },
  { left: "93%", size: 4, dur: 8.6, delay: 0.5 },
];

/**
 * The shared, premium "Pro upsell" screen: the Welcome-to-Pro visual
 * language (aurora, drifting motes, a radiant god-ray behind the floating
 * wizard, staggered reveals and a shimmering CTA) as a reusable, full-height
 * presentational block.
 *
 * Used by {@link ProRouteGate} (whole-route gate, no perks) and the Training
 * Missions explainer (with value bullets). Purely presentational: it owns no
 * subscription logic; callers wire `onUpgrade` / `onDismiss`. All ambient
 * motion is gated behind `useReducedMotion`.
 */
export function ProUpsellScreen({
  title,
  blurb,
  perks,
  upgradeLabel = "Upgrade to Pro",
  dismissLabel = "Maybe later",
  onUpgrade,
  onDismiss,
}: ProUpsellScreenProps) {
  const prefersReduced = useReducedMotion();

  const reveal = (delay: number, fromY = 12) =>
    prefersReduced
      ? { initial: false as const, animate: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: fromY },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.5, delay, ease: "easeOut" as const },
        };

  // Perks (if any) reveal after the blurb; the CTA follows the last perk.
  const perkBase = 0.34;
  const ctaDelay = perks?.length ? perkBase + perks.length * 0.09 + 0.06 : 0.44;

  return (
    <motion.div
      // `min-h-full` (not 100dvh): fills whatever scroll container it's portaled
      // into and grows with content. `justify-center` centres when the content
      // fits, but when it's taller than the viewport the block grows to content
      // height, so a fresh mount sits scrolled to the top (the wizard/info is
      // the first thing read, no upward scroll needed). The generous bottom
      // padding clears the floating bottom nav in the route-gate case.
      className="relative min-h-full w-full flex flex-col items-center justify-center px-6 pt-[calc(2.5rem+env(safe-area-inset-top,0px))] pb-[calc(7rem+env(safe-area-inset-bottom,0px))] text-center bg-background"
      initial={prefersReduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: prefersReduced ? 0 : 0.45, ease: "easeOut" }}
    >
      {/* ── Ambient backdrop ──────────────────────────────────────────── */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, hsl(var(--primary) / 0.08) 55%, hsl(217 91% 58% / 0.16) 82%, hsl(213 94% 68% / 0.22) 100%)",
        }}
        initial={prefersReduced ? false : { opacity: 0, y: 60 }}
        animate={prefersReduced ? { opacity: 1, y: 0 } : { opacity: 1, y: 0, scale: [1, 1.05, 1] }}
        transition={
          prefersReduced
            ? { duration: 0 }
            : {
                opacity: { duration: 1, ease: "easeOut" },
                y: { duration: 1, ease: "easeOut" },
                scale: { duration: 8, ease: "easeInOut", repeat: Infinity },
              }
        }
      />

      {/* Drifting motes across the whole screen */}
      {!prefersReduced && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
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
              animate={{ opacity: [0, 0.7, 0], y: [-12, -900] }}
              transition={{ duration: m.dur, delay: m.delay, repeat: Infinity, ease: "easeOut" }}
            />
          ))}
        </div>
      )}

      {/* ── Content ───────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center w-full max-w-[340px]">
        {/* Wizard hero with a radiant aura + slow god-ray. */}
        <div className="relative flex items-center justify-center">
          <motion.div
            aria-hidden
            className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background:
                "radial-gradient(circle, hsl(213 94% 68% / 0.22) 0%, hsl(var(--primary) / 0.14) 42%, transparent 70%)",
            }}
            animate={
              prefersReduced ? { opacity: 0.6 } : { opacity: [0.4, 0.72, 0.4], scale: [0.95, 1.06, 0.95] }
            }
            transition={prefersReduced ? { duration: 0 } : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
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
        </div>

        {/* Lock chip. */}
        <motion.span
          {...reveal(0.15)}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary ring-1 ring-primary/20"
        >
          <Icon name="lockClosedOutline" size={13} />
          Pro
        </motion.span>

        {/* Headline. */}
        <motion.h1
          {...reveal(0.24)}
          className="mt-4 text-[24px] font-extrabold tracking-tight leading-tight text-foreground"
        >
          {title}
        </motion.h1>

        {/* Blurb. */}
        <motion.p
          {...reveal(0.32)}
          className="mt-2 text-[14px] leading-snug text-muted-foreground"
        >
          {blurb}
        </motion.p>

        {/* Optional value bullets. */}
        {perks?.length ? (
          <div className="mt-5 w-full space-y-2.5">
            {perks.map((perk, i) => (
              <motion.div
                key={perk}
                {...reveal(perkBase + i * 0.09, 10)}
                className="flex items-center gap-3 rounded-xl bg-card/50 ring-1 ring-primary/15 px-3.5 py-2.5 text-left"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/20">
                  <Check className="h-3.5 w-3.5 text-primary" strokeWidth={2.5} />
                </span>
                <span className="text-[13px] font-medium text-foreground/90">{perk}</span>
              </motion.div>
            ))}
          </div>
        ) : null}

        {/* Primary CTA → upgrade. */}
        <motion.button
          {...reveal(ctaDelay, 16)}
          type="button"
          onClick={onUpgrade}
          className={cn(
            "relative mt-7 w-full h-12 rounded-2xl text-[15px] font-bold text-primary-foreground overflow-hidden",
            "bg-gradient-to-r from-primary to-secondary active:scale-[0.98] transition-transform",
          )}
          style={{ boxShadow: "0 0 24px hsl(var(--primary) / 0.35)" }}
        >
          <span className="relative z-10">{upgradeLabel}</span>
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

        {/* Ghost dismiss. */}
        <motion.button
          {...reveal(ctaDelay + 0.08)}
          type="button"
          onClick={onDismiss}
          className="mt-3 h-10 text-[14px] font-semibold text-muted-foreground active:text-foreground transition-colors"
        >
          {dismissLabel}
        </motion.button>
      </div>
    </motion.div>
  );
}
