import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

// Captured at module load. Survives unmount→remount of <FightFormRing/>
// because the module stays in the JS heap while the SPA is alive — so
// looping atmospheric animations resume from where they "would have been"
// instead of restarting from frame 0.
const RING_EPOCH_MS = Date.now();

type Props = {
  score: number;
  label: "sharp" | "sharpening" | "off_pace" | "at_risk";
  state: "ok" | "calibrating" | "no_camp" | "paused";
  calibratingDays?: { current: number; needed: number };
  // Used to render the ghost arc beyond the cap when a soft ceiling fires —
  // the displayed `score` is the clamped value, while `rawScore` is what the
  // engine would have shown without the cap.
  rawScore?: number;
  appliedCeiling?: { ruleId: string; cap: number } | null;
  // Phase shows up as an outer ring treatment (dashed for peak, glowing for
  // fight week). `null` or `"build"` renders no extra border.
  phase?: "build" | "peak" | "fightWeek" | null;
  // One-shot bloom + glow when the user first crosses into Sharp on a
  // given day. Parent is responsible for setting + clearing this flag.
  celebrateSharp?: boolean;
  onTap?: () => void;
  size?: number;
};

const LABEL_COPY = {
  sharp: "Sharp",
  sharpening: "Sharpening",
  off_pace: "Off Pace",
  at_risk: "At Risk",
};

const LABEL_STROKE = {
  sharp: "stroke-func-recovery-green",
  sharpening: "stroke-func-warning-yellow",
  off_pace: "stroke-func-carbs-orange",
  at_risk: "stroke-func-danger-red",
};

// RGB triplets used by the halo + particles so we can vary opacity in CSS
// without re-declaring full color values. Matches the Tailwind palette above.
const LABEL_RGB = {
  sharp: "16, 185, 129",       // emerald-500
  sharpening: "251, 191, 36",  // amber-400
  off_pace: "249, 115, 22",    // orange-500
  at_risk: "244, 63, 94",      // rose-500
};

// Pulse cadence reacts to the label. Sharper form earns a livelier halo;
// At Risk drifts almost-still so the UI doesn't celebrate a bad state.
const HALO_DURATION = {
  sharp: "3.4s",
  sharpening: "5.2s",
  off_pace: "7s",
  at_risk: "9s",
};

// Peak halo intensity at each label — narrower range at At Risk so the
// halo recedes when the score isn't earned. Values were ~40% lower before;
// bumped so the ring reads as alive on iOS Capacitor where Tailwind's color
// stack tends to wash out blur'd radial gradients.
const HALO_PEAK = {
  sharp: 0.78,
  sharpening: 0.55,
  off_pace: 0.32,
  at_risk: 0.2,
};

// Density tuned per label so the orbit feels alive without overwhelming
// the score readout. Sharp + Sharpening earn the densest swarm; Off Pace
// and At Risk get a thinner, more subdued field so the visual celebrates
// good form rather than every state.
const PARTICLE_COUNT_BY_LABEL = {
  sharp: 84,
  sharpening: 64,
  off_pace: 40,
  at_risk: 20,
} as const;

// Soft drifting "wind wisps" — larger blurred ellipses that float around
// the ring at slow speeds. Layered behind the orbiting particles to give
// Whoop-style atmospheric depth.
const WISP_COUNT = 5;

// Calibration "pre-bloom" palette. Cool cyan (sky-400) so the calibrating
// state reads as a distinct phase, then saturates toward the eventual label
// color as days complete. Until then, the ring uses this base.
const CALIB_RGB = "56, 189, 248";
// Cap calibration halo below sharp's peak — even at full saturation the
// calibrating state should read as "building" rather than "earned".
const CALIB_HALO_PEAK_MAX = 0.45;
const CALIB_HALO_DURATION = "4.6s";
// Density window for the calibration particle field. Floor + ceiling tuned
// to read as a continuous flow (matching sharpening density) rather than a
// sparse marching line, while keeping calibration distinct from sharp.
const CALIB_PARTICLE_MIN = 44;
const CALIB_PARTICLE_MAX = 72;
// Golden-ratio scatter constant. Multiplying particle index by this and
// taking the fractional part gives a maximally-uniform but non-grid spread
// around the orbit — particles look organic instead of marching in lockstep.
// Critically, each particle's phase is a pure function of its index, so
// adding particles when calibProgress grows doesn't shift existing ones.
const GOLDEN_PHASE = 0.6180339887498949;
// Rotated through the subline so the user sees the engine is actively
// reading specific signals, not just spinning.
const CALIB_PHRASES = [
  "Reading training load",
  "Mapping sleep cadence",
  "Watching weight trend",
  "Logging recovery patterns",
  "Profiling RPE ceiling",
];
const CALIB_PHRASE_INTERVAL_MS = 3200;
const CALIB_DAY_PING_MS = 1600;

export function FightFormRing({
  score,
  label,
  state,
  calibratingDays,
  rawScore,
  appliedCeiling,
  phase,
  celebrateSharp,
  onTap,
  size = 220,
}: Props) {
  const radius = (size - 20) / 2;
  const circumference = 2 * Math.PI * radius;
  const baseProgress =
    state === "ok"
      ? Math.max(0, Math.min(1, score / 100))
      : state === "calibrating" && calibratingDays
        ? Math.max(0, Math.min(1, calibratingDays.current / calibratingDays.needed))
        : 0;

  // Ghost arc: drawn between the clamped score and the raw score the engine
  // would have produced without the soft ceiling. Communicates "you're being
  // capped here" without alarmism — replaces the bottom-sheet-only banner.
  // Uses baseProgress (not the unlock-scaled progress) so the ghost lands
  // at its final position immediately rather than animating with the arc
  // during the brief 1.5s unlock.
  const rawProgress =
    state === "ok" && appliedCeiling != null && rawScore != null
      ? Math.max(baseProgress, Math.min(1, rawScore / 100))
      : baseProgress;
  const ghostLen = (rawProgress - baseProgress) * circumference;
  const showGhost = state === "ok" && appliedCeiling != null && ghostLen > 0.5;

  // Lock marker position at the cap boundary on the ring's perimeter. SVG
  // is `-rotate-90` so progress 0 is at 12 o'clock and grows clockwise.
  const lockAngleRad = (baseProgress * 360 * Math.PI) / 180;
  const lockX = size / 2 + radius * Math.sin(lockAngleRad);
  const lockY = size / 2 - radius * Math.cos(lockAngleRad);

  const isCalib = state === "calibrating";
  // Calibration progress drives saturation: floor at 0.18 so day 0 still
  // shows life, ceil at 1 so the last day reads almost-fully-formed.
  const calibProgress = isCalib && calibratingDays && calibratingDays.needed > 0
    ? Math.max(0.18, Math.min(1, calibratingDays.current / calibratingDays.needed))
    : 1;

  const showHalo = state === "ok" || isCalib;
  // Show the orbital swarm at every "ok" score now (not gated to >= 80).
  // Density scales with the label so weaker form gets a thinner field
  // instead of a sudden cut-off. During calibration, density scales with
  // calibProgress so the field literally builds toward unlock.
  const showParticles = state === "ok" || isCalib;
  const particleCount =
    state === "ok"
      ? PARTICLE_COUNT_BY_LABEL[label]
      : isCalib
        ? Math.round(CALIB_PARTICLE_MIN + (CALIB_PARTICLE_MAX - CALIB_PARTICLE_MIN) * calibProgress)
        : 0;
  const labelRgb =
    state === "ok"
      ? LABEL_RGB[label]
      : isCalib
        ? CALIB_RGB
        : "148, 163, 184"; // slate-400 fallback
  const haloDuration =
    state === "ok" ? HALO_DURATION[label] : isCalib ? CALIB_HALO_DURATION : "10s";
  const haloPeak =
    state === "ok"
      ? HALO_PEAK[label]
      : isCalib
        ? CALIB_HALO_PEAK_MAX * calibProgress
        : 0.1;

  // Rotating signal phrase + day-completion ping. Both gated to calibrating
  // so the timers don't run when the ring is in any other state.
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [dayPing, setDayPing] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  // unlockProgress (0..1) drives the score-arc grow + number count-up during
  // the victory lap. Stays at 1 outside of unlock so normal renders aren't
  // gated by it.
  const [unlockProgress, setUnlockProgress] = useState(1);
  const prevDaysRef = useRef(calibratingDays?.current ?? 0);
  const prevStateRef = useRef(state);

  // Unlock victory lap: fires once when state transitions calibrating→ok.
  // Three beats over ~1500ms — (1) the comet does one accelerating finale
  // lap while the ring blooms (scale + cyan→emerald glow sweep), then (2)
  // the score arc grows from 0 with ease-out-quart and the center number
  // counts up to the actual score. Replaces the jump-cut between phases.
  //
  // useLayoutEffect (not useEffect) so the unlocking=true / unlockProgress=0
  // reset commits BEFORE the browser paints the new ok-state frame; without
  // this the user gets one flash of the fully-unlocked arc before the
  // animation rewinds to zero.
  useLayoutEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (prev !== "calibrating" || state !== "ok") return;

    setUnlocking(true);
    setUnlockProgress(0);

    const start = performance.now();
    const cometFinaleMs = 500;
    const arcGrowMs = 950;
    let raf = 0;

    const tick = (now: number) => {
      const elapsed = now - start - cometFinaleMs;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const t = Math.min(1, elapsed / arcGrowMs);
      // ease-out-quart
      const eased = 1 - Math.pow(1 - t, 4);
      setUnlockProgress(eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const done = window.setTimeout(() => {
      setUnlocking(false);
      setUnlockProgress(1);
    }, cometFinaleMs + arcGrowMs + 50);

    return () => {
      window.clearTimeout(done);
      cancelAnimationFrame(raf);
    };
  }, [state]);

  useEffect(() => {
    if (!isCalib) return;
    const id = window.setInterval(() => {
      setPhraseIdx((i) => (i + 1) % CALIB_PHRASES.length);
    }, CALIB_PHRASE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isCalib]);

  useEffect(() => {
    if (!isCalib || !calibratingDays) return;
    if (calibratingDays.current > prevDaysRef.current) {
      setDayPing(true);
      const t = window.setTimeout(() => setDayPing(false), CALIB_DAY_PING_MS);
      prevDaysRef.current = calibratingDays.current;
      return () => window.clearTimeout(t);
    }
    prevDaysRef.current = calibratingDays.current;
  }, [isCalib, calibratingDays?.current]);

  const calibRemainingDays = isCalib && calibratingDays
    ? Math.max(0, calibratingDays.needed - calibratingDays.current)
    : 0;

  // Apply the unlock progress only to the ok-state score arc + number so the
  // calibrating-phase arc isn't accidentally scaled when state===ok arrives.
  const progress = unlocking && state === "ok" ? baseProgress * unlockProgress : baseProgress;
  const dash = circumference * progress;
  const displayedScore = unlocking && state === "ok" ? Math.round(score * unlockProgress) : score;
  // Keep the comet visible through the first beat of the unlock so it can
  // do its finale fade before dissolving. The finale class swaps in below
  // when unlocking is true.
  const showCalibSweep = isCalib || unlocking;

  // Outer ring treatment per camp phase. Build gets no extra border so the
  // hero ring stays clean during the bulk of camp; Peak adds a dashed orbit;
  // Fight Week pulses a faint colored outline so the user sees the weeks-to-
  // fight transition in the dashboard itself, not buried in copy.
  const showPhasePeak = state === "ok" && phase === "peak";
  const showPhaseFightWeek = state === "ok" && phase === "fightWeek";
  const phaseRadius = radius + 5;

  const elapsedSec = (Date.now() - RING_EPOCH_MS) / 1000;

  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        "relative flex flex-col items-center justify-center",
        celebrateSharp && "ff-ring-sharp-bloom",
        dayPing && "ff-ring-score-bloom",
        unlocking && "ff-ring-unlock-bloom",
      )}
      aria-label="Open Fight Form Score details"
      style={{ width: size, height: size }}
    >
      {/* Aurora sheen — slow rotating conic gradient sweep behind the ring.
          Reads as a trailing "comet tail" of light that rotates once every
          12-20s depending on label. Whoop's hero-ring move. */}
      {showHalo && (
        <div
          aria-hidden
          className="ff-ring-aurora absolute inset-0 rounded-full pointer-events-none"
          style={{
            ["--ff-halo-rgb" as any]: labelRgb,
            animationDelay: `${-elapsedSec}s`,
          }}
        />
      )}

      {/* Aurora halo. Sits behind everything via z-index. Color, intensity
          and speed are state-reactive via inline CSS vars consumed by the
          ff-ring-halo keyframe in index.css. */}
      {showHalo && (
        <div
          aria-hidden
          className="ff-ring-halo absolute inset-0 rounded-full pointer-events-none"
          style={{
            ["--ff-halo-rgb" as any]: labelRgb,
            ["--ff-halo-peak" as any]: haloPeak,
            animationDuration: haloDuration,
            animationDelay: `${-elapsedSec}s`,
          }}
        />
      )}

      {/* Drifting wind wisps — large soft blurred ellipses that float around
          the ring on long, varied timelines. Layered behind the particles
          for atmospheric depth. */}
      {showHalo && (
        <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden rounded-full">
          {Array.from({ length: WISP_COUNT }).map((_, i) => {
            const wispDuration = 18 + (i * 3.5); // 18s, 21.5s, 25s, 28.5s, 32s
            const startOffset = -((wispDuration * i) / WISP_COUNT);
            return (
              <span
                key={i}
                className={`ff-ring-wisp ff-ring-wisp-${i}`}
                style={{
                  ["--ff-halo-rgb" as any]: labelRgb,
                  animationDuration: `${wispDuration}s`,
                  animationDelay: `${startOffset - elapsedSec}s`,
                }}
              />
            );
          })}
        </div>
      )}

      {/* Inner core glow — a soft breathing inner highlight that pulses
          gently regardless of state. Sells the "alive" feel even at low
          scores where the halo opacity is muted. */}
      {showHalo && (
        <div
          aria-hidden
          className="ff-ring-core absolute inset-0 rounded-full pointer-events-none"
          style={{
            ["--ff-halo-rgb" as any]: labelRgb,
            animationDelay: `${-elapsedSec}s`,
          }}
        />
      )}

      {/* Particles — visible at every "ok" score, density scales by label.
          Mixed sizes (every 3rd particle is bigger, every 5th is a small
          sparkle) keep the orbit from reading as mechanical. */}
      {showParticles && (
        <div aria-hidden className="absolute inset-0 pointer-events-none">
          {Array.from({ length: particleCount }).map((_, i) => {
            // Spread across 9 concentric orbits so the heavy swarm fans
            // into a thick atmospheric halo instead of stacking on one ring.
            const orbitRadius = radius - 4 + ((i % 9) - 4) * 6; // -28..+26 px
            const orbitDuration = 9 + (i % 11) * 0.95;            // 9s..18.5s
            const twinkleDuration = 1.2 + (i % 7) * 0.45;         // 1.2s..3.9s
            // Per-particle phase. Ok-state keeps the original even-spacing
            // distribution since its particleCount is fixed per label. The
            // calibration state uses a golden-ratio scatter so phases are
            // a pure function of the particle index — when calibProgress
            // grows and more particles mount, existing particles keep their
            // positions instead of snapping to new phase offsets.
            const phase = isCalib
              ? (i * GOLDEN_PHASE) % 1
              : i / particleCount;
            const startOffset = -(orbitDuration * phase);
            const sizeVariant = i % 4 === 0 ? "lg" : i % 6 === 0 ? "sm" : "md";
            return (
              <span
                key={i}
                className={`ff-ring-particle ff-ring-particle-${sizeVariant}`}
                style={{
                  ["--ff-halo-rgb" as any]: labelRgb,
                  ["--ff-orbit-r" as any]: `${orbitRadius}px`,
                  animationDuration: `${orbitDuration}s, ${twinkleDuration}s`,
                  animationDelay: `${startOffset - elapsedSec}s, ${-(i * 0.4) - elapsedSec}s`,
                }}
              />
            );
          })}
        </div>
      )}

      <svg width={size} height={size} className="-rotate-90 relative">
        {/* Phase border (outer). Build = none. Peak = dashed orbit. Fight
            Week = colored pulse. Sits outside the main track so it never
            competes with the score arc for the eye. */}
        {showPhasePeak && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={phaseRadius}
            stroke="hsl(var(--muted-foreground))"
            strokeOpacity={0.4}
            strokeWidth={1.5}
            fill="none"
            strokeDasharray="5 5"
          />
        )}
        {showPhaseFightWeek && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={phaseRadius}
            stroke={`rgb(${labelRgb})`}
            strokeWidth={1.5}
            fill="none"
            className="ff-ring-phase-pulse"
          />
        )}

        {/* Track — breathes slowly while calibrating to signal active scanning */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={showCalibSweep ? "hsl(var(--muted-foreground))" : "hsl(var(--muted))"}
          strokeWidth={10}
          fill="none"
          className={showCalibSweep ? "ff-ring-calib-track" : undefined}
        />
        {/* Ghost arc — what the user WOULD have scored without the cap.
            Rendered first so the score arc + lock paint on top of it. */}
        {showGhost && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={`rgb(${labelRgb})`}
            strokeOpacity={0.22}
            strokeWidth={10}
            fill="none"
            strokeLinecap="butt"
            strokeDasharray={`${ghostLen} ${circumference}`}
            strokeDashoffset={`${-dash}`}
          />
        )}
        {/* Score arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={10}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className={cn(
            "transition-all duration-700",
            state === "ok" ? LABEL_STROKE[label] : "stroke-muted-foreground/40",
          )}
        />
        {/* Calibrating comet — four stacked arcs share the same rotation so
            they read as a single streak with a bright head and fading tail.
            Blur halo → wide tail → mid body → sharp head, all monochrome.
            Stays cyan even during unlock so the finale visually hands off
            from cyan-comet → emerald-arc instead of all going one color. */}
        {showCalibSweep && (
          <>
            {/* Blur halo behind the streak */}
            <circle
              cx={size / 2} cy={size / 2} r={radius}
              stroke={`rgba(${CALIB_RGB}, 0.07)`}
              strokeWidth={18}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${circumference * 0.32} ${circumference * 0.68}`}
              className={cn("ff-ring-calib-sweep", unlocking && "ff-ring-unlock-comet-finale")}
              style={{ transformOrigin: `${size / 2}px ${size / 2}px`, filter: "blur(6px)" }}
            />
            {/* Tail — long, faint */}
            <circle
              cx={size / 2} cy={size / 2} r={radius}
              stroke={`rgba(${CALIB_RGB}, 0.18)`}
              strokeWidth={7}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${circumference * 0.22} ${circumference * 0.78}`}
              className={cn("ff-ring-calib-sweep", unlocking && "ff-ring-unlock-comet-finale")}
              style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}
            />
            {/* Body — medium */}
            <circle
              cx={size / 2} cy={size / 2} r={radius}
              stroke={`rgba(${CALIB_RGB}, 0.45)`}
              strokeWidth={8}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${circumference * 0.09} ${circumference * 0.91}`}
              className={cn("ff-ring-calib-sweep", unlocking && "ff-ring-unlock-comet-finale")}
              style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}
            />
            {/* Head — short, bright */}
            <circle
              cx={size / 2} cy={size / 2} r={radius}
              stroke={`rgba(${CALIB_RGB}, 0.9)`}
              strokeWidth={9}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${circumference * 0.03} ${circumference * 0.97}`}
              className={cn("ff-ring-calib-sweep", unlocking && "ff-ring-unlock-comet-finale")}
              style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}
            />
          </>
        )}
      </svg>

      {/* Lock glyph at the cap boundary. Lives outside the rotated SVG so
          its orientation stays upright regardless of the cap position. */}
      {showGhost && (
        <div
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            left: lockX,
            top: lockY,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div className="rounded-full bg-background border border-func-warning-yellow/70 p-0.5">
            <Lock className="size-2.5 text-func-warning-yellow" />
          </div>
        </div>
      )}

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {state === "ok" && (
          <>
            <span className="display-number text-5xl">{displayedScore}</span>
            <span
              className={cn(
                "section-header mt-1",
                unlocking && unlockProgress < 0.4 && "opacity-0",
              )}
            >
              {LABEL_COPY[label]}
            </span>
          </>
        )}
        {state === "calibrating" && (
          <div className="flex flex-col items-center gap-1.5 px-6 text-center">
            {calibratingDays && (
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                Day {Math.min(calibratingDays.current, calibratingDays.needed)} of {calibratingDays.needed}
              </span>
            )}
            {dayPing && calibratingDays ? (
              <span
                key={`ping-${calibratingDays.current}`}
                className="display-number text-2xl text-func-recovery-green ff-ring-calib-ping"
              >
                Day {calibratingDays.current} logged ✓
              </span>
            ) : (
              <>
                <span className="display-number text-[22px] leading-tight">
                  {calibRemainingDays === 0 ? (
                    "Computing first score"
                  ) : calibRemainingDays === 1 ? (
                    "Score ready tomorrow"
                  ) : calibratingDays ? (
                    <>
                      Score in{" "}
                      <span style={{ color: `rgb(${CALIB_RGB})` }}>{calibRemainingDays}</span>{" "}
                      days
                    </>
                  ) : (
                    "Calibrating your score"
                  )}
                </span>
                <span
                  key={`phrase-${phraseIdx}`}
                  className="text-[11px] tracking-wide text-muted-foreground ff-ring-calib-phrase"
                >
                  {CALIB_PHRASES[phraseIdx]}
                  <span aria-hidden className="ff-ring-calib-dot" style={{ animationDelay: "0s" }}>.</span>
                  <span aria-hidden className="ff-ring-calib-dot" style={{ animationDelay: "0.35s" }}>.</span>
                  <span aria-hidden className="ff-ring-calib-dot" style={{ animationDelay: "0.7s" }}>.</span>
                </span>
              </>
            )}
          </div>
        )}
        {state === "no_camp" && (
          <>
            <span className="section-header">No active camp</span>
            <span className="text-xs text-muted-foreground text-center px-8 mt-2 leading-snug">
              Tap to create one
            </span>
          </>
        )}
        {state === "paused" && (
          <>
            <span className="display-number text-3xl">—</span>
            <span className="section-header mt-1">Paused</span>
          </>
        )}
      </div>
    </button>
  );
}
