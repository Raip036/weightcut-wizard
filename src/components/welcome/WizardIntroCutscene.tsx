/**
 * WizardIntroCutscene — animated welcome sequence before sign-up.
 *
 * Flow
 * ----
 * 1. Mount at full-screen, dark stage. Wizard rises into frame.
 * 2. 5 acts (see `cutsceneScript.ts`) play in order. Each beat:
 *      - Wizard transitions to its new stage position + pose + scale
 *      - SpeechBubble types out the line
 *      - Effects layer kicks in (sparkles, confetti, spotlight, etc.)
 *      - After dwell, auto-advance (or user can tap to skip ahead)
 * 3. Final act swaps the "Skip" pill for two CTAs:
 *      - "Start your cut"  → /auth?mode=signup    (primary)
 *      - "I have an account" → /auth              (secondary)
 *
 * Interaction
 * -----------
 * - Tap anywhere on the stage: if typewriter is running, complete it;
 *   else advance to the next act (or fire primary CTA on final act).
 * - Swipe left: advance. Swipe right: go back one act.
 * - "Skip" pill (top-right) jumps straight to auth signup.
 * - Reduced-motion users get a static composition with the same copy.
 *
 * Design notes
 * ------------
 * - Single mascot instance — we animate position/scale/pose between
 *   acts instead of mounting/unmounting. Keeps the wizard feeling
 *   continuous and live.
 * - Effects render in their own absolutely-positioned layer behind the
 *   mascot so they never block taps on the CTA layer.
 * - Bubble + CTA stack live above the mascot on z so they're always
 *   readable when the wizard is mid-celebrate.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "motion/react";
import { X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { useAuthActions } from "@convex-dev/auth/react";
import { WizardCharacter } from "@/tutorial/WizardCharacter";
import { SpeechBubble } from "@/tutorial/SpeechBubble";
import { useToast } from "@/hooks/use-toast";
import { mapAuthError, isAppleCancelError } from "@/lib/authErrors";
import { logger } from "@/lib/logger";

/**
 * Apple Inc. brand mark — solid silhouette per Apple's HIG for "Sign in
 * with Apple" buttons. lucide's `Apple` icon is the *fruit* outline and
 * is not approved for sign-in buttons.
 */
function AppleLogo({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}
import {
  CUTSCENE_ACTS,
  COACH_CUTSCENE_ACTS,
  CUTSCENE_SEEN_KEY,
  COACH_CUTSCENE_SEEN_KEY,
  type CutsceneAct,
  type StageEffect,
} from "./cutsceneScript";

// Per-variant routing + copy. Keep all the role-aware bits in one
// object so the playback engine stays generic — adding a third variant
// later means dropping in another entry, not threading conditionals.
type CutsceneVariant = "fighter" | "coach";
const VARIANTS: Record<
  CutsceneVariant,
  {
    acts: CutsceneAct[];
    seenKey: string;
    role: "fighter" | "coach";
    /** Where Apple sign-in lands the user on success. */
    appleSuccessPath: string;
    /** Where "I already have an account" routes to. */
    existingAccountPath: string;
    /** Where the "Skip" pill routes to (top-right). */
    skipPath: string;
    /** Final-act CTA button labels. */
    appleLabel: string;
    existingAccountLabel: string;
  }
> = {
  fighter: {
    acts: CUTSCENE_ACTS,
    seenKey: CUTSCENE_SEEN_KEY,
    role: "fighter",
    appleSuccessPath: "/dashboard",
    existingAccountPath: "/auth",
    skipPath: "/auth?mode=signup",
    appleLabel: "Continue with Apple",
    existingAccountLabel: "I already have an account",
  },
  coach: {
    acts: COACH_CUTSCENE_ACTS,
    seenKey: COACH_CUTSCENE_SEEN_KEY,
    role: "coach",
    appleSuccessPath: "/coach",
    existingAccountPath: "/coach/login",
    skipPath: "/coach/login",
    appleLabel: "Continue with Apple",
    existingAccountLabel: "I already have a coach account",
  },
};

// ── Tuning constants ──────────────────────────────────────────────────
// Pre-tuned for an iPhone 12-class viewport. The script's normalized
// coordinates scale linearly with the stage, so these only need to
// move if the *base* mascot size or padding changes.
const MASCOT_BASE_PX = 140; // matches WizardCharacter's intrinsic size
const BUBBLE_GAP_PX = 16;   // visible gap between bubble (incl. tail) and mascot
const BUBBLE_TAIL_OVERHANG_PX = 14; // SpeechBubble tail SVG extends ~14px past the bubble box edge
const BUBBLE_EDGE_PADDING_PX = 12; // min gap between bubble and screen edge
const BUBBLE_HARD_MAX_PX = 360;    // matches SpeechBubble's own max-w cap
const ADVANCE_SWIPE_PX = 50;

async function lightHaptic(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const mod = await import("@capacitor/haptics");
    await mod.Haptics.impact({ style: mod.ImpactStyle.Light });
  } catch {
    // Plugin missing or denied — silent.
  }
}

async function reactionHaptic(style: "Light" | "Medium" | "Heavy"): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const mod = await import("@capacitor/haptics");
    const map = {
      Light: mod.ImpactStyle.Light,
      Medium: mod.ImpactStyle.Medium,
      Heavy: mod.ImpactStyle.Heavy,
    };
    await mod.Haptics.impact({ style: map[style] });
  } catch {
    // Plugin missing or denied — silent.
  }
}

// Variable-reward micro reactions when the user taps the wizard. Each
// reaction is a small position/scale/rotation tween layered on top of
// the wizard's stage-position animation. Picked randomly per tap so the
// behavior feels alive instead of scripted — see `handleWizardTap`.
interface WizardReaction {
  id: string;
  transform: { rotate?: number[]; scale?: number[]; y?: number[] };
  durationMs: number;
  haptic: "Light" | "Medium" | "Heavy";
}

const WIZARD_REACTIONS: ReadonlyArray<WizardReaction> = [
  { id: "jump",     transform: { y: [0, -20, 0] },                          durationMs: 400, haptic: "Medium" },
  { id: "spin",     transform: { rotate: [0, 360] },                        durationMs: 600, haptic: "Medium" },
  { id: "shake",    transform: { rotate: [0, -8, 8, -6, 6, 0] },            durationMs: 500, haptic: "Light"  },
  { id: "bounce",   transform: { scale: [1, 1.15, 0.95, 1.05, 1] },         durationMs: 500, haptic: "Medium" },
  { id: "wiggle",   transform: { rotate: [0, 5, -5, 3, -3, 0] },            durationMs: 400, haptic: "Light"  },
  { id: "puff",     transform: { scale: [1, 0.9, 1.1, 1] },                 durationMs: 350, haptic: "Light"  },
  { id: "stretch",  transform: { scale: [1, 1.2, 1], y: [0, -8, 0] },       durationMs: 450, haptic: "Medium" },
  { id: "moonwalk", transform: { y: [0, -4, 0], rotate: [0, -15, 15, 0] },  durationMs: 700, haptic: "Heavy"  },
];

interface StageDims {
  width: number;
  height: number;
}

/**
 * Resolve the wizard's pixel position + bubble anchor for a given act.
 * The bubble is anchored to the wizard's bounding box edge so the tail
 * always lands on him regardless of where he stands on the stage.
 */
function layoutForAct(act: CutsceneAct, dims: StageDims): {
  mascotLeft: number;
  mascotTop: number;
  mascotSize: number;
  bubbleStyle: React.CSSProperties;
  /**
   * Static transform values handed to motion's `x`/`y` props. We deliberately
   * keep these OFF of `bubbleStyle.transform` because motion overwrites
   * `style.transform` with its own composed transform when you animate
   * `scale`/`opacity`, which used to silently drop the `-100%` Y shift and
   * dump the "above" bubble on top of the wizard.
   */
  bubbleX: string | number;
  bubbleY: string | number;
} {
  const mascotSize = MASCOT_BASE_PX * act.scale;
  // act.position is the CENTER of the mascot.
  const centerX = act.position.x * dims.width;
  const centerY = act.position.y * dims.height;
  const mascotLeft = centerX - mascotSize / 2;
  const mascotTop = centerY - mascotSize / 2;

  // Bubble: positioned RELATIVE to the stage (absolute). Compute the
  // anchor point depending on `bubbleSide` so the tail naturally lands
  // on the wizard. We also clamp `maxWidth` against the room available
  // on the chosen side so the bubble can never escape the stage —
  // SpeechBubble itself uses `w-fit` and respects this cap.
  const bubbleStyle: React.CSSProperties = { position: "absolute" };
  let bubbleX: string | number = 0;
  let bubbleY: string | number = 0;
  const centeredMax = Math.min(
    BUBBLE_HARD_MAX_PX,
    Math.max(0, dims.width - 2 * BUBBLE_EDGE_PADDING_PX),
  );
  switch (act.bubbleSide) {
    case "above": {
      // The "bottom-*" tail extends BUBBLE_TAIL_OVERHANG_PX below the
      // bubble's box. Push the bubble up by that much so the tail's tip
      // clears the wizard with a real BUBBLE_GAP_PX of breathing room.
      bubbleStyle.left = "50%";
      bubbleStyle.top = `${mascotTop - BUBBLE_GAP_PX - BUBBLE_TAIL_OVERHANG_PX}px`;
      bubbleX = "-50%";
      bubbleY = "-100%";
      bubbleStyle.maxWidth = `${centeredMax}px`;
      break;
    }
    case "below": {
      bubbleStyle.left = "50%";
      bubbleStyle.top = `${mascotTop + mascotSize + BUBBLE_GAP_PX + BUBBLE_TAIL_OVERHANG_PX}px`;
      bubbleX = "-50%";
      bubbleY = 0;
      bubbleStyle.maxWidth = `${centeredMax}px`;
      break;
    }
    case "right": {
      const leftPx = mascotLeft + mascotSize + BUBBLE_GAP_PX;
      const room = Math.max(0, dims.width - leftPx - BUBBLE_EDGE_PADDING_PX);
      bubbleStyle.left = `${leftPx}px`;
      bubbleStyle.top = `${centerY}px`;
      bubbleX = 0;
      bubbleY = "-50%";
      bubbleStyle.maxWidth = `${Math.min(BUBBLE_HARD_MAX_PX, room)}px`;
      break;
    }
    case "left": {
      const rightPx = dims.width - mascotLeft + BUBBLE_GAP_PX;
      const room = Math.max(0, dims.width - rightPx - BUBBLE_EDGE_PADDING_PX);
      bubbleStyle.right = `${rightPx}px`;
      bubbleStyle.top = `${centerY}px`;
      bubbleX = 0;
      bubbleY = "-50%";
      bubbleStyle.maxWidth = `${Math.min(BUBBLE_HARD_MAX_PX, room)}px`;
      break;
    }
  }
  return { mascotLeft, mascotTop, mascotSize, bubbleStyle, bubbleX, bubbleY };
}

// ── Effect layers ─────────────────────────────────────────────────────

function SparklesLayer({ count = 12 }: { count?: number }) {
  // Pseudo-random but stable positions per sparkle.
  const sparkles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: `${(i * 73) % 100}%`,
        top: `${(i * 41 + 20) % 90}%`,
        delay: (i % 5) * 0.3,
        size: 3 + ((i * 7) % 4),
      })),
    [count],
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {sparkles.map((s) => (
        <motion.span
          key={s.id}
          className="absolute rounded-full bg-amber-200"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            boxShadow: "0 0 12px rgba(255, 220, 130, 0.85)",
            mixBlendMode: "screen",
          }}
          animate={{ opacity: [0, 1, 0], y: [0, -22, -44], scale: [0.6, 1.1, 0.4] }}
          transition={{ duration: 2.6, repeat: Infinity, delay: s.delay, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

function SpotlightLayer({ x, y }: { x: number; y: number }) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-0"
      style={{
        background: `radial-gradient(circle at ${x}px ${y}px, rgba(255,200,90,0.18) 0%, rgba(255,200,90,0.08) 28%, rgba(0,0,0,0) 60%)`,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
    />
  );
}

function PulseRingLayer({ x, y }: { x: number; y: number }) {
  return (
    <div
      className="pointer-events-none absolute z-0"
      style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
    >
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full border border-amber-300/50"
          style={{ left: -90, top: -90, width: 180, height: 180 }}
          animate={{ scale: [0.6, 1.8], opacity: [0.7, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.7, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

function ConfettiLayer() {
  // 22 streamers fan out from center-top. Deterministic angles so the
  // burst reads as a designed moment, not noise.
  const pieces = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => {
        const angle = (i / 22) * Math.PI * 2;
        const dist = 200 + (i % 5) * 30;
        return {
          id: i,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist - 80,
          rot: (i * 47) % 360,
          color: ["#FFD166", "#EF476F", "#06D6A0", "#118AB2", "#F4A261"][i % 5],
        };
      }),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute left-1/2 top-1/3"
          style={{ width: 8, height: 14, background: p.color, borderRadius: 2 }}
          initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
          animate={{ x: p.dx, y: p.dy, opacity: [0, 1, 0], rotate: p.rot }}
          transition={{ duration: 1.4, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

// Animated digital scale: needle counts up, settles ~0.7 lb over the limit,
// flashes red, and reveals a "1 in 13 miss weight" caption. Sells the
// "Never miss weight again" promise viscerally — the moment fighters dread,
// re-staged as proof we know it.
function WeightScaleLayer({ dims }: { dims: StageDims }) {
  const prefersReduced = useReducedMotion();
  const LIMIT = 155;
  const TARGET = 155.7;
  const FROM = 153.4;
  // Bar range: 150..158 maps to 0..1 so the limit sits past center
  // and "over" reads clearly in the rightmost ~third.
  const BAR_LO = 150;
  const BAR_HI = 158;
  const toPct = (v: number) => Math.min(1, Math.max(0, (v - BAR_LO) / (BAR_HI - BAR_LO)));

  const [displayed, setDisplayed] = useState(prefersReduced ? TARGET : FROM);
  const [settled, setSettled] = useState(prefersReduced);

  useEffect(() => {
    if (prefersReduced) return;
    let raf = 0;
    const start = performance.now();
    const duration = 1500;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      // Tiny needle wobble in the final 15% so it feels mechanical, not just a tween.
      const wobble = t > 0.85 ? Math.sin((now - start) / 32) * 0.18 * (1 - t) : 0;
      setDisplayed(FROM + (TARGET - FROM) * eased + wobble);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setDisplayed(TARGET);
        setSettled(true);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [prefersReduced]);

  const over = Math.max(0, displayed - LIMIT);
  const isOver = displayed > LIMIT + 0.05;
  const fillPct = toPct(displayed) * 100;
  const limitLeftPct = toPct(LIMIT) * 100;

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: dims.width / 2,
        top: Math.max(96, dims.height * 0.17),
        transform: "translateX(-50%)",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative w-[260px] rounded-2xl bg-zinc-950/85 px-4 pt-3 pb-3 ring-1 ring-amber-400/20 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-sm"
      >
        {/* Header row: live readout + units */}
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Weigh-in
          </span>
          <motion.div
            className="flex items-baseline gap-1"
            animate={settled && !prefersReduced ? { x: [0, -1.2, 1.2, -0.8, 0] } : undefined}
            transition={settled && !prefersReduced ? { duration: 0.35, ease: "easeOut" } : undefined}
          >
            <motion.span
              className={`font-mono text-[28px] font-bold leading-none tabular-nums transition-colors ${
                isOver ? "text-red-400" : "text-amber-200"
              }`}
              animate={settled && isOver && !prefersReduced ? { opacity: [1, 0.45, 1, 0.6, 1] } : undefined}
              transition={settled && isOver && !prefersReduced ? { duration: 0.55, ease: "easeInOut" } : undefined}
            >
              {displayed.toFixed(1)}
            </motion.span>
            <span className="text-[11px] font-medium text-zinc-500">lbs</span>
          </motion.div>
        </div>

        {/* Bar gauge */}
        <div className="relative mt-3 h-2.5 w-full overflow-hidden rounded-full bg-zinc-800/80">
          <motion.div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-300 via-amber-400 to-red-500"
            initial={{ width: 0 }}
            animate={{ width: `${fillPct}%` }}
            transition={{ duration: 0.08, ease: "linear" }}
          />
          {/* Limit marker line */}
          <div
            className="absolute top-0 bottom-0 w-px bg-white/85"
            style={{ left: `${limitLeftPct}%` }}
          />
          {/* Limit flag */}
          <div
            className="absolute -top-0.5 h-3.5 w-1.5 -translate-x-1/2 rounded-sm bg-white/85"
            style={{ left: `${limitLeftPct}%` }}
          />
        </div>

        {/* Scale labels */}
        <div className="mt-2 flex justify-between text-[9px] font-medium uppercase tracking-wider text-zinc-500">
          <span>{BAR_LO}</span>
          <span className="text-zinc-300">Limit {LIMIT}.0</span>
          <span>{BAR_HI}</span>
        </div>

        {/* OVER badge — punches in once settled */}
        <AnimatePresence>
          {settled && isOver && (
            <motion.div
              key="over-badge"
              initial={{ opacity: 0, y: -6, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={
                prefersReduced
                  ? { duration: 0.15 }
                  : { type: "spring", stiffness: 420, damping: 18 }
              }
              className="absolute -right-2 -top-2 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ring-2 ring-zinc-950 shadow-lg shadow-red-500/30"
            >
              +{over.toFixed(1)} OVER
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Caption — the stat that justifies the whole slide */}
      <motion.div
        className="mt-2.5 text-center text-[11px] font-medium text-zinc-400"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55, duration: 0.4 }}
      >
        <span className="text-zinc-200">1 in 13</span> UFC fighters miss weight
      </motion.div>
    </div>
  );
}

// Cut-protocol timeline: 5 dots draw in left-to-right showing the canonical
// week-of-fight sequence. Sells the Act 3 claim — "we know the names AND
// the order" — by actually showing the order, day by day.
const PROTOCOL_STAGES: ReadonlyArray<{ day: string; label: string }> = [
  { day: "D-7", label: "Water load" },
  { day: "D-5", label: "Carb taper" },
  { day: "D-3", label: "Sodium cut" },
  { day: "D-1", label: "Sauna" },
  { day: "0",   label: "Weigh-in" },
];

function ProtocolTimelineLayer({ dims }: { dims: StageDims }) {
  const prefersReduced = useReducedMotion();
  const stages = PROTOCOL_STAGES;
  const lastIdx = stages.length - 1;

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: dims.width / 2,
        top: Math.max(96, dims.height * 0.17),
        transform: "translateX(-50%)",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative w-[300px] rounded-2xl bg-zinc-950/85 px-4 pb-3 pt-3 ring-1 ring-amber-400/20 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-sm"
      >
        <div className="mb-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Cut protocol
        </div>

        {/* Timeline rail */}
        <div className="relative">
          {/* Day labels (top) */}
          <div className="mb-1.5 flex items-end justify-between px-0.5">
            {stages.map((s, i) => (
              <motion.span
                key={`d-${s.day}`}
                className="whitespace-nowrap font-mono text-[9px] font-bold text-zinc-500"
                initial={prefersReduced ? false : { opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                transition={prefersReduced ? { duration: 0.1 } : { delay: 0.15 + i * 0.12, duration: 0.25 }}
              >
                {s.day}
              </motion.span>
            ))}
          </div>

          {/* Rail + dots */}
          <div className="relative h-3">
            {/* Background rail */}
            <div className="absolute left-1.5 right-1.5 top-1/2 h-px -translate-y-1/2 bg-zinc-800" />
            {/* Animated fill rail draws left-to-right */}
            <motion.div
              className="absolute left-1.5 top-1/2 h-px -translate-y-1/2 origin-left bg-gradient-to-r from-amber-300 via-amber-400 to-emerald-400"
              style={{ right: "0.375rem" }}
              initial={prefersReduced ? { scaleX: 1 } : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={prefersReduced ? { duration: 0.1 } : { delay: 0.25, duration: 0.9, ease: "easeOut" }}
            />
            {/* Dots */}
            <div className="absolute inset-0 flex items-center justify-between">
              {stages.map((s, i) => {
                const isLast = i === lastIdx;
                return (
                  <motion.div
                    key={`dot-${s.day}`}
                    className={`relative h-2.5 w-2.5 rounded-full ring-2 ring-zinc-950 ${
                      isLast ? "bg-emerald-400" : "bg-amber-300"
                    }`}
                    initial={prefersReduced ? false : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={
                      prefersReduced
                        ? { duration: 0.1 }
                        : { delay: 0.3 + i * 0.13, type: "spring", stiffness: 520, damping: 18 }
                    }
                  >
                    {isLast && !prefersReduced && (
                      <motion.span
                        className="absolute inset-0 rounded-full bg-emerald-400"
                        animate={{ scale: [1, 2.2, 1], opacity: [0.6, 0, 0.6] }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut", delay: 1.0 }}
                      />
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Stage labels (bottom) */}
          <div className="mt-2 flex items-start justify-between px-0.5">
            {stages.map((s, i) => {
              const isLast = i === lastIdx;
              return (
                <motion.span
                  key={`l-${s.day}`}
                  className={`whitespace-nowrap text-[10px] font-medium leading-tight ${
                    isLast ? "text-emerald-300" : "text-zinc-300"
                  }`}
                  initial={prefersReduced ? false : { opacity: 0, y: 2 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    prefersReduced
                      ? { duration: 0.1 }
                      : { delay: 0.45 + i * 0.13, duration: 0.3 }
                  }
                >
                  {isLast ? "✓ Made" : s.label}
                </motion.span>
              );
            })}
          </div>
        </div>
      </motion.div>

      {/* Caption — mirrors the Act 2 stat hook */}
      <motion.div
        className="mt-2.5 text-center text-[11px] font-medium text-zinc-400"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.1, duration: 0.4 }}
      >
        <span className="text-zinc-200">Order matters</span> — skip a step, miss the limit
      </motion.div>
    </div>
  );
}

// Coach-side visual #1: a mini roster card with status dots. Sells
// "your whole gym, one screen" by literally showing a sample roster
// with green/yellow/red dots that the cutscene rolls in row-by-row.
const ROSTER_SAMPLE: ReadonlyArray<{ name: string; status: "ok" | "watch" | "alert"; meta: string }> = [
  { name: "Daniel V.", status: "ok",    meta: "155.2 · 1d ago" },
  { name: "Mei L.",    status: "watch", meta: "118.4 · 3d ago" },
  { name: "Kayode A.", status: "ok",    meta: "170.0 · today" },
  { name: "Sasha R.",  status: "alert", meta: "stale · 5d ago" },
];

function RosterStatusLayer({ dims }: { dims: StageDims }) {
  const prefersReduced = useReducedMotion();
  const dotColor = (s: "ok" | "watch" | "alert") =>
    s === "ok" ? "bg-emerald-400" : s === "watch" ? "bg-amber-400" : "bg-red-400";

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: dims.width / 2,
        top: Math.max(96, dims.height * 0.17),
        transform: "translateX(-50%)",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative w-[260px] rounded-2xl bg-zinc-950/85 px-4 py-3 ring-1 ring-sky-400/20 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-sm"
      >
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Roster
          </span>
          <span className="text-[10px] font-mono text-zinc-500 tabular-nums">{ROSTER_SAMPLE.length}/12</span>
        </div>
        <div className="space-y-1.5">
          {ROSTER_SAMPLE.map((athlete, i) => (
            <motion.div
              key={athlete.name}
              initial={prefersReduced ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={prefersReduced ? { duration: 0.1 } : { delay: 0.2 + i * 0.1, duration: 0.3 }}
              className="flex items-center gap-2.5 rounded-xl bg-white/[0.03] px-2.5 py-2 ring-1 ring-white/[0.04]"
            >
              <span className={`h-2 w-2 rounded-full ${dotColor(athlete.status)} flex-shrink-0`} />
              <span className="flex-1 text-[12px] font-medium text-zinc-200 truncate">{athlete.name}</span>
              <span className="text-[10px] font-mono text-zinc-500 tabular-nums">{athlete.meta}</span>
            </motion.div>
          ))}
        </div>
      </motion.div>
      <motion.div
        className="mt-2.5 text-center text-[11px] font-medium text-zinc-400"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.75, duration: 0.4 }}
      >
        <span className="text-zinc-200">Green</span> on plan · <span className="text-amber-300/95">Yellow</span> watch · <span className="text-red-400">Red</span> alert
      </motion.div>
    </div>
  );
}

// Coach-side visual #2: a "fight form" readiness gauge. Maps the
// 4-tier athlete readiness label coaches actually use in-app
// (Sharp / Sharpening / Off Pace / At Risk) so they can see the
// metric the app surfaces before they hit signup.
function ReadinessMeterLayer({ dims }: { dims: StageDims }) {
  const prefersReduced = useReducedMotion();
  const TIERS = ["Sharp", "Sharpening", "Off Pace", "At Risk"] as const;
  // Needle settles on "Sharpening" — the most common in-camp state, so
  // the visual reads as "actively-managed athlete" not "everything fine".
  const TARGET_INDEX = 1;
  const segmentWidth = 100 / TIERS.length;
  const needlePct = segmentWidth * TARGET_INDEX + segmentWidth / 2;

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: dims.width / 2,
        top: Math.max(96, dims.height * 0.17),
        transform: "translateX(-50%)",
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative w-[280px] rounded-2xl bg-zinc-950/85 px-4 py-3 ring-1 ring-sky-400/20 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-sm"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Fight form
          </span>
          <span className="text-[11px] font-bold text-sky-300">{TIERS[TARGET_INDEX]}</span>
        </div>

        {/* Gauge bar — 4 segments left-to-right (green→red) */}
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-zinc-800/80">
          <div className="absolute inset-y-0 left-0 right-0 flex">
            <div className="h-full w-1/4 bg-emerald-400/85" />
            <div className="h-full w-1/4 bg-sky-400/85" />
            <div className="h-full w-1/4 bg-amber-400/85" />
            <div className="h-full w-1/4 bg-red-500/85" />
          </div>
          {/* Needle/marker */}
          <motion.div
            className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 rounded-sm bg-white shadow-[0_0_0_2px_rgba(8,8,14,0.8)]"
            initial={prefersReduced ? { left: `${needlePct}%` } : { left: "5%" }}
            animate={{ left: `${needlePct}%` }}
            transition={
              prefersReduced
                ? { duration: 0.1 }
                : { delay: 0.3, duration: 1.1, ease: [0.22, 1, 0.36, 1] }
            }
          />
        </div>

        {/* Tier labels */}
        <div className="mt-2 flex justify-between text-[9px] font-medium uppercase tracking-wider text-zinc-500">
          {TIERS.map((t, i) => (
            <motion.span
              key={t}
              className={`whitespace-nowrap ${i === TARGET_INDEX ? "text-zinc-200" : ""}`}
              initial={prefersReduced ? false : { opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                prefersReduced
                  ? { duration: 0.1 }
                  : { delay: 0.4 + i * 0.08, duration: 0.25 }
              }
            >
              {t}
            </motion.span>
          ))}
        </div>
      </motion.div>

      <motion.div
        className="mt-2.5 text-center text-[11px] font-medium text-zinc-400"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.0, duration: 0.4 }}
      >
        <span className="text-zinc-200">One score per athlete</span> — updated daily
      </motion.div>
    </div>
  );
}

function renderEffect(effect: StageEffect, dims: StageDims, mascotCenter: { x: number; y: number }) {
  switch (effect) {
    case "sparkles":
      return <SparklesLayer key="sparkles" />;
    case "spotlight":
      return <SpotlightLayer key="spotlight" x={mascotCenter.x} y={mascotCenter.y} />;
    case "pulse-ring":
      return <PulseRingLayer key="pulse-ring" x={mascotCenter.x} y={mascotCenter.y} />;
    case "confetti":
      return <ConfettiLayer key="confetti" />;
    case "weight-plates":
      return <WeightScaleLayer key="weight-plates" dims={dims} />;
    case "protocol-timeline":
      return <ProtocolTimelineLayer key="protocol-timeline" dims={dims} />;
    case "roster-status":
      return <RosterStatusLayer key="roster-status" dims={dims} />;
    case "readiness-meter":
      return <ReadinessMeterLayer key="readiness-meter" dims={dims} />;
    case "scroll-unroll":
      // Reserved for future use — script doesn't currently summon it.
      return null;
    default:
      return null;
  }
}

// ── Main component ────────────────────────────────────────────────────

export function WizardIntroCutscene({
  variant = "fighter",
}: { variant?: CutsceneVariant } = {}): JSX.Element {
  const navigate = useNavigate();
  const prefersReduced = useReducedMotion();
  const { signIn } = useAuthActions();
  const { toast } = useToast();
  const config = VARIANTS[variant];
  const ACTS = config.acts;

  const [actIndex, setActIndex] = useState(0);
  const [typingDone, setTypingDone] = useState(false);
  const [forceComplete, setForceComplete] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [reactionAnim, setReactionAnim] = useState<WizardReaction | null>(null);
  // Crossfade exit when handing off to /auth — the stage opacity drops
  // before navigation so the auth page fade-in lands on a clean dark
  // background instead of a hard cut.
  const [exiting, setExiting] = useState(false);
  const [dims, setDims] = useState<StageDims>(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 390,
    height: typeof window !== "undefined" ? window.innerHeight : 844,
  }));

  const stageRef = useRef<HTMLDivElement>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const act = ACTS[actIndex];
  const isFinal = actIndex === ACTS.length - 1;

  // Track viewport so the script's normalized coords stay correct on rotate
  // / split-view / iPad multitasking.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handle = () => setDims({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);

  // Mark cutscene as seen on mount — once a user lands here we don't want
  // to gate any other UI on "have they seen it." (Index.tsx still routes
  // them through it for the "Get Started" tap; this flag is for analytics
  // / future variations.)
  useEffect(() => {
    try {
      window.localStorage.setItem(config.seenKey, "true");
    } catch {
      // Storage blocked — fine, not load-bearing.
    }
  }, [config.seenKey]);

  // Step transition side-effects: reset typewriter, schedule auto-advance.
  useEffect(() => {
    setTypingDone(false);
    setForceComplete(false);
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    void lightHaptic();
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
  }, [actIndex]);

  // No auto-advance. The cutscene is self-paced — typing complete just
  // unlocks the "tap to continue" affordance; the user controls when to
  // move on. Prevents the "it ran past me before I could read it" complaint
  // earlier copy beats were getting. The act script's dwellMs values are
  // now informational only (kept for future variations).
  //
  // Reduced-motion exception: typewriter is suppressed in that mode, so
  // we honour the user's accessibility preference with a slow time-based
  // advance — they're not reading character-by-character, just letting
  // the beats sweep past.
  useEffect(() => {
    if (!prefersReduced) return;
    if (isFinal) return;
    const t = setTimeout(() => {
      setActIndex((i) => Math.min(i + 1, ACTS.length - 1));
    }, 5200);
    return () => clearTimeout(t);
  }, [actIndex, prefersReduced, isFinal]);

  // ── Handlers ──────────────────────────────────────────────────────
  const advance = useCallback((): void => {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    setActIndex((i) => Math.min(i + 1, ACTS.length - 1));
  }, []);

  const goBack = useCallback((): void => {
    setActIndex((i) => Math.max(0, i - 1));
  }, []);

  const handleStageTap = useCallback((): void => {
    if (!typingDone) {
      // First tap during typing — complete it instantly.
      setForceComplete(true);
      return;
    }
    if (isFinal) return; // final act: rely on CTA buttons
    advance();
  }, [typingDone, isFinal, advance]);

  const handlePanEnd = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (info.offset.x < -ADVANCE_SWIPE_PX) advance();
      else if (info.offset.x > ADVANCE_SWIPE_PX) goBack();
    },
    [advance, goBack],
  );

  const handleSkip = useCallback((): void => {
    navigate(config.skipPath);
  }, [navigate, config.skipPath]);

  const handleContinueWithApple = useCallback(async (): Promise<void> => {
    if (appleLoading) return;
    void lightHaptic();
    setAppleLoading(true);
    try {
      if (Capacitor.isNativePlatform()) {
        // Native iOS path — mirrors Auth.tsx's handleAppleSignIn so users
        // who tap "Continue with Apple" from the cutscene get the exact
        // same first-class native experience and avoid a redirect bounce.
        const rawNonce = crypto.randomUUID();
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawNonce));
        const hashedNonce = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;
        if (!convexSiteUrl) {
          throw new Error("VITE_CONVEX_SITE_URL not set — cannot build Apple redirect URI");
        }
        const redirectURI = `${convexSiteUrl}/api/auth/callback/apple`;
        logger.debug("[cutscene-apple-signin] starting native authorize", { redirectURI });
        const { SignInWithApple } = await import("@capacitor-community/apple-sign-in");
        const result = await SignInWithApple.authorize({
          clientId: "com.weightcutwizard.app",
          redirectURI,
          scopes: "email",
          nonce: hashedNonce,
        });
        // Variant-aware role: fighter cutscene passes "fighter", coach
        // cutscene passes "coach" so the bootstrap profile row is created
        // with the right role atomically with sign-in.
        await signIn("apple-native", {
          idToken: result.response.identityToken,
          nonce: rawNonce,
          ...(result.response.email ? { email: result.response.email } : {}),
          ...(result.response.givenName ? { givenName: result.response.givenName } : {}),
          ...(result.response.familyName ? { familyName: result.response.familyName } : {}),
          role: config.role,
        });
      } else {
        // Web fallback — Convex Auth handles the redirect dance.
        await signIn("apple", { redirectTo: `${window.location.origin}${config.appleSuccessPath}` });
      }
      navigate(config.appleSuccessPath);
    } catch (error: any) {
      // Silent cancel — user backed out of the Apple sheet, nothing to do.
      // Stays on the cutscene so they can try again or pick the other CTA.
      if (isAppleCancelError(error)) {
        setAppleLoading(false);
        return;
      }
      logger.error("[cutscene-apple-signin] failed", error, {
        message: error?.message,
        code: error?.code,
        name: error?.name,
      });
      toast({
        variant: "destructive",
        title: "Apple Sign-In Failed",
        description: mapAuthError(error, "oauth"),
      });
      // Fall back to the full auth screen so the user isn't dead-ended.
      navigate(config.existingAccountPath);
    } finally {
      setAppleLoading(false);
    }
  }, [appleLoading, navigate, signIn, toast, config]);

  const handleHaveAccount = useCallback((): void => {
    setExiting(true);
    // Match the 260ms enter animation on the auth page so the handoff
    // feels like one continuous fade, not two stitched together.
    setTimeout(() => navigate(config.existingAccountPath), 240);
  }, [navigate, config.existingAccountPath]);

  const handleWizardTap = useCallback((): void => {
    // Variable-reward: most taps roll a normal reaction, ~1-in-20 lands
    // the rare "moonwalk" so the wizard feels alive and unpredictable.
    const normalReactions = WIZARD_REACTIONS.filter((r) => r.id !== "moonwalk");
    const moonwalk = WIZARD_REACTIONS.find((r) => r.id === "moonwalk");
    const isMoonwalk = moonwalk && Math.random() < 0.05;
    const picked: WizardReaction = isMoonwalk
      ? moonwalk
      : normalReactions[Math.floor(Math.random() * normalReactions.length)];
    void reactionHaptic(picked.haptic);
    setReactionAnim(picked);
    if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    reactionTimerRef.current = setTimeout(() => {
      setReactionAnim(null);
      reactionTimerRef.current = null;
    }, picked.durationMs);
  }, []);

  // Clean up any pending reaction timeout on unmount so we don't try to
  // set state after the cutscene has been dismissed.
  useEffect(() => {
    return () => {
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    };
  }, []);

  // Layout for this act
  const layout = useMemo(() => layoutForAct(act, dims), [act, dims]);
  const mascotCenter = {
    x: layout.mascotLeft + layout.mascotSize / 2,
    y: layout.mascotTop + layout.mascotSize / 2,
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div
      ref={stageRef}
      className="fixed inset-0 z-[9999] overflow-hidden bg-[#020204] text-white transition-opacity duration-[240ms] ease-out"
      // Cosmic vignette — matches the dark-mode Apple-Fitness aesthetic
      // of the app shell. Subtle radial so the wizard pops without
      // looking like we slapped him on a black rectangle.
      style={{
        background:
          "radial-gradient(ellipse at 50% 30%, rgba(40, 28, 60, 0.7) 0%, rgba(8, 8, 14, 0.95) 55%, #020204 100%)",
        opacity: exiting ? 0 : 1,
      }}
    >
      {/* Skip pill — top-right, screen-relative */}
      <button
        type="button"
        onClick={handleSkip}
        aria-label="Skip introduction"
        className="absolute z-30 flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-white/85"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 14px)",
          right: "calc(env(safe-area-inset-right, 0px) + 14px)",
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.10)",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.4} />
        Skip
      </button>

      {/* Progress dots — top-center, one per act */}
      <div
        className="absolute z-30 flex items-center gap-1.5"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 22px)",
          left: "50%",
          transform: "translateX(-50%)",
        }}
        aria-hidden
      >
        {ACTS.map((_, i) => (
          <motion.span
            key={i}
            className="h-1.5 rounded-full bg-white"
            animate={{
              width: i === actIndex ? 22 : 6,
              opacity: i === actIndex ? 1 : i < actIndex ? 0.55 : 0.25,
            }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          />
        ))}
      </div>

      {/* Tap/swipe surface — covers the whole stage. Children above use
          higher z-index so the buttons still take precedence. */}
      <motion.div
        className="absolute inset-0 z-10"
        onClick={handleStageTap}
        drag={prefersReduced ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.15}
        onPanEnd={handlePanEnd}
      />

      {/* Effects layer (sparkles, spotlight, confetti, etc.) */}
      <AnimatePresence>
        {act.effects?.map((effect) => (
          <motion.div
            key={`${act.id}-${effect}`}
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            {renderEffect(effect, dims, mascotCenter)}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Wizard — single instance, animates between stage positions.
          Tappable: each tap rolls a random micro-reaction (see
          WIZARD_REACTIONS) for variable-reward engagement. */}
      <motion.div
        className="absolute z-20 pointer-events-auto cursor-pointer"
        animate={{
          left: layout.mascotLeft,
          top: layout.mascotTop,
          width: layout.mascotSize,
          height: layout.mascotSize,
        }}
        initial={false}
        transition={
          prefersReduced
            ? { duration: 0.18 }
            : { type: "spring", stiffness: 110, damping: 18, mass: 1.1 }
        }
        onClick={(e) => {
          // Don't bubble to the stage tap handler — the reaction IS the
          // response; we don't also want to advance the act.
          e.stopPropagation();
          handleWizardTap();
        }}
        style={{ WebkitTapHighlightColor: "transparent" }}
      >
        {/* Inner wrapper carries the reaction animation so it composes
            with — instead of fighting — the outer position tween. */}
        <motion.div
          style={{ width: "100%", height: "100%" }}
          animate={
            reactionAnim
              ? reactionAnim.transform
              : { rotate: 0, scale: 1, y: 0 }
          }
          transition={
            reactionAnim
              ? { duration: reactionAnim.durationMs / 1000, ease: "easeInOut" }
              : { duration: 0.2 }
          }
        >
          <div
            style={{
              width: MASCOT_BASE_PX,
              height: MASCOT_BASE_PX,
              transform: `scale(${layout.mascotSize / MASCOT_BASE_PX})`,
              transformOrigin: "top left",
            }}
          >
            <WizardCharacter pose={act.pose} />
          </div>
        </motion.div>
      </motion.div>

      {/* Speech bubble — anchored to mascot via `bubbleSide` */}
      <div className="absolute inset-0 z-30 pointer-events-none">
        <AnimatePresence mode="wait">
          <motion.div
            key={act.id}
            className="pointer-events-auto"
            style={layout.bubbleStyle}
            initial={
              prefersReduced
                ? { opacity: 0, x: layout.bubbleX, y: layout.bubbleY }
                : { opacity: 0, scale: 0.85, x: layout.bubbleX, y: layout.bubbleY }
            }
            animate={
              prefersReduced
                ? { opacity: 1, x: layout.bubbleX, y: layout.bubbleY }
                : { opacity: 1, scale: 1, x: layout.bubbleX, y: layout.bubbleY }
            }
            exit={
              prefersReduced
                ? { opacity: 0, x: layout.bubbleX, y: layout.bubbleY }
                : { opacity: 0, scale: 0.85, x: layout.bubbleX, y: layout.bubbleY }
            }
            transition={prefersReduced ? { duration: 0.15 } : { type: "spring", stiffness: 360, damping: 26 }}
          >
            <SpeechBubble
              headline={act.headline}
              body={act.body}
              revealKey={act.id}
              forceComplete={forceComplete}
              onTypingComplete={() => setTypingDone(true)}
              tailSide={act.tailSide}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* "Tap to continue" affordance — fades in once the typewriter
          finishes on a non-final act. The whole stage is already a tap
          target via the swipe surface above; this is just a hint so users
          don't sit waiting for an auto-advance that never comes. */}
      <AnimatePresence>
        {typingDone && !isFinal && (
          <motion.div
            key="tap-hint"
            className="absolute inset-x-0 z-30 flex items-center justify-center pointer-events-none"
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 64px)" }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <motion.span
              className="text-[12px] font-medium tracking-wide text-white/55"
              animate={prefersReduced ? undefined : { opacity: [0.55, 0.95, 0.55] }}
              transition={prefersReduced ? undefined : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            >
              Tap to continue
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Final-act CTA stack — anchored bottom, pinned above safe-area.
          Renders only on the final beat so prior acts feel cinematic,
          not cluttered. */}
      <AnimatePresence>
        {isFinal && (
          <motion.div
            key="cta"
            className="absolute z-40 w-full px-5"
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)" }}
            // Lands at the same beat the wizard hits his celebrate pose
            // — no dead pause = no doubt window before the CTA.
            initial={{ opacity: 0, y: 60, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={prefersReduced ? { duration: 0.18 } : { type: "spring", stiffness: 260, damping: 26 }}
          >
            <div className="mx-auto w-full max-w-[420px] space-y-2.5">
              <button
                type="button"
                onClick={() => { void handleContinueWithApple(); }}
                disabled={appleLoading}
                aria-label={config.appleLabel}
                className={`no-tap-select w-full h-[54px] rounded-2xl bg-white text-black font-bold text-[16px] flex items-center justify-center gap-2 active:scale-[0.97] transition-transform shadow-lg shadow-black/30 ${appleLoading ? "opacity-50" : ""}`}
                style={{ WebkitTapHighlightColor: "transparent" }}
              >
                <AppleLogo className="h-[18px] w-[18px]" />
                {config.appleLabel}
              </button>
              <button
                type="button"
                onClick={handleHaveAccount}
                className="no-tap-select w-full h-[46px] rounded-2xl border border-white/15 text-white/90 font-semibold text-[14px] flex items-center justify-center active:scale-[0.98] transition-transform hover:bg-white/5"
                style={{ WebkitTapHighlightColor: "transparent", background: "rgba(255,255,255,0.04)" }}
              >
                {config.existingAccountLabel}
              </button>
              <p className="text-center text-[11px] text-white/45 pt-1">
                No credit card. No emails. Just Apple.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default WizardIntroCutscene;
