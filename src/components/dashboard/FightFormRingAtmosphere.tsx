import { memo, useRef } from "react";

// Captured at module load. Survives unmount→remount of the atmosphere
// because the module stays in the JS heap while the SPA is alive — so
// looping animations resume from where they "would have been" instead of
// restarting from frame 0 when the dashboard navigates back in.
const ATMOSPHERE_EPOCH_MS = Date.now();

// Two concentric aurora ribbons (was four — outermost two dropped per design
// feedback). Each ribbon is a full-round conic gradient at a different
// inset/speed/direction — together they read as overlapping circular light
// streams while staying strictly circular.
const RIBBON_COUNT = 2;
// Golden-ratio scatter constant. Calibration particles use phase = (i * GOLDEN)
// % 1 so each phase is a pure function of the index — when particleCount grows
// (calibProgress climbs), existing particles keep their positions instead of
// snapping to new phase offsets.
const GOLDEN_PHASE = 0.6180339887498949;

interface AtmosphereProps {
  show: boolean;
  showParticles: boolean;
  isCalib: boolean;
  labelRgb: string;
  haloDuration: string;
  haloPeak: number;
  particleCount: number;
  radius: number;
}

// Atmospheric layers — halo, aurora, wisps, core, particles — extracted into
// a memoized subcomponent so they don't re-render when the parent's transient
// state (rotating phrase, day ping, unlock progress) changes. Without this,
// each parent re-render rewrites every particle's inline `animation-delay`,
// which the browser treats as a new animation instance and visibly resets
// the orbital motion. Especially harsh on WebKit/iOS Capacitor.
//
// elapsedSec is captured ONCE at mount via useRef. Existing particles never
// see a changed style across re-renders; only newly-added particles (when
// particleCount grows during calibration) get fresh styles, and they spawn
// at their stable golden-ratio phase positions.
function FightFormRingAtmosphereInner({
  show,
  showParticles,
  isCalib,
  labelRgb,
  haloDuration,
  haloPeak,
  particleCount,
  radius,
}: AtmosphereProps) {
  const elapsedSecRef = useRef((Date.now() - ATMOSPHERE_EPOCH_MS) / 1000);
  const elapsedSec = elapsedSecRef.current;

  if (!show && !showParticles) return null;

  return (
    <>
      {/* Aurora halo — radial glow whose color/intensity/speed track label. */}
      {show && (
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

      {/* Northern-lights ribbons — four concentric conic-gradient layers
          rotating at different speeds + directions. Stays strictly circular
          (no shape warping) for the requested "more circular" look. */}
      {show && (
        <div aria-hidden className="absolute inset-0 pointer-events-none">
          {Array.from({ length: RIBBON_COUNT }).map((_, i) => (
            <span
              key={i}
              className={`ff-ring-ribbon ff-ring-ribbon-${i + 1}`}
              style={{
                ["--ff-halo-rgb" as any]: labelRgb,
                animationDelay: `${-elapsedSec}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* Inner core glow — soft breathing highlight inside the centre. */}
      {show && (
        <div
          aria-hidden
          className="ff-ring-core absolute inset-0 rounded-full pointer-events-none"
          style={{
            ["--ff-halo-rgb" as any]: labelRgb,
            animationDelay: `${-elapsedSec}s`,
          }}
        />
      )}

      {/* Orbital particles. Calibration uses golden-ratio scatter; ok-state
          uses even spacing by index/count. Mixed sizes keep the swarm from
          looking mechanical. */}
      {showParticles && (
        <div aria-hidden className="absolute inset-0 pointer-events-none">
          {Array.from({ length: particleCount }).map((_, i) => {
            const orbitRadius = radius - 4 + ((i % 9) - 4) * 6; // -28..+26 px
            const orbitDuration = 9 + (i % 11) * 0.95;            // 9s..18.5s
            const twinkleDuration = 1.2 + (i % 7) * 0.45;         // 1.2s..3.9s
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
    </>
  );
}

// React.memo with default shallow compare. All props are primitives or
// strings, so memo correctly skips re-renders when only the parent's
// transient state (phraseIdx, dayPing, unlockProgress) has changed.
export const FightFormRingAtmosphere = memo(FightFormRingAtmosphereInner);
