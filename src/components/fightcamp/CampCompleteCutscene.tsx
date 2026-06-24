// CampCompleteCutscene: the forceful full-screen "your camp is complete /
// start your next one" takeover. Reuses the app's reference "Aurora Wizard"
// aesthetic (see ProtocolGeneratingOverlay / reference_aurora_wizard_loader):
// a 3D wizard floating in a breathing blue halo over a rising aurora with
// drifting motes, plus a one-shot confetti burst and a success haptic. Copy is
// keyed on `kind`. Reduced-motion collapses to a calm static state.
import { useEffect, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import confetti from "canvas-confetti";
import { Button } from "@/components/ui/button";
import { celebrateSuccess } from "@/lib/haptics";
import wizard from "@/assets/wizard_3D.png";

const BLUE = "217 91% 58%";
const hsl = (a = 1) => `hsl(${BLUE} / ${a})`;

export interface CampCompleteCutsceneProps {
  kind: "wrapup" | "next_camp";
  campName?: string | null;
  onContinue: () => void;
  onSkip: () => void;
}

function copyFor(kind: "wrapup" | "next_camp", campName?: string | null) {
  if (kind === "wrapup") {
    const subject =
      campName && campName.trim() !== "" ? campName.trim() : "Your camp";
    return {
      kicker: "Camp complete",
      headline: `${subject} is in the books.`,
      sub: "Let's log how it went, then line up your next one.",
      primary: "Wrap up & continue",
      secondary: "Skip for now",
    };
  }
  return {
    kicker: "Next camp",
    headline: "Ready for the next one?",
    sub: "No active camp right now. Start your next fight camp and keep the momentum going.",
    primary: "Start next camp",
    secondary: "Not now",
  };
}

export function CampCompleteCutscene({
  kind,
  campName,
  onContinue,
  onSkip,
}: CampCompleteCutsceneProps): JSX.Element {
  const prefersReduced = useReducedMotion();
  const text = copyFor(kind, campName);

  // Deterministic drifting motes (index-based, no Math.random in render).
  const motes = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => ({
        id: i,
        x: ((i * 53) % 200) - 100,
        delay: (i % 4) * 0.7,
        dur: 6 + (i % 4),
        size: 4 + (i % 3) * 2,
      })),
    [],
  );

  // Defensive un-stick: a Radix <Dialog> or vaul <Sheet> on the page underneath
  // (the FightCamps new-camp dialog / NextCampFlow) can leave
  // `document.body { pointer-events: none }` stuck after it closes. This
  // takeover is a sibling of <body>, so it INHERITS that frozen state and every
  // button reads as `pointer-events: none` — taps do nothing. The root below
  // also forces `pointer-events: auto` on itself (immune to the inherited none),
  // but we additionally clear a stuck body value here so backing out / opening
  // the sheet lands on a usable page. Scoped to this overlay's mount; never
  // re-applied on unmount.
  useEffect(() => {
    if (document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
  }, []);

  // One-shot celebration: confetti burst + success haptic on reveal.
  useEffect(() => {
    celebrateSuccess();
    if (prefersReduced) return;
    const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#9DE7D0"];
    const fire = (particleCount: number, opts: confetti.Options) =>
      confetti({
        particleCount,
        spread: 70,
        startVelocity: 42,
        ticks: 220,
        colors,
        disableForReducedMotion: true,
        zIndex: 10020,
        ...opts,
      });
    fire(90, { origin: { x: 0.5, y: 0.32 } });
    fire(50, { angle: 60, origin: { x: 0, y: 0.5 } });
    fire(50, { angle: 120, origin: { x: 1, y: 0.5 } });
  }, [prefersReduced]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={text.headline}
      initial={prefersReduced ? { opacity: 0 } : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[10010] flex flex-col items-center justify-center overflow-hidden bg-background px-7 pointer-events-auto"
      style={{
        // Explicit `pointer-events: auto` makes this takeover immune to a stuck
        // `body { pointer-events: none }` left behind by a Radix/vaul overlay on
        // the page underneath (the recurring "frozen buttons" bug). Without it,
        // the fixed overlay inherits the body's frozen state and no tap lands.
        pointerEvents: "auto",
        paddingTop: "calc(env(safe-area-inset-top) + 24px)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)",
      }}
    >
      {/* Aurora wash rising from the base. */}
      {!prefersReduced && (
        <motion.div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(120% 70% at 50% 100%, ${hsl(0.3)}, transparent 70%)`,
          }}
          animate={{ opacity: [0.6, 1, 0.6], scale: [1, 1.06, 1] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Rising blue motes. */}
      {!prefersReduced &&
        motes.map((m) => (
          <motion.span
            key={m.id}
            aria-hidden
            className="absolute rounded-full"
            style={{
              left: `calc(50% + ${m.x}px)`,
              bottom: 0,
              width: m.size,
              height: m.size,
              background: hsl(0.7),
              filter: "blur(0.5px)",
              boxShadow: `0 0 8px ${hsl(0.9)}`,
            }}
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: -360, opacity: [0, 1, 0] }}
            transition={{
              duration: m.dur,
              repeat: Infinity,
              ease: "easeOut",
              delay: m.delay,
            }}
          />
        ))}

      {/* Haloed, bobbing wizard. */}
      <div
        className="relative z-10 flex items-center justify-center"
        style={{ height: 168 }}
      >
        {!prefersReduced && (
          <motion.div
            aria-hidden
            className="absolute"
            style={{
              width: 196,
              height: 196,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${hsl(0.5)} 0%, ${hsl(0.15)} 40%, transparent 70%)`,
              filter: "blur(8px)",
            }}
            animate={{ opacity: [0.5, 0.85, 0.5], scale: [0.95, 1.08, 0.95] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <motion.img
          src={wizard}
          alt=""
          draggable={false}
          style={{
            width: 140,
            height: 140,
            objectFit: "contain",
            position: "relative",
            zIndex: 2,
            filter: `drop-shadow(0 0 22px ${hsl(0.45)})`,
          }}
          initial={prefersReduced ? false : { scale: 0.8, opacity: 0 }}
          animate={
            prefersReduced
              ? { y: 0, scale: 1, opacity: 1 }
              : { y: [0, -10, 0], scale: 1, opacity: 1 }
          }
          transition={{
            y: { duration: 3.4, repeat: Infinity, ease: "easeInOut" },
            scale: { type: "spring", damping: 18, stiffness: 240 },
            opacity: { duration: 0.4 },
          }}
        />
      </div>

      {/* Kicker + headline + subcopy. */}
      <motion.p
        initial={prefersReduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
        className="relative z-10 mt-6 text-[11px] uppercase tracking-[0.24em] font-bold"
        style={{ color: hsl() }}
      >
        {text.kicker}
      </motion.p>
      <motion.h2
        initial={prefersReduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.22, duration: 0.45 }}
        className="relative z-10 mt-2 text-center text-[26px] font-black tracking-tight text-foreground leading-tight max-w-[20rem]"
      >
        {text.headline}
      </motion.h2>
      <motion.p
        initial={prefersReduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.45 }}
        className="relative z-10 mt-3 text-center text-[14px] text-muted-foreground leading-snug max-w-[19rem]"
      >
        {text.sub}
      </motion.p>

      {/* CTAs pinned toward the bottom. */}
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.45 }}
        className="relative z-10 mt-10 w-full max-w-[22rem] flex flex-col gap-2.5"
      >
        <Button
          onClick={onContinue}
          className="h-12 w-full rounded-2xl text-[15px] font-bold"
        >
          {text.primary}
        </Button>
        <Button
          variant="ghost"
          onClick={onSkip}
          className="h-11 w-full rounded-2xl text-[14px] font-semibold text-muted-foreground"
        >
          {text.secondary}
        </Button>
      </motion.div>
    </motion.div>
  );
}
