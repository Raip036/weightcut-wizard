import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

/**
 * CoachThinkingState — a richer "coach is analysing your numbers" loading
 * state shown in place of generic typing dots while a coach action is in
 * flight. Reuses the Fight Form ring's calibration aesthetic: a row of
 * staggered dots (.ff-ring-calib-dot) plus a status line that crossfades
 * from below (.ff-ring-calib-phrase) as it rotates through coach-flavoured
 * phrases.
 *
 * Honors prefers-reduced-motion: when reduced, the rotation/crossfade stop
 * and a single static "Analysing your numbers..." line is shown.
 */

// Rotation cadence, matching the calm pace of the ring's signal feed.
const PHRASE_INTERVAL_MS = 1400;

const THINKING_PHRASES = [
  "Reading your weigh-ins...",
  "Checking your training load...",
  "Crunching your cut pace...",
  "Reviewing fight week...",
] as const;

const REDUCED_PHRASE = "Analysing your numbers...";

export function CoachThinkingState({ className }: { className?: string }): JSX.Element {
  const prefersReduced = useReducedMotion();
  const [phraseIdx, setPhraseIdx] = useState(0);

  // Rotate the status line on a fixed cadence. Skipped entirely when the
  // user prefers reduced motion so no timer runs and the line stays static.
  // Interval is always cleared on unmount / dependency change.
  useEffect(() => {
    if (prefersReduced) return;
    const id = window.setInterval(() => {
      setPhraseIdx((i) => (i + 1) % THINKING_PHRASES.length);
    }, PHRASE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [prefersReduced]);

  const phrase = prefersReduced ? REDUCED_PHRASE : THINKING_PHRASES[phraseIdx];

  return (
    <div
      className={`flex flex-col items-start gap-1.5 ${className ?? ""}`}
      role="status"
      aria-live="polite"
      aria-label="Coach is analysing your numbers"
    >
      {/* Pulsing indicator. Staggered dots when motion is allowed; a single
          subtle pulse dot when reduced so there's still a sign of life. */}
      {prefersReduced ? (
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-pulse"
        />
      ) : (
        <span aria-hidden className="inline-flex items-center gap-1 text-muted-foreground">
          <span className="ff-ring-calib-dot text-base leading-none" style={{ animationDelay: "0s" }}>
            .
          </span>
          <span className="ff-ring-calib-dot text-base leading-none" style={{ animationDelay: "0.18s" }}>
            .
          </span>
          <span className="ff-ring-calib-dot text-base leading-none" style={{ animationDelay: "0.36s" }}>
            .
          </span>
        </span>
      )}

      {/* Status line. Re-keyed on phraseIdx so the .ff-ring-calib-phrase
          fade-from-below fires once per rotation, matching the ring. */}
      <span
        key={`coach-thinking-${prefersReduced ? "static" : phraseIdx}`}
        className={`text-[12px] tracking-wide text-muted-foreground${
          prefersReduced ? "" : " ff-ring-calib-phrase"
        }`}
      >
        {phrase}
      </span>
    </div>
  );
}
