import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import { FightFormRingAtmosphere } from "./FightFormRingAtmosphere";
import { isScoredState, isStaleState } from "@/lib/fightFormState";
import { isNativePlatform } from "@/hooks/useIsNative";

type Props = {
  score: number;
  label: "sharp" | "sharpening" | "off_pace" | "at_risk";
  state: "ok" | "calibrating" | "no_camp" | "paused" | "stale";
  calibratingDays?: { current: number; needed: number };
  // Used to render the ghost arc beyond the cap when a soft ceiling fires:
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
  // Count of days (within the dashboard's rolling window) where the user
  // lit up all five TodayStrip ritual pills. Drives the "Day N completed"
  // animation, fires once each time this number ticks up. Separate from
  // `calibratingDays`, which counts any-signal days for the engine's
  // cold-start gate.
  ritualDaysCount?: number;
  onTap?: () => void;
  size?: number;
  // Data foundation transparency fields.
  // dataConfidence: fraction of pillars with fresh data (0..1).
  // dataAgeDays: how many days since the most recent contributing log.
  // activePillars/totalPillars: drives the confidence track split.
  dataConfidence?: number;
  dataAgeDays?: number;
  activePillars?: number;
  totalPillars?: number;
};

const LABEL_COPY = {
  sharp: "Sharp",
  sharpening: "Sharpening",
  off_pace: "Off Pace",
  at_risk: "At Risk",
};

// RGB triplets used by the core glow + particles + arc gradient so we can
// vary opacity without re-declaring full color values. Matches the palette.
const LABEL_RGB = {
  sharp: "16, 185, 129",       // emerald-500
  sharpening: "251, 191, 36",  // amber-400
  off_pace: "249, 115, 22",    // orange-500
  at_risk: "244, 63, 94",      // rose-500
};

// Deep end of the containment-arc gradient, a darkened version of the active
// colour so the stroke reads as a polished gradient (deep → bright) rather
// than a flat band. Works for tier colours and the calibrating cyan alike.
function deepStop(rgb: string): string {
  const [r, g, b] = rgb.split(",").map((x) => parseInt(x.trim(), 10));
  return `rgb(${Math.round((r || 148) * 0.22)}, ${Math.round((g || 163) * 0.22)}, ${Math.round((b || 184) * 0.22)})`;
}

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

// Calibration "pre-bloom" palette. Cool cyan (sky-400) so the calibrating
// state reads as a distinct phase, then saturates toward the eventual label
// color as days complete. Until then, the ring uses this base.
const CALIB_RGB = "56, 189, 248";
// Density window for the calibration particle field. Floor + ceiling tuned
// to read as a continuous flow (matching sharpening density) rather than a
// sparse marching line, while keeping calibration distinct from sharp.
const CALIB_PARTICLE_MIN = 10;
const CALIB_PARTICLE_MAX = 18;
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

// ---------------------------------------------------------------------------
// Module-scope "resume" cache for the score arc
// ---------------------------------------------------------------------------
// Dashboard is lazy-loaded and fully unmounts on bottom-nav tab switches
// (App.tsx routes via AnimatePresence keyed by location.pathname). When the
// user comes back to /dashboard, the ring component is a brand-new instance:
// without help, the `transition-all duration-700` on the score arc would
// animate from 0 → live score on every visit, perceived as initial lag.
//
// We keep two numbers on the module heap so they survive remounts during
// the SPA session: the last *settled* arc length (`cachedDashLen`) and the
// circumference it was measured against (so we don't paint a stale value
// at a different ring size). The component reads these on first paint to
// render the arc exactly where it left off; the existing CSS transition
// then handles any smooth catch-up to the live score on subsequent frames.
// A page reload clears the cache by re-evaluating the module, which is the
// desired behaviour (cold-start should still play the satisfying fill-in).
let cachedDashLen: number | null = null;
let cachedCircumference: number | null = null;

export function FightFormRing({
  score,
  label,
  state,
  calibratingDays,
  rawScore,
  appliedCeiling,
  phase,
  celebrateSharp,
  ritualDaysCount,
  onTap,
  size = 220,
  dataConfidence: _dataConfidence,
  dataAgeDays,
  activePillars,
  totalPillars,
}: Props) {
  const radius = (size - 20) / 2;
  const circumference = 2 * Math.PI * radius;
  const baseProgress =
    isScoredState(state)
      ? Math.max(0, Math.min(1, score / 100))
      : state === "calibrating" && calibratingDays
        ? Math.max(0, Math.min(1, calibratingDays.current / calibratingDays.needed))
        : 0;

  // Ghost arc: drawn between the clamped score and the raw score the engine
  // would have produced without the soft ceiling. Communicates "you're being
  // capped here" without alarmism, replaces the bottom-sheet-only banner.
  // Uses baseProgress (not the unlock-scaled progress) so the ghost lands
  // at its final position immediately rather than animating with the arc
  // during the brief 1.5s unlock.
  const rawProgress =
    isScoredState(state) && appliedCeiling != null && rawScore != null
      ? Math.max(baseProgress, Math.min(1, rawScore / 100))
      : baseProgress;
  const ghostLen = (rawProgress - baseProgress) * circumference;
  const showGhost = isScoredState(state) && appliedCeiling != null && ghostLen > 0.5;

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

  // Staleness: either explicitly state="stale" or score data is 2+ days old.
  const stale = isStaleState(state) || (dataAgeDays ?? 0) >= 2;

  const showHalo = isScoredState(state) || isCalib;
  // Show the orbital swarm at every scored/calibrating state.
  // Density scales with the label so weaker form gets a thinner field
  // instead of a sudden cut-off. During calibration, density scales with
  // calibProgress so the field literally builds toward unlock.
  // When stale, reduce to off_pace density regardless of actual label.
  const showParticles = isScoredState(state) || isCalib;
  const rawParticleCount =
    isScoredState(state)
      ? stale
        ? PARTICLE_COUNT_BY_LABEL["off_pace"]
        : PARTICLE_COUNT_BY_LABEL[label]
      : isCalib
        ? Math.round(CALIB_PARTICLE_MIN + (CALIB_PARTICLE_MAX - CALIB_PARTICLE_MIN) * calibProgress)
        : 0;
  // iOS: each particle is an absolutely-positioned span running two infinite
  // animations; the swarm can reach 84 dots ("sharp"). WKWebView can't keep up
  // with that many simultaneously-animating layers, so cap the field on native.
  // The orbit reads the same with a denser-looking but cheaper swarm.
  const particleCount = isNativePlatform ? Math.min(rawParticleCount, 14) : rawParticleCount;
  // Active colour drives the core glow, particles, orbital band and the arc
  // gradient: tier colour when scored, cyan while calibrating, slate only as a
  // no-camp/paused fallback. Staleness is conveyed by the dimmed number + the
  // "as of Nd ago" line, NOT by desaturating the ring, so the tier colour
  // (orange / amber / green / rose) always reads correctly.
  const labelRgb =
    isScoredState(state)
      ? LABEL_RGB[label]
      : isCalib
        ? CALIB_RGB
        : "148, 163, 184"; // slate-400 fallback

  // Rotating signal phrase + day-completion ping. Both gated to calibrating
  // so the timers don't run when the ring is in any other state.
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [dayPing, setDayPing] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  // unlockProgress (0..1) drives the score-arc grow + number count-up during
  // the victory lap. Stays at 1 outside of unlock so normal renders aren't
  // gated by it.
  const [unlockProgress, setUnlockProgress] = useState(1);
  // Tracks the last `ritualDaysCount` we saw so we can fire the
  // "Day N completed" animation exactly once when the user finishes a new
  // all-five-pills day. Previously this referenced `calibratingDays.current`
  // (any-signal days), which over-fired the celebration.
  const prevRitualDaysRef = useRef(ritualDaysCount ?? 0);
  const prevStateRef = useRef(state);

  // Containment-arc gradient id (sanitised, useId() contains colons which are
  // invalid inside an SVG url(#...) reference).
  const gradId = `ffgrad-${useId().replace(/:/g, "")}`;
  const glintRef = useRef<SVGCircleElement | null>(null);
  const glintFracRef = useRef(0);

  // Unlock victory lap: fires once when state transitions calibrating→ok.
  // Three beats over ~1500ms, (1) the comet does one accelerating finale
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
    if (prev !== "calibrating" || !isScoredState(state)) return;

    setUnlocking(true);
    setUnlockProgress(0);

    const start = performance.now();
    // Short hold before the arc grows (the old cyan comet finale lived here;
    // the Energy Core hands off straight from the cyan charge arc to the
    // tier-coloured score arc growing from zero).
    const cometFinaleMs = 150;
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

  // Fire the "Day N completed" celebration when the count of fully-logged
  // ritual days ticks up. Runs in any state (ok or calibrating), completing
  // all five pills on a given day deserves the same celebration regardless
  // of whether the engine has unlocked the score yet.
  useEffect(() => {
    const next = ritualDaysCount ?? 0;
    if (next > prevRitualDaysRef.current) {
      setDayPing(true);
      const t = window.setTimeout(() => setDayPing(false), CALIB_DAY_PING_MS);
      prevRitualDaysRef.current = next;
      return () => window.clearTimeout(t);
    }
    prevRitualDaysRef.current = next;
  }, [ritualDaysCount]);

  const calibRemainingDays = isCalib && calibratingDays
    ? Math.max(0, calibratingDays.needed - calibratingDays.current)
    : 0;

  // Apply the unlock progress only to scored-state score arc + number so the
  // calibrating-phase arc isn't accidentally scaled when state===ok/stale arrives.
  const progress = unlocking && isScoredState(state) ? baseProgress * unlockProgress : baseProgress;
  const dash = circumference * progress;
  const displayedScore = unlocking && isScoredState(state) ? Math.round(score * unlockProgress) : score;
  // Glint rides the displayed arc fraction so it follows the unlock grow.
  glintFracRef.current = progress;

  // Score-arc resume, paint the cached dash length on first paint after a
  // remount, then swap to the live `dash` on the next frame. The existing
  // CSS transition tweens the difference (zero-cost if the score hasn't
  // changed). On the very first session mount the cache is null, so we
  // render at 0 and the live dash drives the satisfying initial fill-in.
  const [arcReady, setArcReady] = useState(false);
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setArcReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  // Cache only when the ring is settled, mid-unlock values would be replayed
  // on a remount during that ~1.5s window, which we don't want.
  useEffect(() => {
    if (unlocking) return;
    cachedDashLen = circumference * baseProgress;
    cachedCircumference = circumference;
  }, [baseProgress, circumference, unlocking]);

  // Traveling glint, a short bright streak glides along the FILLED arc on an
  // eased loop with a soft fade-in/out so it never pops. Pure dashoffset +
  // opacity on one element, no blur filter (native-safe). Reads the live arc
  // fraction via a ref so the loop never re-subscribes.
  useEffect(() => {
    const el = glintRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.opacity = "0";
      return;
    }
    const LOOP = 2600;
    let raf = 0;
    const frame = (now: number) => {
      const frac = Math.max(0, Math.min(1, glintFracRef.current));
      if (frac <= 0.03) {
        el.style.opacity = "0";
      } else {
        const filled = circumference * frac;
        const glint = Math.min(circumference * 0.05, filled * 0.45);
        const t = (now % LOOP) / LOOP;
        const travel = 0.5 - 0.5 * Math.cos(t * Math.PI); // easeInOutSine
        const head = glint + travel * (filled - glint);
        el.style.strokeDasharray = `${glint} ${circumference * 2}`;
        el.style.strokeDashoffset = `${-(head - glint)}`;
        const env = Math.min(1, t / 0.16) * Math.min(1, (1 - t) / 0.16);
        el.style.opacity = (0.8 * env).toFixed(3);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [circumference]);
  const renderedDash = arcReady
    ? dash
    : cachedDashLen != null && cachedCircumference === circumference
      ? cachedDashLen
      : 0;
  // Outer ring treatment per camp phase. Build gets no extra border so the
  // hero ring stays clean during the bulk of camp; Peak adds a dashed orbit;
  // Fight Week pulses a faint colored outline so the user sees the weeks-to-
  // fight transition in the dashboard itself, not buried in copy.
  const showPhasePeak = isScoredState(state) && phase === "peak";
  const showPhaseFightWeek = isScoredState(state) && phase === "fightWeek";
  const phaseRadius = radius + 5;

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
      {/* All atmospheric layers (aurora, halo, wisps, core, particles) live
          in a memoized subcomponent so they stay decoupled from this parent
          ring's transient re-renders (phrase ticks, day-ping toggles, unlock
          progress). Without this, every inline animationDelay rewrite was
          re-anchoring the CSS animations and visibly resetting the swarm. */}
      <FightFormRingAtmosphere
        show={showHalo}
        showParticles={showParticles}
        isCalib={isCalib}
        labelRgb={labelRgb}
        fraction={baseProgress}
        particleCount={particleCount}
        size={size}
        radius={radius}
      />

      <svg width={size} height={size} className="-rotate-90 relative">
        <defs>
          {/* Containment-arc gradient: deep → bright in the active colour. */}
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={deepStop(labelRgb)} />
            <stop offset="100%" stopColor={`rgb(${labelRgb})`} />
          </linearGradient>
        </defs>
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

        {/* Track, breathes slowly while calibrating to signal active scanning.
            In scored states with a partial pillar fraction, the track is split:
            solid for active fraction, dashed/faded for missing fraction.
            Only rendered as a split when scored (ok/stale) and f < 1.
            Calibrating state uses the original single track + comet. */}
        {isScoredState(state) && (() => {
          const f = (totalPillars && totalPillars > 0)
            ? Math.min(1, (activePillars ?? totalPillars) / totalPillars)
            : 1;
          const showSplit = f < 1;
          if (!showSplit) {
            return (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke="hsl(var(--muted))"
                strokeWidth={10}
                fill="none"
              />
            );
          }
          // Split track: solid segment for active fraction, dashed faded for missing.
          const activeLen = f * circumference;
          const missingLen = (1 - f) * circumference;
          // Build a "2 on / 4 off" dash pattern that spans ONLY the missing
          // fraction, then a full-circumference gap so the repeat never wraps
          // back into the solid zone. (A bare "2 4" tiles the whole circle.)
          const dashCount = Math.max(1, Math.floor(missingLen / 6));
          const missingDashArray = `${Array.from({ length: dashCount }, () => "2 4").join(" ")} 0 ${circumference}`;
          return (
            <>
              {/* Solid segment, active pillar fraction */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke="hsl(var(--muted))"
                strokeWidth={10}
                fill="none"
                strokeLinecap="butt"
                strokeDasharray={`${activeLen} ${circumference}`}
              />
              {/* Dashed faded segment, missing pillar fraction */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke="hsl(var(--muted-foreground) / 0.25)"
                strokeWidth={10}
                fill="none"
                strokeLinecap="butt"
                strokeDasharray={missingDashArray}
                strokeDashoffset={`${-activeLen}`}
              />
            </>
          );
        })()}
        {/* Track for calibrating/other states */}
        {!isScoredState(state) && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={isCalib ? "hsl(var(--muted-foreground))" : "hsl(var(--muted))"}
            strokeWidth={10}
            fill="none"
            className={isCalib ? "ff-ring-calib-track" : undefined}
          />
        )}
        {/* Ghost arc, what the user WOULD have scored without the cap.
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
        {/* Containment arc, `renderedDash` resumes from the module-cached
            value on remount, then the duration-700 transition tweens to the
            live `dash`. Gradient stroke (deep → bright active colour), always
            the tier/calibration colour, never slate. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={10}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${renderedDash} ${circumference}`}
          stroke={`url(#${gradId})`}
          className="transition-all duration-700"
        />
        {/* Traveling glint, bright streak gliding along the filled arc (its
            dashoffset/opacity are driven by the rAF loop above). */}
        <circle
          ref={glintRef}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#ffffff"
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
          opacity={0}
          style={{ pointerEvents: "none" }}
        />
      </svg>

      {/* Lock glyph at the cap boundary. Lives outside the rotated SVG so
          its orientation stays upright regardless of the cap position.
          Styled as a glowing amber bead so it reads as a member of the
          ring's ember palette rather than a foreign UI chip, radial
          gradient gives it depth, the soft outer shadow ties it back
          into the spark atmosphere around the arc. */}
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
          <div
            className="flex items-center justify-center rounded-full"
            style={{
              width: 14,
              height: 14,
              background:
                "radial-gradient(circle at 35% 28%, rgba(254, 215, 170, 0.85) 0%, rgba(251, 146, 60, 0.98) 48%, rgba(154, 52, 18, 1) 100%)",
              boxShadow:
                "0 0 10px 1px rgba(251, 146, 60, 0.55), 0 0 0 0.5px rgba(254, 215, 170, 0.4), inset 0 -0.5px 1px rgba(0, 0, 0, 0.45)",
            }}
          >
            <Icon name="lockClosedOutline" size={8} className="text-background/85" />
          </div>
        </div>
      )}

      {/* Legibility scrim, a soft dark disc that keeps the score number
          crisp over the core glow without a hard edge. */}
      <div
        aria-hidden
        className="absolute pointer-events-none rounded-full"
        style={{
          width: radius * 1.15,
          height: radius * 1.15,
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(closest-side, rgba(2,4,8,0.6), rgba(2,4,8,0.28) 56%, transparent 80%)",
        }}
      />

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {isScoredState(state) && (
          <>
            <span
              className={cn(
                "display-number text-5xl",
                stale && "opacity-60",
              )}
            >
              {displayedScore}
            </span>
            <span
              className={cn(
                "section-header mt-1",
                unlocking && unlockProgress < 0.4 && "opacity-0",
                stale && "opacity-60",
              )}
            >
              {LABEL_COPY[label]}
            </span>
            {(dataAgeDays ?? 0) >= 2 && (
              <span className="text-[10px] text-muted-foreground mt-0.5">
                as of {dataAgeDays}d ago
              </span>
            )}
          </>
        )}
        {state === "calibrating" && (
          <div className="flex flex-col items-center gap-1.5 max-w-[170px] text-center">
            {calibratingDays && (
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
                Day {Math.min(calibratingDays.current, calibratingDays.needed)} of {calibratingDays.needed}
              </span>
            )}
            {dayPing && ritualDaysCount != null ? (
              <span
                key={`ping-${ritualDaysCount}`}
                className="display-number text-2xl text-func-recovery-green ff-ring-calib-ping"
              >
                Day {ritualDaysCount} completed ✓
              </span>
            ) : calibRemainingDays === 0 ? (
              // Final stage. The score is moments away, drop the rotating
              // signal feed and use a calmer two-line stack so the long
              // copy fits the ring without the bulky 22px headline. Dots are
              // positioned absolutely outside the text so "your first score"
              // centers under "Computing" without being pushed off-center.
              <div className="flex flex-col items-center leading-tight">
                <span
                  className="display-number text-lg"
                  style={{ color: `rgb(${CALIB_RGB})` }}
                >
                  Computing
                </span>
                <span className="relative mt-1 text-[11px] tracking-wide text-muted-foreground">
                  your first score
                  <span aria-hidden className="absolute left-full top-0 pl-0.5">
                    <span className="ff-ring-calib-dot" style={{ animationDelay: "0s" }}>.</span>
                    <span className="ff-ring-calib-dot" style={{ animationDelay: "0.35s" }}>.</span>
                    <span className="ff-ring-calib-dot" style={{ animationDelay: "0.7s" }}>.</span>
                  </span>
                </span>
              </div>
            ) : (
              <>
                <span className="display-number text-[22px] leading-tight">
                  {calibRemainingDays === 1 ? (
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
            <span className="display-number text-3xl">-</span>
            <span className="section-header mt-1">Paused</span>
          </>
        )}
      </div>
    </button>
  );
}
