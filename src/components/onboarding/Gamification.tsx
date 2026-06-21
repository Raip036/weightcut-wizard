/**
 * Onboarding gamification primitives, all in one file because they
 * share nothing across consumers and are mounted only on the
 * /onboarding route. Co-locating keeps the import surface in
 * `Onboarding.tsx` to a single line.
 *
 * Mobile perf rules followed throughout:
 *  - Animations run on `transform` + `opacity` only (compositor layers).
 *  - `useReducedMotion` short-circuits motion for accessibility.
 *  - `AnimatePresence` cleans up nodes so we never accumulate.
 *  - One-shot timers always have a stable cleanup so React Strict-mode
 *    + step-back navigation doesn't fire twice.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react";
import { Sparkles, Trophy, ShieldCheck, Lock, Share2 } from "lucide-react";
import { triggerHaptic, triggerHapticSelection } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";

// ─────────────────────────────────────────────────────────────────────
// XPProgressBar: header-mounted "fight camp XP" bar.
//
// Each step earns the user a chunk of XP. We pulse a subtle gold
// shimmer when the bar increments. The XP number is decorative; the
// authoritative step counter still lives in the parent.
// ─────────────────────────────────────────────────────────────────────
export function XPProgressBar({
  step,
  totalSteps,
  xpPerStep = 80,
  finaleXp = 1000,
}: {
  step: number;
  totalSteps: number;
  xpPerStep?: number;
  finaleXp?: number;
}) {
  const reduced = useReducedMotion();
  const targetXp = Math.min(finaleXp, step * xpPerStep);
  const pct = Math.max(0, Math.min(1, targetXp / finaleXp));

  return (
    <div className="px-5 pt-3">
      <div className="flex items-baseline justify-between mb-1.5">
        <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70 font-bold">
          Fight Camp XP
        </p>
        <motion.p
          key={targetXp}
          initial={{ scale: reduced ? 1 : 0.92, opacity: 0.7 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 360, damping: 22 }}
          className="text-[12px] font-bold tabular-nums text-primary"
        >
          {targetXp} <span className="text-muted-foreground/60 font-medium">/ {finaleXp}</span>
        </motion.p>
      </div>
      <div className="relative h-2 rounded-full overflow-hidden bg-muted/40">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary via-primary to-func-warning-yellow"
          initial={false}
          animate={{ width: `${pct * 100}%` }}
          transition={{
            type: "spring",
            stiffness: 220,
            damping: 30,
            mass: 0.8,
          }}
          style={{ willChange: "width" }}
        />
        {/* Shimmer head, only on motion-OK clients. Sits at the bar tip. */}
        {!reduced && pct > 0 && (
          <motion.span
            key={`shimmer-${step}`}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="absolute top-0 bottom-0 w-3 rounded-full bg-white/70"
            style={{ left: `calc(${pct * 100}% - 12px)` }}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CuttingNowChip: social-proof chip. The number is deterministic from
// the current hour so it never lies (no backend), but rotates so a
// returning user sees a different value on every session.
// ─────────────────────────────────────────────────────────────────────
export function CuttingNowChip({
  achievementLabel,
}: {
  /** When set, renders a same-sized achievement pill INLINE next to the
   *  social-proof chip (so "Goal Locked" sits beside "X fighters cutting
   *  weight right now" instead of floating above the screen). */
  achievementLabel?: string | null;
} = {}) {
  // 1-100 range, randomised per user (per session). Picked once on
  // first mount and cached in localStorage so a returning user keeps
  // their number; feels less like a slot machine that way. Stays in
  // the believable range for a niche fight-camp app.
  const count = useMemo(() => {
    try {
      const stored = localStorage.getItem("wcw_cutting_now_count");
      if (stored) {
        const n = parseInt(stored, 10);
        if (Number.isFinite(n) && n >= 1 && n <= 100) return n;
      }
      const fresh = 1 + Math.floor(Math.random() * 100);
      try { localStorage.setItem("wcw_cutting_now_count", String(fresh)); } catch { /* ignore */ }
      return fresh;
    } catch {
      return 1 + Math.floor(Math.random() * 100);
    }
  }, []);
  return (
    <div className="mx-5 mt-2 flex items-center gap-1.5 flex-wrap">
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-func-recovery-green/10 border border-func-recovery-green/25">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inset-0 rounded-full bg-func-recovery-green animate-ping opacity-60" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-func-recovery-green" />
        </span>
        <p className="text-[10px] font-semibold text-func-recovery-green/90 tabular-nums">
          {count.toLocaleString()} fighters cutting weight right now
        </p>
      </div>
      {/* Inline achievement pill, same dimensions / type-scale as the
          social-proof chip so they read as a paired row rather than two
          competing surfaces. AnimatePresence handles the in/out fade. */}
      <AnimatePresence>
        {achievementLabel && (
          <motion.div
            key={achievementLabel}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ type: "spring", stiffness: 380, damping: 24 }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/15 border border-primary/35"
          >
            <Trophy className="h-2.5 w-2.5 text-primary" strokeWidth={2.6} />
            <p className="text-[10px] font-semibold text-primary uppercase tracking-[0.06em]">
              {achievementLabel}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// OnboardingMascot: small coach silhouette pinned in the corner that
// bounces in response to step submits. The bounce is keyed to a
// `bumpCount` prop the parent increments on every Continue.
// ─────────────────────────────────────────────────────────────────────
export function OnboardingMascot({ bumpCount }: { bumpCount: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      key={`mascot-${bumpCount}`}
      initial={false}
      animate={
        reduced
          ? { y: 0 }
          : { y: [0, -12, 0] }
      }
      transition={{
        duration: 0.55,
        ease: [0.32, 0.72, 0, 1],
      }}
      aria-hidden
      className="pointer-events-none absolute right-4 top-2 h-9 w-9 rounded-full bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center"
      style={{ willChange: "transform" }}
    >
      <Sparkles className="h-4 w-4 text-primary" strokeWidth={2.4} />
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// DaysToFightSlam: fires once when the user first picks a target
// date. Drops a giant number with a thud and fades away.
// ─────────────────────────────────────────────────────────────────────
export function DaysToFightSlam({
  days,
  armed = false,
  onDismiss,
}: {
  days: number | null;
  /** True while the user is on the screen that owns this data. Slam
   *  fires on the rising edge of (armed && data-valid), so leaving and
   *  re-entering the owner step naturally re-arms it. */
  armed?: boolean;
  onDismiss?: () => void;
}) {
  const reduced = useReducedMotion();
  const [showing, setShowing] = useState(false);
  // Tracks the previous "should we show" boolean so we only fire on the
  // false → true transition. Without this, the slam re-fires every
  // render when both armed and data-valid are stable.
  const wasReadyRef = useRef(false);

  useEffect(() => {
    const valid = days != null && days > 0;
    const ready = armed && valid;
    if (ready && !wasReadyRef.current) {
      wasReadyRef.current = true;
      // Dismiss any open native picker (iOS date wheel, web inline
      // calendar) so it can't bleed through under the slam; some
      // platforms render the picker above the WebView, so raising the
      // slam's z-index alone wouldn't be enough.
      try {
        (document.activeElement as HTMLElement | null)?.blur?.();
      } catch { /* noop */ }
      setShowing(true);
      triggerHaptic(ImpactStyle.Heavy);
      const t = setTimeout(() => {
        setShowing(false);
        onDismiss?.();
      }, 4200);
      return () => clearTimeout(t);
    }
    if (!ready) {
      wasReadyRef.current = false;
    }
  }, [armed, days, onDismiss]);

  const dismissEarly = () => {
    setShowing(false);
    onDismiss?.();
  };

  return (
    <AnimatePresence>
      {showing && days != null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          // Pointer events on so tap-to-dismiss works for users who've
          // read the number and want to move on before the auto-fade.
          className="fixed inset-0 z-[10003] bg-background/85 backdrop-blur-md flex flex-col items-center justify-center px-6"
          onClick={dismissEarly}
        >
          <motion.div
            initial={{ scale: reduced ? 1 : 1.6, y: reduced ? 0 : -40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 18, mass: 0.7 }}
            className="text-center"
            style={{ willChange: "transform, opacity" }}
          >
            <p className="text-[180px] font-black leading-none text-primary tabular-nums tracking-tight">
              {days}
            </p>
            <p className="text-[16px] font-bold uppercase tracking-[0.18em] text-foreground mt-2">
              {days === 1 ? "morning" : "mornings"} you own
            </p>
            <p className="text-[12px] text-muted-foreground mt-2">
              That's how long until your fight.
            </p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60 mt-6">
              Tap to continue
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────
// WeightLossSlam: fires once when the user first enters a valid
// current weight (with a goal + timeframe already on file). Slams a
// single hero number ("8.5 KG") plus the weeks + per-week rate. Same
// visual language as `DaysToFightSlam` so the two reads consistently
// across onboarding.
// ─────────────────────────────────────────────────────────────────────
export function WeightLossSlam({
  totalKg,
  weeks,
  perWeekKg,
  armed = false,
  onDismiss,
}: {
  totalKg: number | null;
  weeks: number | null;
  perWeekKg: number | null;
  /** True while the user is on the screen that owns this data. */
  armed?: boolean;
  onDismiss?: () => void;
}) {
  const reduced = useReducedMotion();
  const [showing, setShowing] = useState(false);
  const wasReadyRef = useRef(false);

  useEffect(() => {
    const valid =
      totalKg != null &&
      totalKg > 0 &&
      weeks != null &&
      weeks > 0 &&
      perWeekKg != null &&
      perWeekKg > 0;
    const ready = armed && valid;
    if (ready && !wasReadyRef.current) {
      wasReadyRef.current = true;
      try {
        (document.activeElement as HTMLElement | null)?.blur?.();
      } catch { /* noop */ }
      setShowing(true);
      triggerHaptic(ImpactStyle.Heavy);
      const t = setTimeout(() => {
        setShowing(false);
        onDismiss?.();
      }, 4200);
      return () => clearTimeout(t);
    }
    if (!ready) {
      wasReadyRef.current = false;
    }
  }, [armed, totalKg, weeks, perWeekKg, onDismiss]);

  const dismissEarly = () => {
    setShowing(false);
    onDismiss?.();
  };

  if (totalKg == null || weeks == null || perWeekKg == null) return null;

  // Color the per-week rate by safety band so the user instantly knows
  // whether the cut they just locked is sustainable. Same thresholds
  // the rest of the app uses.
  const rateClass =
    perWeekKg <= 1.0
      ? "text-func-recovery-green"
      : perWeekKg <= 1.5
      ? "text-func-warning-yellow"
      : "text-func-danger-red";

  return (
    <AnimatePresence>
      {showing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="fixed inset-0 z-[10003] bg-background/85 backdrop-blur-md flex flex-col items-center justify-center px-6"
          onClick={dismissEarly}
        >
          <motion.div
            initial={{ scale: reduced ? 1 : 1.6, y: reduced ? 0 : -40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 18, mass: 0.7 }}
            className="text-center"
            style={{ willChange: "transform, opacity" }}
          >
            <p className="text-[140px] font-black leading-none text-primary tabular-nums tracking-tight">
              {totalKg.toFixed(1)}
              <span className="text-[42px] align-top ml-2 font-black tracking-tight">kg</span>
            </p>
            <p className="text-[16px] font-bold uppercase tracking-[0.18em] text-foreground mt-2">
              to drop
            </p>
            <p className="text-[13px] text-muted-foreground mt-3">
              over <span className="text-foreground font-semibold tabular-nums">{weeks}</span>{" "}
              {weeks === 1 ? "week" : "weeks"}
            </p>
            <p className={`text-[15px] font-bold tabular-nums mt-1 ${rateClass}`}>
              ≈ {perWeekKg.toFixed(2)} kg / week
            </p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60 mt-6">
              Tap to continue
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────
// LossFrameCard: appears under the goal weight step. Shows what
// happens if the user delays. Loss-aversion framing.
// ─────────────────────────────────────────────────────────────────────
export function LossFrameCard({
  baseWeeklyKg,
  remainingKgPerWeekIfSkipped,
}: {
  baseWeeklyKg: number;
  remainingKgPerWeekIfSkipped: number;
}) {
  const safeRate = baseWeeklyKg <= 1.0;
  const skippedRate = remainingKgPerWeekIfSkipped;
  const dangerous = skippedRate > 1.5;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: "easeOut" }}
      className="rounded-xs border border-func-warning-yellow/25 bg-func-warning-yellow/[0.06] p-3"
    >
      <p className="text-[10px] uppercase tracking-wider font-semibold text-func-warning-yellow/90 mb-1">
        Reality check
      </p>
      <p className="text-[13px] text-foreground/90 leading-snug">
        Skip a week and the cut becomes{" "}
        <span className="font-semibold tabular-nums">
          {skippedRate.toFixed(1)} kg/week
        </span>
        {dangerous ? ", that's beyond safe limits." : safeRate ? ", still doable." : ", pushing the limit."}
      </p>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SilentAchievement: small toast-style popup that slides in from the
// top, shows a badge label, then exits. Fires on milestone steps.
// ─────────────────────────────────────────────────────────────────────
export function SilentAchievement({
  label,
  open,
  onClose,
}: {
  label: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    triggerHaptic(ImpactStyle.Medium);
    const t = setTimeout(onClose, 1700);
    return () => clearTimeout(t);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && label && (
        <motion.div
          initial={{ y: reduced ? 0 : -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: reduced ? 0 : -40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
          className="fixed top-[calc(env(safe-area-inset-top,0px)+72px)] left-1/2 -translate-x-1/2 z-[10006] pointer-events-none"
          style={{ willChange: "transform, opacity" }}
        >
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-primary text-primary-foreground">
            <Trophy className="h-3.5 w-3.5" strokeWidth={2.4} />
            <p className="text-[12px] font-bold uppercase tracking-[0.12em]">
              {label}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────
// DeclarationButton: hold-to-lock commit. The user holds the button
// for ~1.5s; a fill arc sweeps under their thumb and a haptic ramp
// fires (light → medium → success). Releasing early aborts.
// ─────────────────────────────────────────────────────────────────────
export function DeclarationButton({
  label,
  onCommit,
  holdMs = 1500,
}: {
  label: string;
  onCommit: () => void;
  holdMs?: number;
}) {
  const reduced = useReducedMotion();
  // Smoothness model:
  //  - The fill arc's width is animated by writing directly to the
  //    DOM node's `transform: scaleX()` from inside `requestAnimation
  //    Frame`. NO React re-render per tick; the previous version
  //    setState'd `progress` 60×/s which forced a full button reflow
  //    each frame and fought the CSS `transition: width` simultaneously.
  //  - `transform: scaleX` lives on the GPU compositor (vs `width`
  //    which forces layout). transform-origin: left so the bar
  //    grows from the left edge.
  //  - One React state flag for "committed" so we can swap label
  //    text once at the end. That's the only render the button does
  //    during a hold.
  const fillRef = useRef<HTMLDivElement | null>(null);
  const [committed, setCommitted] = useState(false);
  const startedAt = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);
  const committedRef = useRef(false);
  const haptic33Fired = useRef(false);
  const haptic66Fired = useRef(false);

  const writeFill = (p: number) => {
    const el = fillRef.current;
    if (!el) return;
    el.style.transform = `scaleX(${p})`;
  };

  const tick = (ts: number) => {
    if (startedAt.current == null) startedAt.current = ts;
    const elapsed = ts - startedAt.current;
    const p = Math.min(1, elapsed / holdMs);
    writeFill(p);
    // Haptic ramp at 33% / 66%, feels like the lock is engaging.
    if (!haptic33Fired.current && p >= 0.33) {
      haptic33Fired.current = true;
      triggerHapticSelection();
    }
    if (!haptic66Fired.current && p >= 0.66) {
      haptic66Fired.current = true;
      triggerHaptic(ImpactStyle.Light);
    }
    if (p >= 1 && !committedRef.current) {
      committedRef.current = true;
      triggerHaptic(ImpactStyle.Heavy);
      setCommitted(true);
      onCommit();
      return;
    }
    rafId.current = requestAnimationFrame(tick);
  };

  const begin = () => {
    if (committedRef.current) return;
    if (reduced) {
      // Skip the hold animation entirely for accessibility users:
      // commit immediately on press.
      committedRef.current = true;
      writeFill(1);
      triggerHaptic(ImpactStyle.Heavy);
      setCommitted(true);
      onCommit();
      return;
    }
    startedAt.current = null;
    haptic33Fired.current = false;
    haptic66Fired.current = false;
    rafId.current = requestAnimationFrame(tick);
  };
  const end = () => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = null;
    if (!committedRef.current) {
      startedAt.current = null;
      haptic33Fired.current = false;
      haptic66Fired.current = false;
      // Smooth retreat: let the browser ease the cancelled fill back
      // to 0 with a short CSS transition, then strip the transition so
      // the next press starts crisp via rAF again.
      const el = fillRef.current;
      if (el) {
        el.style.transition = "transform 220ms cubic-bezier(0.32, 0.72, 0, 1)";
        el.style.transform = "scaleX(0)";
        const handle = window.setTimeout(() => {
          if (fillRef.current) fillRef.current.style.transition = "none";
        }, 240);
        // No state cleanup needed; committedRef is the source of truth
        // and the timeout is fire-and-forget.
        void handle;
      }
    }
  };

  useEffect(() => {
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  return (
    <button
      type="button"
      onPointerDown={begin}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
      className="no-tap-select relative w-full h-14 rounded-xs bg-primary text-primary-foreground text-[15px] font-bold tracking-wide active:scale-[0.99] transition-transform overflow-hidden"
      style={{
        touchAction: "none",
        // `isolation: isolate` forces a fresh stacking context on this button
        // so the GPU-composited fill child below (transform + mixBlendMode)
        // cannot escape the rounded-xs clip on iOS WebView. Without it the
        // amber fill bleeds past the corners during the hold animation.
        isolation: "isolate",
      }}
    >
      {/* Fill arc: `transform: scaleX` driven by rAF so the animation
          lives on the compositor and never blocks the main thread.
          `rounded-xs` mirrors the parent radius as belt-and-braces: even
          if the parent's overflow clip glitches under iOS's GPU paint, the
          fill's own corners stay rounded so nothing visibly overflows. */}
      <div
        ref={fillRef}
        aria-hidden
        className="absolute inset-y-0 left-0 right-0 bg-func-warning-yellow rounded-xs"
        style={{
          transform: "scaleX(0)",
          transformOrigin: "left center",
          transition: "none",
          willChange: "transform",
          mixBlendMode: "overlay",
          backfaceVisibility: "hidden",
        }}
      />
      <span className="relative flex items-center justify-center gap-2">
        <Lock className="h-4 w-4" strokeWidth={2.4} />
        {committed ? "Locked in" : label}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TaleOfTheTapeCard: finale "fighter intro" reveal. Stat rows flip
// in one by one with a small staggered spring. Screenshot-bait.
// ─────────────────────────────────────────────────────────────────────
export interface TaleStat {
  label: string;
  value: string;
}

// House blue used for the card's eyebrow + ambient glow.
const TALE_BLUE = "217 91% 58%";
const taleHsl = (a = 1) => `hsl(${TALE_BLUE} / ${a})`;
const taleRowSpring = { type: "spring" as const, stiffness: 320, damping: 26 };
const taleRowDelay = (i: number) => 0.15 + i * 0.06;

/** Circular share button, pinned to a corner the title layout reserves (via
 *  `pr-11`) so it can never overlap copy. */
function TaleShareButton({ onShare }: { onShare: () => void }) {
  return (
    <button
      type="button"
      onClick={onShare}
      aria-label="Share your camp card"
      className="absolute top-3.5 right-3.5 z-10 h-9 w-9 flex items-center justify-center rounded-full bg-muted/40 border border-border/40 active:scale-90 transition-transform"
    >
      <Share2 className="h-4 w-4 text-foreground/80" />
    </button>
  );
}

export function TaleOfTheTapeCard({
  stats,
  onShare,
}: {
  stats: TaleStat[];
  /** Optional share-card affordance, rendered as a small icon button
   *  in the top-right of the card. Tap fires the parent's share flow. */
  onShare?: () => void;
}) {
  const reduced = useReducedMotion();
  const firedRef = useRef(false);

  // Stamp-in haptic sequence: fire one Light haptic per stat row as it
  // springs in (aligned to the row stagger), then a Heavy haptic on the
  // final row to "seal" the card. Only fires once per mount; navigation
  // back + forward will replay it.
  useEffect(() => {
    if (reduced || firedRef.current) return;
    firedRef.current = true;
    const timers: number[] = [];
    stats.forEach((_, i) => {
      const isLast = i === stats.length - 1;
      const t = window.setTimeout(() => {
        triggerHaptic(isLast ? ImpactStyle.Heavy : ImpactStyle.Light);
      }, taleRowDelay(i) * 1000 + 80);
      timers.push(t);
    });
    return () => { timers.forEach(window.clearTimeout); };
  }, [reduced, stats]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: reduced ? 1 : 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 22 }}
      style={{ willChange: "transform, opacity" }}
      className="relative overflow-hidden rounded-2xl card-surface border border-primary/20 p-5"
    >
      {/* Ambient blue glow - top-anchored blob behind everything. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(120% 80% at 50% 0%, ${taleHsl(0.1)}, transparent 55%)` }}
      />

      {onShare && <TaleShareButton onShare={onShare} />}

      <div className="relative">
        {/* Title block. Eyebrow kicker is small + tracked so it stays well
            clear of the share button; the big word "TAPE" sits on its own
            line below, with right padding reserving the share corner. */}
        <div className="pr-11">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.28em] leading-none"
            style={{ color: taleHsl() }}
          >
            Tale of the
          </p>
          <h3 className="mt-1 text-[34px] font-black uppercase tracking-[0.04em] leading-[0.85] text-foreground">
            Tape
          </h3>
        </div>

        {/* Framed readout - thin dividers, label left (muted, tracked),
            value right (bold, tabular, larger). */}
        <div className="mt-4 rounded-xl border border-border/40 bg-background/30 divide-y divide-border/30">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, x: reduced ? 0 : -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...taleRowSpring, delay: taleRowDelay(i) }}
              className="flex items-center justify-between px-4 py-2.5"
            >
              <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                {s.label}
              </span>
              <span className="text-[17px] font-bold tabular-nums text-foreground">
                {s.value}
              </span>
            </motion.div>
          ))}
        </div>

        {/* Wax-seal chip - glowing shield with a slow pulse halo. */}
        <div className="mt-5 flex justify-center">
          <motion.div
            initial={{ opacity: 0, scale: reduced ? 1 : 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...taleRowSpring, delay: taleRowDelay(stats.length) }}
            className="relative inline-flex items-center gap-2 rounded-full border border-func-recovery-green/30 bg-func-recovery-green/10 px-4 py-2"
          >
            {/* Pulse halo behind the chip (transform/opacity only). */}
            {!reduced && (
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{ boxShadow: "0 0 18px rgb(var(--func-recovery-green) / 0.5)" }}
                initial={{ opacity: 0.25, scale: 0.96 }}
                animate={{ opacity: [0.25, 0.55, 0.25], scale: [0.96, 1.04, 0.96] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
            <ShieldCheck className="relative h-4 w-4 text-func-recovery-green" />
            <span className="relative text-[12px] font-black uppercase tracking-[0.16em] text-func-recovery-green">
              Camp Sealed
            </span>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sport-aware vocabulary helper: one place to translate generic UX
// copy into sport-specific language so identity priming is consistent
// across every step from sport-pick onwards.
// ─────────────────────────────────────────────────────────────────────
export function sportVocab(athleteType: string): {
  campNoun: string;
  finaleVerb: string;
} {
  const t = (athleteType || "").toLowerCase();
  if (t.includes("box")) return { campNoun: "Fight week", finaleVerb: "Step in" };
  if (t.includes("bjj") || t.includes("jiu") || t.includes("grapp"))
    return { campNoun: "Comp prep", finaleVerb: "Roll" };
  if (t.includes("muay") || t.includes("kick"))
    return { campNoun: "Camp", finaleVerb: "Throw down" };
  if (t.includes("wrest")) return { campNoun: "Tournament prep", finaleVerb: "Take to the mat" };
  return { campNoun: "Camp", finaleVerb: "Compete" };
}

// ─────────────────────────────────────────────────────────────────────
// MathWhisper: small caption that does live arithmetic on the values
// the user just entered. Shown directly under the input so the
// feedback loop is intimate.
// ─────────────────────────────────────────────────────────────────────
export function MathWhisper({ children }: { children: React.ReactNode }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="text-[12px] text-muted-foreground/85 mt-1.5 leading-snug"
    >
      {children}
    </motion.p>
  );
}

// ─────────────────────────────────────────────────────────────────────
// WittyValidation: small green validation line under an input that
// echoes the user's choice with a coaching micro-comment. Reads as
// "an experienced coach who actually looked at your number."
// ─────────────────────────────────────────────────────────────────────
export function WittyValidation({ children }: { children: React.ReactNode }) {
  return (
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.32 }}
      className="text-[12px] text-func-recovery-green/90 mt-1.5 font-medium leading-snug"
    >
      {children}
    </motion.p>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CutJourneyChart: the finale weight-journey projection. ONE chart that
// merges the steady cut and the dehydration leg:
//
//   current ──steady blue line w/ weekly dots──▶ cut-end ──red drop──▶ fight
//
// Shows the weekly dots + the plateau region (weeks 3-4, only for cuts
// ≥5 weeks) and adapts to plan length: long plans keep the dots small +
// unlabeled; short plans drop the plateau and give the fixed ~7-day water
// cut a larger share of the x-axis. When there's no water cut (fight ≈
// cut-end, e.g. the weight-loss flow) the red leg is omitted and the axis
// ends "Goal". Linear interpolation, directional only — not clinical.
// Perf: animates only pathLength/opacity, gated behind useReducedMotion.
// ─────────────────────────────────────────────────────────────────────
const CJ_RED = "rgb(239 68 68)";

export interface CutJourneyChartProps {
  /** Weight today (kg). */
  currentKg: number;
  /** Pre-dehydration "steady cut" target reached at the end of the cut weeks. */
  cutEndKg: number;
  /** Final weigh-in weight after the water cut (kg). For no-dehydration flows
   *  pass the same value as cutEndKg. */
  fightKg: number;
  /** Number of steady-cut weeks before fight week. */
  cutWeeks: number;
  /** Length of the water-cut, in days (defaults to 7). */
  dehydrationDays?: number;
}

export function CutJourneyChart({
  currentKg,
  cutEndKg,
  fightKg,
  cutWeeks,
  dehydrationDays = 7,
}: CutJourneyChartProps) {
  const reduced = useReducedMotion();

  const model = useMemo(() => {
    if (!(currentKg > 0) || !(cutWeeks > 0)) return null;
    const safeCutEnd = Math.min(cutEndKg, currentKg);
    const safeFight = Math.min(fightKg, safeCutEnd);
    const hasDehyd = safeCutEnd - safeFight > 0.05;
    const cutDays = cutWeeks * 7;
    const dehyd = hasDehyd ? Math.max(1, dehydrationDays) : 0;
    const totalDays = cutDays + dehyd;
    const showPlateau = cutWeeks >= 5;
    return {
      safeCutEnd,
      safeFight,
      hasDehyd,
      cutDays,
      dehyd,
      totalDays,
      showPlateau,
      steadyDrop: currentKg - safeCutEnd,
      dehydDrop: safeCutEnd - safeFight,
    };
  }, [currentKg, cutEndKg, fightKg, cutWeeks, dehydrationDays]);

  if (!model) return null;
  const { safeCutEnd, safeFight, hasDehyd, cutDays, totalDays, showPlateau } = model;

  // ── Geometry ──
  const W = 320, H = 192;
  const padL = 16, padR = 16, padT = 36, padB = 36;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const minW = safeFight, maxW = currentKg;
  const range = Math.max(0.5, maxW - minW);
  // Breathing room so dots/labels don't clip the plot edges.
  const yPad = innerH * 0.12;
  const xFor = (day: number) => padL + (day / totalDays) * innerW;
  const yFor = (w: number) =>
    padT + yPad + (1 - (w - minW) / range) * (innerH - yPad * 2);

  const x0 = xFor(0), y0 = yFor(currentKg);
  const xCut = xFor(cutDays), yCut = yFor(safeCutEnd);
  const xEnd = xFor(totalDays), yEnd = yFor(safeFight);

  // Weekly dots along the steady leg (linear interpolation, directional only -
  // not a clinical prediction). The last one coincides with the cut-end dot, so
  // we render weeks 1..n-1 here and the emphasized cut-end dot separately.
  const weekDots = Array.from({ length: Math.max(0, cutWeeks - 1) }, (_, i) => {
    const w = i + 1;
    const day = w * 7;
    const kg = currentKg - (model.steadyDrop * day) / cutDays;
    return { w, x: xFor(day), y: yFor(kg) };
  });

  // Plateau band = weeks 3-4 → days 14-28, clamped into the cut region.
  const platX1 = xFor(14);
  const platX2 = xFor(Math.min(28, cutDays));

  const steadyLine = `M ${x0} ${y0} L ${xCut} ${yCut}`;
  const steadyArea = `M ${x0} ${H - padB} L ${x0} ${y0} L ${xCut} ${yCut} L ${xCut} ${H - padB} Z`;
  const dehydLine = `M ${xCut} ${yCut} L ${xEnd} ${yEnd}`;
  const dehydArea = `M ${xCut} ${H - padB} L ${xCut} ${yCut} L ${xEnd} ${yEnd} L ${xEnd} ${H - padB} Z`;

  const draw = (delay = 0) =>
    reduced
      ? { initial: false as const, animate: { pathLength: 1, opacity: 1 } }
      : {
          initial: { pathLength: 0, opacity: 0.6 },
          animate: { pathLength: 1, opacity: 1 },
          transition: { duration: 0.9, ease: "easeInOut" as const, delay },
        };

  const dotIn = (delay: number) =>
    reduced
      ? { initial: false as const, animate: { opacity: 1, scale: 1 } }
      : {
          initial: { opacity: 0, scale: 0 },
          animate: { opacity: 1, scale: 1 },
          transition: { delay, type: "spring" as const, stiffness: 380, damping: 22 },
        };

  return (
    <div className="relative card-surface rounded-2xl border border-primary/20 overflow-hidden p-4">
      {/* Inline blue ambient glow. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(120% 80% at 80% 0%, hsl(217 91% 58% / 0.08), transparent 55%)" }}
      />
      <div className="relative">
        {/* Header */}
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-[10px] uppercase tracking-[0.15em] font-bold text-muted-foreground">
            Projected Path
          </p>
          <p className="text-[10px] uppercase tracking-[0.15em] font-bold text-primary/70 tabular-nums">
            {cutWeeks}w{hasDehyd ? " + cut" : ""}
          </p>
        </div>

        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: "visible" }} aria-label="Projected weight journey">
          <defs>
            <linearGradient id="cjBlue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.22" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="cjRed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CJ_RED} stopOpacity="0.22" />
              <stop offset="100%" stopColor={CJ_RED} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Baseline */}
          <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />

          {/* Plateau region - a faint dashed vertical band (weeks 3-4), never a
              pill/toggle. Drawn behind the line. */}
          {showPlateau && (
            <g>
              <rect
                x={platX1}
                y={padT}
                width={Math.max(0, platX2 - platX1)}
                height={H - padB - padT}
                fill="rgb(var(--func-warning-yellow) / 0.07)"
                stroke="rgb(var(--func-warning-yellow) / 0.30)"
                strokeWidth="1"
                strokeDasharray="3 3"
                rx="3"
              />
              <text
                x={(platX1 + platX2) / 2}
                y={padT - 6}
                fontSize="8"
                fontWeight="700"
                letterSpacing="0.6"
                textAnchor="middle"
                fill="rgb(var(--func-warning-yellow))"
                opacity="0.85"
              >
                PLATEAU
              </text>
            </g>
          )}

          {/* Areas */}
          <motion.path d={steadyArea} fill="url(#cjBlue)" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.2 }} />
          {hasDehyd && (
            <motion.path d={dehydArea} fill="url(#cjRed)" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.7 }} />
          )}

          {/* Lines */}
          <motion.path d={steadyLine} fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" {...draw(0)} />
          {hasDehyd && (
            <motion.path d={dehydLine} fill="none" stroke={CJ_RED} strokeWidth="2.5" strokeLinecap="round" {...draw(0.75)} />
          )}

          {/* Weekly dots along the steady leg */}
          {weekDots.map((d, i) => (
            <motion.circle
              key={d.w}
              cx={d.x}
              cy={d.y}
              r="2.6"
              fill="hsl(var(--primary))"
              stroke="hsl(var(--background))"
              strokeWidth="1.2"
              style={{ transformOrigin: `${d.x}px ${d.y}px` }}
              {...dotIn(0.25 + i * (0.5 / Math.max(1, weekDots.length)))}
            />
          ))}

          {/* Anchor dots: start, cut-end (emphasized), fight (red w/ halo) */}
          <motion.circle cx={x0} cy={y0} r="4" fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth="1.5" style={{ transformOrigin: `${x0}px ${y0}px` }} {...dotIn(0.2)} />
          <motion.circle cx={xCut} cy={yCut} r="4" fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth="1.5" style={{ transformOrigin: `${xCut}px ${yCut}px` }} {...dotIn(0.75)} />
          {hasDehyd && (
            <>
              <motion.circle cx={xEnd} cy={yEnd} r="8" fill={CJ_RED} opacity="0.18" style={{ transformOrigin: `${xEnd}px ${yEnd}px` }} {...dotIn(1.5)} />
              <motion.circle cx={xEnd} cy={yEnd} r="4.5" fill={CJ_RED} stroke="hsl(var(--background))" strokeWidth="1.5" style={{ transformOrigin: `${xEnd}px ${yEnd}px` }} {...dotIn(1.55)} />
            </>
          )}

          {/* Value labels */}
          <text x={x0} y={y0 - 11} fontSize="10" fontWeight="700" textAnchor="start" fill="hsl(var(--foreground))">{currentKg.toFixed(1)}</text>
          <text x={xCut} y={yCut - 11} fontSize="10" fontWeight="600" textAnchor="middle" fill="hsl(var(--foreground))">{safeCutEnd.toFixed(1)}</text>
          {hasDehyd && (
            <text x={xEnd} y={yEnd + 16} fontSize="10" fontWeight="700" textAnchor="end" fill={CJ_RED}>{safeFight.toFixed(1)}</text>
          )}

          {/* X-axis labels. The "Cut end" word is dropped when the dehydration
              leg is too narrow to fit it without colliding with "Fight" (long
              cuts) - the cut-end value label above the dot still identifies it. */}
          <text x={x0} y={H - 10} fontSize="9" textAnchor="start" fill="hsl(var(--muted-foreground))">Now</text>
          {hasDehyd && xEnd - xCut >= 50 && <text x={xCut} y={H - 10} fontSize="9" textAnchor="middle" fill="hsl(var(--muted-foreground))">Cut end</text>}
          <text x={xEnd} y={H - 10} fontSize="9" textAnchor="end" fill={hasDehyd ? CJ_RED : "hsl(var(--muted-foreground))"}>{hasDehyd ? "Fight" : "Goal"}</text>
        </svg>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" />Steady cut</span>
          {hasDehyd && (
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: CJ_RED }} />Dehydration</span>
          )}
        </div>

        {/* Caption */}
        <p className="text-[11px] text-muted-foreground text-center leading-snug px-1 pt-2">
          Steady cut to <strong className="text-foreground tabular-nums">{safeCutEnd.toFixed(1)} kg</strong> over {cutWeeks} {cutWeeks === 1 ? "week" : "weeks"}
          {hasDehyd ? (
            <>, then <strong style={{ color: CJ_RED }} className="tabular-nums">{(safeCutEnd - safeFight).toFixed(1)} kg</strong> water cut on fight day.</>
          ) : "."}
        </p>
        {showPlateau && (
          <p className="text-[10px] text-func-warning-yellow/80 text-center mt-1">
            Plateau zone weeks 3-4. Normal. Trust the protocol.
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// BlurredWeekOnePreview: fake "Day 1" plan card behind a blur scrim.
// Brains can't leave blurred content unrevealed; the user is motivated
// to tap "Generate My Plan" to see the real numbers. Macros are derived
// from a Mifflin-St Jeor BMR estimate × activity factor × deficit so
// the visible-but-blurry numbers are realistic, not pulled from air.
// ─────────────────────────────────────────────────────────────────────
function dayOneCalorieEstimate({
  sex,
  age,
  heightCm,
  currentKg,
  trainingFrequency,
  aggressiveness,
}: {
  sex?: string;
  age?: number;
  heightCm?: number;
  currentKg?: number;
  trainingFrequency?: number;
  aggressiveness?: string;
}): { cal: number; proteinG: number; fatG: number } {
  // Sensible fallbacks so we never render "NaN cal".
  const w = currentKg && currentKg > 0 ? currentKg : 75;
  const h = heightCm && heightCm > 0 ? heightCm : 178;
  const a = age && age > 0 ? age : 28;
  // Mifflin-St Jeor
  const bmr =
    (sex || "").toLowerCase().startsWith("f")
      ? 10 * w + 6.25 * h - 5 * a - 161
      : 10 * w + 6.25 * h - 5 * a + 5;
  // Activity factor from training frequency (sessions/week)
  const tf = trainingFrequency && trainingFrequency > 0 ? trainingFrequency : 4;
  const activity =
    tf <= 2 ? 1.375 : tf <= 4 ? 1.55 : tf <= 6 ? 1.725 : 1.9;
  const tdee = bmr * activity;
  // Deficit scaled by aggressiveness
  const deficitPct =
    aggressiveness === "aggressive"
      ? 0.22
      : aggressiveness === "moderate"
        ? 0.15
        : 0.10; // safe / balanced
  const cal = Math.max(1400, Math.round((tdee * (1 - deficitPct)) / 10) * 10);
  // 1.8 g/kg protein floor, 0.9 g/kg fat
  const proteinG = Math.round(w * 1.8);
  const fatG = Math.round(w * 0.9);
  return { cal, proteinG, fatG };
}

export function BlurredWeekOnePreview({
  sex,
  age,
  heightCm,
  currentKg,
  trainingFrequency,
  aggressiveness,
}: {
  sex?: string;
  age?: number;
  heightCm?: number;
  currentKg?: number;
  trainingFrequency?: number;
  aggressiveness?: string;
}) {
  const reduced = useReducedMotion();
  const { cal, proteinG, fatG } = useMemo(
    () =>
      dayOneCalorieEstimate({
        sex,
        age,
        heightCm,
        currentKg,
        trainingFrequency,
        aggressiveness,
      }),
    [sex, age, heightCm, currentKg, trainingFrequency, aggressiveness],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: reduced ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.35 }}
      className="relative rounded-xs overflow-hidden border border-border/40 bg-card"
    >
      {/* The blurred "card" content: readable enough to tease, blurred
          enough that the user knows it's locked until they generate. */}
      <div
        className="px-4 py-3.5 select-none"
        style={{
          filter: "blur(5px)",
          // Slight 3D nudge so the scrim+lock pop off the card visually.
          transform: "scale(1.02)",
        }}
        aria-hidden
      >
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-[10px] uppercase tracking-[0.15em] font-bold text-muted-foreground">
            Day 1 · Mon
          </p>
          <p className="text-[10px] uppercase tracking-wider text-primary/70 font-bold">
            Sample
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div className="rounded-xs bg-muted/30 p-2 text-center">
            <p className="text-[16px] font-bold tabular-nums text-foreground">
              {cal.toLocaleString()}
            </p>
            <p className="text-[9px] uppercase text-muted-foreground">cal</p>
          </div>
          <div className="rounded-xs bg-muted/30 p-2 text-center">
            <p className="text-[16px] font-bold tabular-nums text-foreground">
              {proteinG}g
            </p>
            <p className="text-[9px] uppercase text-muted-foreground">protein</p>
          </div>
          <div className="rounded-xs bg-muted/30 p-2 text-center">
            <p className="text-[16px] font-bold tabular-nums text-foreground">
              {fatG}g
            </p>
            <p className="text-[9px] uppercase text-muted-foreground">fat</p>
          </div>
        </div>
        <p className="text-[11px] text-foreground/80">
          90 min · zone-2 conditioning, technical sparring
        </p>
      </div>

      {/* Scrim + lock overlay: the actual visible UI. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/30 backdrop-blur-[1px]">
        <div className="h-9 w-9 rounded-full bg-background/90 border border-border flex items-center justify-center">
          <Lock className="h-4 w-4 text-primary" />
        </div>
        <p className="text-[12px] font-semibold text-foreground mt-2">
          Unlock with Generate
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5 px-4 text-center">
          Day-by-day macros, training, and recovery
        </p>
      </div>
    </motion.div>
  );
}
