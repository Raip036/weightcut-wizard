import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { charIntervalMs } from "./typewriter";
import type { VoicePace } from "./types";

interface TypewriterTextProps {
  text: string;
  pace?: VoicePace;
  forceComplete: boolean;
  onComplete: () => void;
  onTick?: (revealedSoFar: string) => void;
}

export function TypewriterText({
  text,
  pace,
  forceComplete,
  onComplete,
  onTick,
}: TypewriterTextProps) {
  const prefersReduced = useReducedMotion();
  const [count, setCount] = useState(0);
  const completedRef = useRef(false);

  // Hold the latest callbacks in refs so the reveal effect doesn't list them
  // as deps (and therefore doesn't tear down / restart the loop) when the
  // parent re-renders with fresh callback identities.
  const onCompleteRef = useRef(onComplete);
  const onTickRef = useRef(onTick);
  onCompleteRef.current = onComplete;
  onTickRef.current = onTick;

  // A SINGLE requestAnimationFrame loop drives the reveal: `count` is derived
  // from elapsed time rather than incremented by a per-character setTimeout.
  // This runs the effect once per step (not once per character), removes the
  // per-char timer teardown, and self-corrects after a dropped frame — the
  // old approach committed ~70 React renders/sec and re-armed a timer on every
  // single character, which is the main "heavy while typing" cost on iOS.
  useEffect(() => {
    completedRef.current = false;
    setCount(0);

    const finish = () => {
      setCount(text.length);
      if (!completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current();
      }
    };

    if (prefersReduced || forceComplete || text.length === 0) {
      finish();
      return;
    }

    const ms = charIntervalMs(pace);
    let raf = 0;
    let start = 0;
    let last = 0;
    const tick = (now: number) => {
      if (start === 0) start = now;
      const next = Math.min(Math.floor((now - start) / ms), text.length);
      if (next !== last) {
        last = next;
        setCount(next);
        onTickRef.current?.(text.slice(0, next));
      }
      if (next >= text.length) {
        if (!completedRef.current) {
          completedRef.current = true;
          onCompleteRef.current();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, pace, forceComplete, prefersReduced]);

  const isTyping = count < text.length;
  return (
    <span className="relative inline-block w-full align-baseline">
      <span aria-hidden className="invisible whitespace-pre-wrap">{text}</span>
      <span className="absolute inset-0 whitespace-pre-wrap">
        {text.slice(0, count)}
        {isTyping && !prefersReduced && (
          <span className="inline-block w-[2px] h-[1em] align-[-0.15em] ml-[1px] bg-current animate-pulse" />
        )}
      </span>
    </span>
  );
}
