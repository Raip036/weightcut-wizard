// WP — ProtocolCountdownAnchor
// The "weigh-in pivot" anchor that sits at the very top of the protocol
// page. The whole flow hinges on the weigh-in, so the countdown is the
// emotional hook: a big number that turns urgent (red) as it approaches
// zero and flips to "Weigh-in today" on the day itself.
import { motion, useReducedMotion } from "motion/react";

interface ProtocolCountdownAnchorProps {
  daysToWeighIn: number;
  /** Pre-formatted weigh-in date, e.g. "Sat, Jul 4". Optional. */
  dateLabel?: string | null;
}

export function ProtocolCountdownAnchor({
  daysToWeighIn,
  dateLabel,
}: ProtocolCountdownAnchorProps) {
  const prefersReduced = useReducedMotion();
  const isToday = daysToWeighIn <= 0;
  const urgent = daysToWeighIn <= 3;
  const numberTone = urgent ? "text-func-danger-red" : "text-foreground";
  const labelTone = urgent
    ? "text-func-danger-red/90"
    : "text-muted-foreground/70";

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReduced ? 0 : 0.3, ease: "easeOut" }}
      className="text-center pt-1"
    >
      <p
        className={`text-[10px] font-bold uppercase tracking-[0.2em] ${labelTone}`}
      >
        Weigh-in countdown
      </p>
      {isToday ? (
        <p
          className={`display-number mt-1 text-[34px] font-extrabold leading-none tracking-tight ${numberTone}`}
        >
          Weigh-in today
        </p>
      ) : (
        <p
          className={`display-number mt-1 text-[56px] font-extrabold leading-none tabular-nums ${numberTone}`}
        >
          {daysToWeighIn}
        </p>
      )}
      <p className="mt-1.5 text-[13px] font-medium text-muted-foreground">
        {isToday
          ? "The hinge of your whole cut"
          : `days to weigh-in${dateLabel ? ` · ${dateLabel}` : ""}`}
      </p>
    </motion.div>
  );
}
