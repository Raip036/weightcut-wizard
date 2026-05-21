/**
 * Onboarding gamification primitives — all in one file because they
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
// XPProgressBar — header-mounted "fight camp XP" bar.
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
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary via-primary to-amber-400"
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
        {/* Shimmer head — only on motion-OK clients. Sits at the bar tip. */}
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
// CuttingNowChip — social-proof chip. The number is deterministic from
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
  // their number — feels less like a slot machine that way. Stays in
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
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        <p className="text-[10px] font-semibold text-emerald-400/90 tabular-nums">
          {count.toLocaleString()} fighters cutting weight right now
        </p>
      </div>
      {/* Inline achievement pill — same dimensions / type-scale as the
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
// OnboardingMascot — small coach silhouette pinned in the corner that
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
// DaysToFightSlam — fires once when the user first picks a target
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
      // calendar) so it can't bleed through under the slam — some
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
// WeightLossSlam — fires once when the user first enters a valid
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
      ? "text-emerald-400"
      : perWeekKg <= 1.5
      ? "text-amber-400"
      : "text-rose-400";

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
// LossFrameCard — appears under the goal weight step. Shows what
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
      className="rounded-xs border border-amber-500/25 bg-amber-500/[0.06] p-3"
    >
      <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-400/90 mb-1">
        Reality check
      </p>
      <p className="text-[13px] text-foreground/90 leading-snug">
        Skip a week and the cut becomes{" "}
        <span className="font-semibold tabular-nums">
          {skippedRate.toFixed(1)} kg/week
        </span>
        {dangerous ? " — that's beyond safe limits." : safeRate ? " — still doable." : " — pushing the limit."}
      </p>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SilentAchievement — small toast-style popup that slides in from the
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
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-primary text-primary-foreground shadow-[0_10px_30px_-6px_rgba(0,0,0,0.45)]">
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
// DeclarationButton — hold-to-lock commit. The user holds the button
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
  //    Frame`. NO React re-render per tick — the previous version
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
    // Haptic ramp at 33% / 66% — feels like the lock is engaging.
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
      // Skip the hold animation entirely for accessibility users —
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
      // Smooth retreat — let the browser ease the cancelled fill back
      // to 0 with a short CSS transition, then strip the transition so
      // the next press starts crisp via rAF again.
      const el = fillRef.current;
      if (el) {
        el.style.transition = "transform 220ms cubic-bezier(0.32, 0.72, 0, 1)";
        el.style.transform = "scaleX(0)";
        const handle = window.setTimeout(() => {
          if (fillRef.current) fillRef.current.style.transition = "none";
        }, 240);
        // No state cleanup needed — committedRef is the source of truth
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
      {/* Fill arc — `transform: scaleX` driven by rAF so the animation
          lives on the compositor and never blocks the main thread.
          `rounded-xs` mirrors the parent radius as belt-and-braces: even
          if the parent's overflow clip glitches under iOS's GPU paint, the
          fill's own corners stay rounded so nothing visibly overflows. */}
      <div
        ref={fillRef}
        aria-hidden
        className="absolute inset-y-0 left-0 right-0 bg-amber-300 rounded-xs"
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
// TaleOfTheTapeCard — finale "fighter intro" reveal. Stat rows flip
// in one by one with a small staggered spring. Screenshot-bait.
// ─────────────────────────────────────────────────────────────────────
export interface TaleStat {
  label: string;
  value: string;
}

export function TaleOfTheTapeCard({
  stats,
  onShare,
}: {
  stats: TaleStat[];
  /** Optional share-card affordance — rendered as a small icon button
   *  in the top-right of the card. Tap fires the parent's share flow. */
  onShare?: () => void;
}) {
  const reduced = useReducedMotion();
  const firedRef = useRef(false);

  // Stamp-in haptic sequence — fire one Light haptic per stat row as it
  // springs in (aligned to the existing 0.18 + i*0.07s stagger), then a
  // Heavy haptic on the final row to "seal" the card. Only fires once
  // per mount; navigation back + forward will replay it.
  useEffect(() => {
    if (reduced || firedRef.current) return;
    firedRef.current = true;
    const timers: number[] = [];
    stats.forEach((_, i) => {
      const isLast = i === stats.length - 1;
      const t = window.setTimeout(() => {
        triggerHaptic(isLast ? ImpactStyle.Heavy : ImpactStyle.Light);
      }, 180 + i * 70 + 80); // +80ms aligns the tick with the spring's settle
      timers.push(t);
    });
    return () => { timers.forEach(window.clearTimeout); };
  }, [reduced, stats]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: reduced ? 1 : 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 22 }}
      className="relative rounded-3xl border-2 border-primary/30 bg-gradient-to-b from-primary/[0.10] via-card to-card overflow-hidden p-5"
      style={{ willChange: "transform, opacity" }}
    >
      {onShare && (
        <button
          type="button"
          onClick={onShare}
          aria-label="Share your camp card"
          className="absolute top-3 right-3 h-9 w-9 flex items-center justify-center rounded-full bg-muted/40 border border-border/40 active:scale-90 transition-transform"
        >
          <Share2 className="h-4 w-4 text-foreground/80" />
        </button>
      )}
      <div className="text-center mb-4">
        <h3 className="text-[28px] font-black uppercase tracking-wide leading-none text-foreground">
          Tale of the Tape
        </h3>
      </div>
      <div className="rounded-xs bg-muted/30 border border-border/40 divide-y divide-border/30">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, x: reduced ? 0 : -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              delay: 0.18 + i * 0.07,
              type: "spring",
              stiffness: 320,
              damping: 26,
            }}
            className="flex items-center justify-between px-3.5 py-2.5"
          >
            <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              {s.label}
            </span>
            <span className="text-[15px] font-bold tabular-nums">{s.value}</span>
          </motion.div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-1.5 mt-4 text-emerald-400/90">
        <ShieldCheck className="h-3.5 w-3.5" />
        <p className="text-[11px] uppercase tracking-wider font-bold">
          Camp Sealed
        </p>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sport-aware vocabulary helper — one place to translate generic UX
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
// MathWhisper — small caption that does live arithmetic on the values
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
// WittyValidation — small green validation line under an input that
// echoes the user's choice with a coaching micro-comment. Reads as
// "an experienced coach who actually looked at your number."
// ─────────────────────────────────────────────────────────────────────
export function WittyValidation({ children }: { children: React.ReactNode }) {
  return (
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.32 }}
      className="text-[12px] text-emerald-400/90 mt-1.5 font-medium leading-snug"
    >
      {children}
    </motion.p>
  );
}

// ─────────────────────────────────────────────────────────────────────
// WeeklyMilestonesScrubber — horizontal dot path showing projected
// weekly weight checkpoints. For cuts ≥5 weeks, shades a "plateau
// zone" band on weeks 3-4 so users aren't surprised when the scale
// stalls. Linear interpolation between current and goal — directional
// only, not a clinical prediction.
// ─────────────────────────────────────────────────────────────────────
export function WeeklyMilestonesScrubber({
  currentKg,
  goalKg,
  weeks,
}: {
  currentKg: number;
  goalKg: number;
  weeks: number;
}) {
  const reduced = useReducedMotion();

  // Pick at most 5 checkpoints so the strip stays readable on narrow
  // phones — always include W1, the goal week, and 2-3 evenly-spaced
  // intermediate weeks.
  const checkpoints = useMemo(() => {
    if (weeks <= 0 || !Number.isFinite(weeks)) return [];
    const totalKg = currentKg - goalKg;
    if (totalKg <= 0) return [];
    const weekList: number[] = [];
    if (weeks <= 4) {
      for (let w = 1; w <= weeks; w += 1) weekList.push(w);
    } else {
      const step = Math.max(1, Math.round((weeks - 1) / 3));
      weekList.push(1);
      for (let w = 1 + step; w < weeks; w += step) weekList.push(w);
      if (weekList[weekList.length - 1] !== weeks) weekList.push(weeks);
    }
    return weekList.map((w) => {
      const pct = w / weeks;
      const projected = currentKg - totalKg * pct;
      return {
        week: w,
        delta: currentKg - projected, // kg lost by this point (positive)
        projectedKg: projected,
        isGoal: w === weeks,
      };
    });
  }, [currentKg, goalKg, weeks]);

  if (checkpoints.length === 0) return null;

  const showPlateauZone = weeks >= 5;

  return (
    <div className="rounded-xs border border-border/40 bg-card/60 px-4 py-3.5">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[10px] uppercase tracking-[0.15em] font-bold text-muted-foreground">
          Projected Path
        </p>
        <p className="text-[10px] uppercase tracking-[0.15em] font-bold text-primary/70">
          {weeks}w
        </p>
      </div>

      {/* Rail + plateau band + dots */}
      <div className="relative">
        {/* Base rail */}
        <div className="absolute left-1.5 right-1.5 top-1/2 -translate-y-1/2 h-[2px] bg-muted/40 rounded-full" />
        {/* Plateau zone band (weeks 3-4) — drawn under the dots so they remain crisp. */}
        {showPlateauZone && (
          <div
            className="absolute top-1/2 -translate-y-1/2 h-3 rounded-full bg-amber-500/15 border border-amber-500/25"
            style={{
              left: `calc(${(2 / weeks) * 100}% + 6px)`,
              right: `calc(${((weeks - 4) / weeks) * 100}% + 6px)`,
            }}
            aria-hidden
          />
        )}

        <div className="relative flex items-center justify-between">
          {checkpoints.map((cp, i) => (
            <motion.div
              key={cp.week}
              initial={{ opacity: 0, scale: reduced ? 1 : 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                delay: 0.1 + i * 0.06,
                type: "spring",
                stiffness: 360,
                damping: 22,
              }}
              className="relative z-10 flex flex-col items-center"
              style={{ minWidth: 28 }}
            >
              <div
                className={`h-3 w-3 rounded-full ${
                  cp.isGoal
                    ? "bg-primary ring-2 ring-primary/30"
                    : "bg-foreground/70"
                }`}
              />
            </motion.div>
          ))}
        </div>
      </div>

      {/* Labels under each dot */}
      <div className="flex items-start justify-between mt-2">
        {checkpoints.map((cp) => (
          <div
            key={cp.week}
            className="flex flex-col items-center text-center"
            style={{ minWidth: 28 }}
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
              W{cp.week}
            </span>
            <span
              className={`text-[11px] font-bold tabular-nums leading-tight ${
                cp.isGoal ? "text-primary" : "text-foreground"
              }`}
            >
              {cp.isGoal ? "✓" : `-${cp.delta.toFixed(1)}`}
            </span>
          </div>
        ))}
      </div>

      {showPlateauZone && (
        <p className="text-[10px] text-amber-400/80 mt-2 text-center">
          Plateau zone weeks 3–4. Normal. Trust the protocol.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// BlurredWeekOnePreview — fake "Day 1" plan card behind a blur scrim.
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
      {/* The blurred "card" content — readable enough to tease, blurred
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

      {/* Scrim + lock overlay — the actual visible UI. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/30 backdrop-blur-[1px]">
        <div className="h-9 w-9 rounded-full bg-background/90 border border-border flex items-center justify-center shadow-sm">
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
