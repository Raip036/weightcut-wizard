/**
 * NewCampWelcomeCutscene — full-screen "new fight camp" welcome sequence.
 *
 * Plays the moment a user creates a new cut/camp, while the cut plan is
 * still generating in the background. A single wizard mascot + ambient orb
 * glow persist across three timed "acts"; only the foreground text/visuals
 * swap, so the mascot feels continuous and alive (same approach as the
 * sign-up `WizardIntroCutscene`).
 *
 * Acts
 * ----
 * 1. NAME REVEAL — kicker "ROAD TO" + the camp name (large, uppercase),
 *    mascot waves, sparkles. Auto-advances after ~2.2s (or on tap).
 * 2. TARGETS — count-up numbers for current→target weight, the big
 *    "▼ N kg to cut", weeks, and days out, plus an animated SVG progress
 *    ring. Auto-advances after ~3s (or on tap).
 * 3. HAND-OFF — mascot celebrates, "Your cut plan is ready", and a
 *    prominent CTA. While `planReady` is false the CTA shows a shimmering
 *    "Finalizing your plan…" disabled state; the instant it flips true the
 *    button enables ("See my plan →") and tapping it calls `onSeePlan()`.
 *    Act 3 never auto-advances.
 *
 * Interaction
 * -----------
 * - A full-stage tap surface advances acts 1→2→3 early.
 * - Three progress dots up top reflect the current act.
 * - `useReducedMotion()` is honoured: big motion is skipped (plain
 *   cross-fades), count-up numbers jump straight to their final values.
 *
 * Rendered via a portal to document.body so the `fixed inset-0` container
 * resolves above the entire app shell.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { WizardCharacter } from "@/tutorial/WizardCharacter";
import { Orb } from "@/components/chat/Orb";

// ── Tuning ────────────────────────────────────────────────────────────
const ACT1_DWELL_MS = 2200;
const ACT2_DWELL_MS = 3000;
const COUNT_UP_MS = 1100;
const TOTAL_ACTS = 3;

interface CampTargets {
  currentWeight: number;
  targetWeight: number;
  weightToCut: number;
  daysToFight: number;
  weeks: number;
}

interface NewCampWelcomeCutsceneProps {
  campName: string;
  targets: CampTargets;
  /** False while the cut plan is still generating in the background. */
  planReady: boolean;
  /** Fired when the user taps the final "See my plan" CTA. */
  onSeePlan: () => void;
}

// ── Count-up hook ─────────────────────────────────────────────────────
/**
 * Animate a number from 0 → `target` over `durationMs` using rAF. When
 * `enabled` is false (act not visible yet) the value parks at 0; when the
 * user prefers reduced motion the value snaps straight to `target`.
 */
function useCountUp(
  target: number,
  enabled: boolean,
  options: { durationMs?: number; decimals?: number; reduced?: boolean } = {},
): number {
  const { durationMs = COUNT_UP_MS, decimals = 0, reduced = false } = options;
  const [value, setValue] = useState(reduced ? target : 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    if (!enabled) {
      setValue(0);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic — fast then settle, reads as a confident count.
      const eased = 1 - Math.pow(1 - t, 3);
      const raw = target * eased;
      const factor = Math.pow(10, decimals);
      setValue(Math.round(raw * factor) / factor);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setValue(target);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, enabled, durationMs, decimals, reduced]);

  return value;
}

// ── Ambient backdrop (shared across acts) ─────────────────────────────
// Wizard sits centred-high; the orb glows directly behind it so the
// mascot reads as lit from within. Kept to a single blurred layer for
// iOS performance — no stacked blurs.
function MascotStage({ pose }: { pose: "wave" | "celebrate" | "idle" }): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-x-0 z-10 flex justify-center" style={{ top: "16%" }}>
      <div className="relative flex items-center justify-center">
        {/* Ambient orb glow behind the mascot */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <Orb size={220} state="idle" />
        </div>
        {/* Single mascot instance — pose swaps per act */}
        <div className="relative" style={{ width: 150, height: 150 }}>
          <WizardCharacter pose={pose} />
        </div>
      </div>
    </div>
  );
}

// Lightweight sparkle layer for the name-reveal beat. Deterministic
// positions so it reads as designed, not noisy.
function SparklesLayer(): JSX.Element {
  const sparkles = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => ({
        id: i,
        left: `${(i * 67 + 12) % 100}%`,
        top: `${(i * 37 + 18) % 70}%`,
        delay: (i % 5) * 0.28,
        size: 3 + ((i * 5) % 3),
      })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {sparkles.map((s) => (
        <motion.span
          key={s.id}
          className="absolute rounded-full bg-brand-wizard-lilac"
          style={{ left: s.left, top: s.top, width: s.size, height: s.size, mixBlendMode: "screen" }}
          animate={{ opacity: [0, 1, 0], y: [0, -20, -40], scale: [0.6, 1.1, 0.4] }}
          transition={{ duration: 2.4, repeat: Infinity, delay: s.delay, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

// ── Act 1 — name reveal ───────────────────────────────────────────────
function ActName({ campName, reduced }: { campName: string; reduced: boolean }): JSX.Element {
  return (
    <motion.div
      key="act-name"
      className="absolute inset-x-0 z-20 px-6 text-center"
      style={{ top: "52%" }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -14 }}
      transition={reduced ? { duration: 0.2 } : { duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.p
        className="mb-3 text-[12px] font-semibold uppercase tracking-[0.42em] text-brand-dream-cyan"
        initial={reduced ? false : { opacity: 0, letterSpacing: "0.6em" }}
        animate={{ opacity: 1, letterSpacing: "0.42em" }}
        transition={reduced ? { duration: 0.1 } : { delay: 0.1, duration: 0.6 }}
      >
        Road to
      </motion.p>
      <h1
        className="display-number mx-auto max-w-[18ch] text-balance text-[40px] font-extrabold uppercase leading-[1.04] tracking-[-0.02em] text-white"
        style={{ textShadow: "0 0 40px rgba(139,126,234,0.35)" }}
      >
        {campName}
      </h1>
    </motion.div>
  );
}

// ── Act 2 — targets ───────────────────────────────────────────────────
function ProgressRing({ active, reduced }: { active: boolean; reduced: boolean }): JSX.Element {
  const size = 132;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  // Show a near-full ring sweeping in — represents the commitment to the cut.
  const targetOffset = circumference * 0.12;
  return (
    <svg width={size} height={size} className="-rotate-90" aria-hidden>
      <defs>
        <linearGradient id="campRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4068EF" />
          <stop offset="50%" stopColor="#8B7EEA" />
          <stop offset="100%" stopColor="#4AB4ED" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="url(#campRingGradient)"
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={circumference}
        initial={reduced ? { strokeDashoffset: targetOffset } : { strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: active ? targetOffset : circumference }}
        transition={reduced ? { duration: 0.1 } : { duration: 1.3, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

function ActTargets({
  targets,
  active,
  reduced,
}: {
  targets: CampTargets;
  active: boolean;
  reduced: boolean;
}): JSX.Element {
  const current = useCountUp(targets.currentWeight, active, { decimals: 1, reduced });
  const target = useCountUp(targets.targetWeight, active, { decimals: 1, reduced });
  const toCut = useCountUp(targets.weightToCut, active, { decimals: 1, reduced });
  const weeks = useCountUp(targets.weeks, active, { reduced });
  const days = useCountUp(targets.daysToFight, active, { reduced });

  return (
    <motion.div
      key="act-targets"
      className="absolute inset-x-0 z-20 px-6 text-center"
      style={{ top: "46%" }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -14 }}
      transition={reduced ? { duration: 0.2 } : { duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Current → target weight */}
      <p className="display-number mb-5 text-[22px] font-semibold text-white/85 tabular-nums">
        {current.toFixed(1)} <span className="px-1 text-white/35">→</span> {target.toFixed(1)}
        <span className="ml-1.5 text-[14px] font-medium text-white/45">kg</span>
      </p>

      {/* The headline number, framed by the progress ring */}
      <div className="relative mx-auto flex h-[132px] w-[132px] items-center justify-center">
        <div className="absolute inset-0">
          <ProgressRing active={active} reduced={reduced} />
        </div>
        <div className="relative flex flex-col items-center">
          <span className="text-[13px] font-bold leading-none text-brand-dream-cyan">▼</span>
          <span className="display-number mt-0.5 text-[38px] font-extrabold leading-none text-white tabular-nums">
            {toCut.toFixed(1)}
          </span>
          <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
            kg to cut
          </span>
        </div>
      </div>

      {/* Weeks + days */}
      <div className="mx-auto mt-6 flex max-w-[280px] items-stretch justify-center gap-3">
        <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
          <p className="display-number text-[24px] font-bold text-white tabular-nums">{Math.round(weeks)}</p>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-white/45">weeks</p>
        </div>
        <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
          <p className="display-number text-[24px] font-bold text-white tabular-nums">{Math.round(days)}</p>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-white/45">days out</p>
        </div>
      </div>
    </motion.div>
  );
}

// ── Act 3 — hand-off / CTA ────────────────────────────────────────────
function ActHandoff({
  planReady,
  onSeePlan,
  reduced,
}: {
  planReady: boolean;
  onSeePlan: () => void;
  reduced: boolean;
}): JSX.Element {
  return (
    <>
      <motion.div
        key="act-handoff-copy"
        className="absolute inset-x-0 z-20 px-6 text-center"
        style={{ top: "52%" }}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: -14 }}
        transition={reduced ? { duration: 0.2 } : { duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.32em] text-brand-dream-cyan">
          Locked in
        </p>
        <h2 className="display-number mx-auto max-w-[16ch] text-balance text-[32px] font-extrabold leading-[1.08] tracking-[-0.02em] text-white">
          Your cut plan is ready
        </h2>
      </motion.div>

      {/* CTA — gated on planReady. Pinned above the safe area. */}
      <div
        className="absolute inset-x-0 z-40 px-6"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)" }}
      >
        <motion.button
          type="button"
          onClick={() => {
            if (planReady) onSeePlan();
          }}
          disabled={!planReady}
          aria-label={planReady ? "See my plan" : "Finalizing your plan"}
          aria-disabled={!planReady}
          className="relative mx-auto flex h-[56px] w-full max-w-[420px] items-center justify-center overflow-hidden rounded-2xl text-[16px] font-bold text-white transition-transform active:scale-[0.97]"
          style={{
            background: planReady
              ? "linear-gradient(90deg, #4068EF 0%, #2A5BDD 50%, #4AB4ED 100%)"
              : "rgba(255,255,255,0.06)",
            border: planReady ? "none" : "1px solid rgba(255,255,255,0.10)",
            color: planReady ? "#fff" : "rgba(255,255,255,0.55)",
            cursor: planReady ? "pointer" : "default",
            WebkitTapHighlightColor: "transparent",
            boxShadow: planReady ? "0 8px 32px rgba(64,104,239,0.35)" : "none",
          }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={reduced ? { duration: 0.2 } : { delay: 0.15, type: "spring", stiffness: 260, damping: 26 }}
        >
          {planReady ? (
            "See my plan →"
          ) : (
            <>
              <span className="relative z-10">Finalizing your plan…</span>
              {/* Shimmer sweep — skipped under reduced motion */}
              {!reduced && (
                <motion.span
                  aria-hidden
                  className="absolute inset-0 z-0"
                  style={{
                    background:
                      "linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.14) 50%, transparent 70%)",
                  }}
                  initial={{ x: "-100%" }}
                  animate={{ x: "100%" }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
            </>
          )}
        </motion.button>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────
export function NewCampWelcomeCutscene({
  campName,
  targets,
  planReady,
  onSeePlan,
}: NewCampWelcomeCutsceneProps): JSX.Element {
  const reduced = !!useReducedMotion();
  const [act, setAct] = useState(0); // 0,1,2
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mascot pose per act: wave on reveal, celebrate on hand-off.
  const pose: "wave" | "celebrate" | "idle" = act === 0 ? "wave" : act === 2 ? "celebrate" : "idle";

  const advance = useCallback(() => {
    setAct((i) => Math.min(i + 1, TOTAL_ACTS - 1));
  }, []);

  // Auto-advance timers for acts 1 & 2 (act 3 holds for the CTA).
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (act === 0) {
      timerRef.current = setTimeout(advance, ACT1_DWELL_MS);
    } else if (act === 1) {
      timerRef.current = setTimeout(advance, ACT2_DWELL_MS);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [act, advance]);

  // Stage tap advances early (acts 1→2→3); act 3 relies on the CTA.
  const handleStageTap = useCallback(() => {
    if (act < TOTAL_ACTS - 1) advance();
  }, [act, advance]);

  const overlay = (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden text-white"
      style={{
        // Cosmic vignette — matches the app's dark Apple-Fitness shell.
        background:
          "radial-gradient(ellipse at 50% 28%, rgba(44, 30, 70, 0.78) 0%, rgba(10, 10, 18, 0.96) 56%, #020204 100%)",
      }}
    >
      {/* Progress dots — top-center, one per act */}
      <div
        className="absolute z-30 flex items-center gap-1.5"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 22px)", left: "50%", transform: "translateX(-50%)" }}
        aria-hidden
      >
        {Array.from({ length: TOTAL_ACTS }, (_, i) => (
          <motion.span
            key={i}
            className="h-1.5 rounded-full bg-white"
            animate={{ width: i === act ? 22 : 6, opacity: i === act ? 1 : i < act ? 0.55 : 0.25 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          />
        ))}
      </div>

      {/* Tap surface — covers the stage; CTA (z-40) takes precedence. */}
      <div className="absolute inset-0 z-10" onClick={handleStageTap} />

      {/* Sparkles only on the name-reveal beat */}
      <AnimatePresence>
        {act === 0 && !reduced && (
          <motion.div
            key="sparkles"
            className="pointer-events-none absolute inset-0 z-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <SparklesLayer />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Persistent mascot + orb glow */}
      <MascotStage pose={pose} />

      {/* Foreground content — swaps per act */}
      <AnimatePresence mode="wait">
        {act === 0 && <ActName key="name" campName={campName} reduced={reduced} />}
        {act === 1 && <ActTargets key="targets" targets={targets} active reduced={reduced} />}
        {act === 2 && (
          <ActHandoff key="handoff" planReady={planReady} onSeePlan={onSeePlan} reduced={reduced} />
        )}
      </AnimatePresence>
    </div>
  );

  return createPortal(overlay, document.body);
}

export default NewCampWelcomeCutscene;
