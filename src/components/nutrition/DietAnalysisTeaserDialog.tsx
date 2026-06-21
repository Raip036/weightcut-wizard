import { Crown, Check } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useSubscription } from "@/hooks/useSubscription";

interface DietAnalysisTeaserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** What a free user is shown before the price. Sells the value of the
 *  diet analysis, then hands off to the existing paywall flow. */
const PERKS = [
  { title: "Protein g/kg verdict", desc: "Know if you hit your daily target for your weight" },
  { title: "Micronutrient rings", desc: "See which vitamins & minerals you're covering" },
  { title: "Daily gaps + fixes", desc: "Whole-food swaps to close what you're missing" },
];

/** Fixed positions so motes don't re-randomise on every render. A full-card
 *  field that drifts up behind the whole dialog, à la the Welcome-to-Pro
 *  screen. */
const MOTES: Array<{ left: string; size: number; dur: number; delay: number }> = [
  { left: "8%", size: 4, dur: 7.0, delay: 0.0 },
  { left: "19%", size: 3, dur: 8.6, delay: 1.4 },
  { left: "31%", size: 5, dur: 7.6, delay: 0.6 },
  { left: "43%", size: 3, dur: 9.1, delay: 2.3 },
  { left: "55%", size: 4, dur: 7.9, delay: 1.0 },
  { left: "67%", size: 3, dur: 8.3, delay: 0.3 },
  { left: "79%", size: 5, dur: 7.3, delay: 1.9 },
  { left: "91%", size: 3, dur: 8.8, delay: 0.9 },
];

/**
 * Teaser preview shown when a free user taps the gated "Analyse my day"
 * button. Borrows the visual language of {@link WelcomeProDialog}: aurora
 * glow, drifting motes, a rotating god-ray behind the icon crest, staggered
 * reveals and a shimmering CTA, but compressed into a compact, fast upsell
 * dialog that leads with the feature's value before the upgrade ask.
 *
 * All ambient motion is gated behind `useReducedMotion`; with motion reduced
 * the dialog renders fully legible and static.
 */
export function DietAnalysisTeaserDialog({ open, onOpenChange }: DietAnalysisTeaserDialogProps) {
  const { openPaywall } = useSubscription();
  const prefersReduced = useReducedMotion();

  const handleUpgrade = () => {
    onOpenChange(false);
    openPaywall();
  };

  const reveal = (delay: number, fromY = 10) =>
    prefersReduced
      ? { initial: false as const, animate: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: fromY },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.45, delay, ease: "easeOut" as const },
        };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[340px] rounded-[22px] p-0 border border-border/50 glass-card overflow-hidden gap-0 [&>button:last-of-type]:hidden">
        <VisuallyHidden>
          <DialogTitle>Diet Analysis</DialogTitle>
          <DialogDescription>Upgrade to Pro to analyse your day.</DialogDescription>
        </VisuallyHidden>

        {/* ── Ambient backdrop ──────────────────────────────────────── */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 80% at 50% -8%, hsl(213 94% 68% / 0.20) 0%, hsl(var(--primary) / 0.10) 38%, transparent 66%)",
          }}
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={
            prefersReduced ? { opacity: 1 } : { opacity: 1, scale: [1, 1.05, 1] }
          }
          transition={
            prefersReduced
              ? { duration: 0 }
              : {
                  opacity: { duration: 0.8, ease: "easeOut" },
                  scale: { duration: 7, ease: "easeInOut", repeat: Infinity },
                }
          }
        />

        {/* Drifting motes across the whole dialog background */}
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
                animate={{ opacity: [0, 0.7, 0], y: [-8, -560] }}
                transition={{ duration: m.dur, delay: m.delay, repeat: Infinity, ease: "easeOut" }}
              />
            ))}
          </div>
        )}

        {/* ── Content ───────────────────────────────────────────────── */}
        <div className="relative flex flex-col items-center text-center px-6 pt-8 pb-4">
          {/* Icon crest: god-ray + ring pulse + gradient tile with gloss sweep */}
          <div className="relative mb-4 h-[68px] w-[68px] flex items-center justify-center">
            {!prefersReduced && (
              <motion.div
                aria-hidden
                className="absolute left-1/2 top-1/2 h-[104px] w-[104px] -translate-x-1/2 -translate-y-1/2"
                style={{
                  background:
                    "conic-gradient(from 0deg, transparent 0deg, hsl(213 94% 68% / 0.26) 9deg, transparent 26deg, transparent 81deg, hsl(217 91% 60% / 0.22) 90deg, transparent 107deg, transparent 171deg, hsl(213 94% 68% / 0.26) 180deg, transparent 197deg, transparent 261deg, hsl(217 91% 60% / 0.22) 270deg, transparent 287deg, transparent 360deg)",
                  maskImage: "radial-gradient(circle, transparent 52%, black 68%, transparent 86%)",
                  WebkitMaskImage: "radial-gradient(circle, transparent 52%, black 68%, transparent 86%)",
                }}
                initial={{ opacity: 0, rotate: 0 }}
                animate={{ opacity: 1, rotate: 360 }}
                transition={{
                  opacity: { duration: 0.6 },
                  rotate: { duration: 16, ease: "linear", repeat: Infinity },
                }}
              />
            )}

            {!prefersReduced && (
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-[20px] ring-2 ring-primary/50"
                initial={{ opacity: 0.55, scale: 1 }}
                animate={{ opacity: 0, scale: 1.9 }}
                transition={{ duration: 0.9, delay: 0.15, ease: "easeOut" }}
              />
            )}

            <motion.div
              className="relative h-[60px] w-[60px] rounded-[20px] flex items-center justify-center overflow-hidden"
              style={{
                background: "linear-gradient(145deg, hsl(213 94% 70%) 0%, hsl(217 91% 56%) 55%, hsl(221 83% 46%) 100%)",
                boxShadow: "0 0 26px hsl(217 91% 58% / 0.5), inset 0 1px 1px rgba(255,255,255,0.45)",
              }}
              initial={prefersReduced ? false : { opacity: 0, scale: 0.5, rotate: -12 }}
              animate={
                prefersReduced
                  ? { opacity: 1, scale: 1, rotate: 0 }
                  : { opacity: 1, scale: 1, rotate: 0, y: [0, -4, 0] }
              }
              transition={
                prefersReduced
                  ? { duration: 0 }
                  : {
                      opacity: { type: "spring", stiffness: 260, damping: 16 },
                      scale: { type: "spring", stiffness: 260, damping: 16 },
                      rotate: { type: "spring", stiffness: 260, damping: 16 },
                      y: { duration: 3.2, ease: "easeInOut", repeat: Infinity, delay: 0.7 },
                    }
              }
            >
              <Crown className="h-8 w-8 text-background" strokeWidth={2} fill="currentColor" />
              {!prefersReduced && (
                <motion.span
                  aria-hidden
                  className="absolute top-0 -left-1/2 h-full w-1/2 bg-white/35"
                  style={{ transform: "skewX(-20deg)" }}
                  initial={{ x: "-160%" }}
                  animate={{ x: "320%" }}
                  transition={{ duration: 0.8, delay: 0.35, ease: "easeOut" }}
                />
              )}
            </motion.div>
          </div>

          {/* Eyebrow */}
          <motion.span
            {...reveal(0.05)}
            className="text-[11px] font-bold uppercase tracking-[0.14em]"
            style={{
              background: "linear-gradient(90deg, hsl(213 94% 72%), hsl(217 91% 56%))",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Pro Feature
          </motion.span>

          <motion.h2
            {...reveal(0.12)}
            className="mt-1 text-[20px] font-extrabold tracking-tight text-foreground"
          >
            Analyse my day
          </motion.h2>

          <motion.p
            {...reveal(0.19)}
            className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed"
          >
            Turn today's meals into a full nutrition breakdown. Pro members get it every day.
          </motion.p>
        </div>

        {/* Perks: staggered slide-in */}
        <div className="relative px-5 pb-1 space-y-2.5">
          {PERKS.map((perk, i) => (
            <motion.div
              key={perk.title}
              initial={prefersReduced ? false : { opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={prefersReduced ? { duration: 0 } : { duration: 0.4, delay: 0.28 + i * 0.1, ease: "easeOut" }}
              className="flex items-start gap-3 text-left"
            >
              <span className="mt-0.5 h-6 w-6 rounded-full bg-primary/15 ring-1 ring-primary/20 flex items-center justify-center shrink-0">
                <Check className="h-3.5 w-3.5 text-primary" strokeWidth={2.5} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-foreground">{perk.title}</span>
                <span className="block text-[12px] text-muted-foreground/80 leading-snug">{perk.desc}</span>
              </span>
            </motion.div>
          ))}
        </div>

        {/* CTA + dismiss */}
        <div className="relative px-4 pt-4 pb-4 space-y-2">
          <motion.button
            {...reveal(0.6, 14)}
            onClick={handleUpgrade}
            className="relative w-full h-11 rounded-xs text-[14px] font-bold text-primary-foreground bg-gradient-to-r from-primary to-secondary active:scale-[0.97] transition-transform overflow-hidden"
            style={{ boxShadow: "0 0 24px hsl(var(--primary) / 0.35)" }}
          >
            <span className="relative z-10">Upgrade to Pro</span>
            {/* Periodic shimmer sweep */}
            {!prefersReduced && (
              <motion.span
                aria-hidden
                className="absolute inset-y-0 -left-1/3 w-1/3 bg-white/25"
                style={{ transform: "skewX(-20deg)" }}
                initial={{ x: "-120%" }}
                animate={{ x: "440%" }}
                transition={{ duration: 1.1, ease: "easeOut", repeat: Infinity, repeatDelay: 2.6, delay: 1.0 }}
              />
            )}
          </motion.button>
          <motion.button
            {...reveal(0.68)}
            onClick={() => onOpenChange(false)}
            className="w-full py-2 text-[13px] font-medium text-muted-foreground active:text-foreground transition-colors"
          >
            Not now
          </motion.button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
