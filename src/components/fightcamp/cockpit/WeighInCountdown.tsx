import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";

/**
 * Live countdown to weigh-in, sized for a cockpit header.
 *
 * Behaviour by distance to weigh-in:
 *  - More than LIVE_THRESHOLD_HOURS out (≈48h): static "Xd to weigh-in"
 *    derived from `daysToWeighIn` (no per-second work needed that far out).
 *  - Within ≈48h AND we have a real `weighInDateISO`: a live ticking
 *    countdown that updates every second. Shows D/H/M while ≥1h remains,
 *    and HH:MM:SS once under an hour, so the granularity matches urgency.
 *  - Day count 0 (and not in the live window): "Weigh-in today".
 *  - Past the weigh-in time: "Weigh-in time" (the clock has hit zero).
 *
 * Renders null only when there is neither a date nor a day count.
 */

/** Switch from the static "Xd" label to the live ticking clock at ~48h out. */
const LIVE_THRESHOLD_MS = 48 * 60 * 60 * 1000;
/** Below this remaining time, show a tiny pulsing urgency dot (<24h). */
const PULSE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
/** Below this, drop the day/hour/minute split for a precise HH:MM:SS clock. */
const SECONDS_THRESHOLD_MS = 60 * 60 * 1000;

interface WeighInCountdownProps {
  /** ISO date string of weigh-in/fight, or null if unknown. */
  weighInDateISO: string | null;
  /** Precomputed days to weigh-in; used as a fallback when not ticking live. */
  daysToWeighIn: number | null;
  className?: string;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function WeighInCountdown({
  weighInDateISO,
  daysToWeighIn,
  className,
}: WeighInCountdownProps): JSX.Element | null {
  const prefersReduced = useReducedMotion();

  // Parse the target once; treat an unparseable string as "no date".
  const targetMs = useMemo(() => {
    if (!weighInDateISO) return null;
    const parsed = new Date(weighInDateISO).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }, [weighInDateISO]);

  // We only need a live clock when a valid target is within the live window.
  // Probe once on mount (before deciding to attach the interval) so the very
  // first render already reflects whether we're in the ticking regime.
  const [now, setNow] = useState(() => Date.now());

  const initialRemaining = targetMs == null ? null : targetMs - Date.now();
  const isLiveWindow =
    initialRemaining != null && initialRemaining <= LIVE_THRESHOLD_MS;

  useEffect(() => {
    if (!isLiveWindow) return;
    // Tick every second; sync `now` so the displayed remaining time recomputes.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLiveWindow, targetMs]);

  // Nothing to show at all.
  if (targetMs == null && daysToWeighIn == null) return null;

  const remaining = targetMs == null ? null : targetMs - now;
  const showLive = remaining != null && remaining <= LIVE_THRESHOLD_MS;

  const label = (
    <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70">
      to weigh-in
    </span>
  );

  // --- Far out: static day count -----------------------------------------
  if (!showLive) {
    // Prefer the precomputed day count this far out.
    const days = daysToWeighIn ?? (remaining != null
      ? Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)))
      : null);

    if (days == null) return null;

    if (days <= 0) {
      return (
        <div
          className={`inline-flex items-center gap-1.5 ${className ?? ""}`}
          aria-label="Weigh-in today"
        >
          <span className="display-number text-[12px] text-foreground">
            Weigh-in
          </span>
          <span className="text-[11px] text-muted-foreground/80">today</span>
        </div>
      );
    }

    return (
      <div
        className={`inline-flex items-baseline gap-1 ${className ?? ""}`}
        aria-label={`${days} days to weigh-in`}
      >
        <span className="display-number text-[12px] text-foreground tabular-nums">
          {days}d
        </span>
        {label}
      </div>
    );
  }

  // --- Live window: ticking clock ----------------------------------------
  const safeRemaining = Math.max(0, remaining);

  if (safeRemaining <= 0) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 ${className ?? ""}`}
        aria-label="Weigh-in time"
      >
        <span className="display-number text-[12px] text-func-danger-red tabular-nums">
          00:00
        </span>
        {label}
      </div>
    );
  }

  const totalSeconds = Math.floor(safeRemaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const underHour = safeRemaining < SECONDS_THRESHOLD_MS;
  const showPulse = safeRemaining < PULSE_THRESHOLD_MS;

  // <1h → HH:MM:SS so the final stretch reads precisely.
  // ≥1h → D H M (drop the day part once we're under a day).
  const value = underHour
    ? `${pad(minutes)}:${pad(seconds)}`
    : days > 0
      ? `${days}d ${pad(hours)}:${pad(minutes)}`
      : `${pad(hours)}:${pad(minutes)}`;

  const ariaLabel = underHour
    ? `${minutes} minutes ${seconds} seconds to weigh-in`
    : days > 0
      ? `${days} days ${hours} hours ${minutes} minutes to weigh-in`
      : `${hours} hours ${minutes} minutes to weigh-in`;

  return (
    <div
      className={`inline-flex items-center gap-1.5 ${className ?? ""}`}
      aria-label={ariaLabel}
    >
      {showPulse && (
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full bg-func-danger-red ${
            prefersReduced ? "" : "animate-pulse"
          }`}
          aria-hidden
        />
      )}
      <span
        className={`display-number text-[12px] tabular-nums ${
          showPulse ? "text-func-danger-red" : "text-foreground"
        }`}
      >
        {value}
      </span>
      {label}
    </div>
  );
}
