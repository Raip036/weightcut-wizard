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
  const progress =
    state === "ok"
      ? Math.max(0, Math.min(1, score / 100))
      : state === "calibrating" && calibratingDays
        ? Math.max(0, Math.min(1, calibratingDays.current / calibratingDays.needed))
        : 0;
  const dash = circumference * progress;

  // Ghost arc: drawn between the clamped score and the raw score the engine
  // would have produced without the soft ceiling. Communicates "you're being
  // capped here" without alarmism — replaces the bottom-sheet-only banner.
  const rawProgress =
    state === "ok" && appliedCeiling != null && rawScore != null
      ? Math.max(progress, Math.min(1, rawScore / 100))
      : progress;
  const ghostLen = (rawProgress - progress) * circumference;
  const showGhost = state === "ok" && appliedCeiling != null && ghostLen > 0.5;

  // Lock marker position at the cap boundary on the ring's perimeter. SVG
  // is `-rotate-90` so progress 0 is at 12 o'clock and grows clockwise.
  const lockAngleRad = (progress * 360 * Math.PI) / 180;
  const lockX = size / 2 + radius * Math.sin(lockAngleRad);
  const lockY = size / 2 - radius * Math.cos(lockAngleRad);

  const showHalo = state === "ok";
  // Show the orbital swarm at every "ok" score now (not gated to >= 80).
  // Density scales with the label so weaker form gets a thinner field
  // instead of a sudden cut-off.
  const showParticles = state === "ok";
  const particleCount = state === "ok" ? PARTICLE_COUNT_BY_LABEL[label] : 0;
  const showCalibSweep = state === "calibrating";

  const labelRgb = state === "ok" ? LABEL_RGB[label] : "148, 163, 184"; // slate-400 fallback
  const haloDuration = state === "ok" ? HALO_DURATION[label] : "10s";
  const haloPeak = state === "ok" ? HALO_PEAK[label] : 0.1;

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
            const startOffset = -((orbitDuration * i) / particleCount);
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

        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="hsl(var(--muted))"
          strokeWidth={10}
          fill="none"
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
        {/* Calibrating sweep — a small bright arc sweeping the ring perimeter
            so the user can see data is "scanning in". */}
        {showCalibSweep && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={`rgba(${labelRgb}, 0.75)`}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference * 0.08} ${circumference * 0.92}`}
            className="ff-ring-calib-sweep"
            style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}
          />
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
            <span className="display-number text-5xl">{score}</span>
            <span className="section-header mt-1">{LABEL_COPY[label]}</span>
          </>
        )}
        {state === "calibrating" && (
          calibratingDays && calibratingDays.current < calibratingDays.needed ? (
            <>
              <span className="display-number text-3xl">
                {calibratingDays.current}/{calibratingDays.needed}
              </span>
              <span className="section-header mt-1">Calibrating</span>
            </>
          ) : (
            <>
              <span className="section-header">Calibrating</span>
              <span className="text-xs text-muted-foreground mt-1.5">computing…</span>
            </>
          )
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
