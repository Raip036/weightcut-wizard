// Consolidated, low-key safety footer for the Weight Protocol page.
//
// Replaces the per-step tinted warning BOXES (the red critical banner, the
// red "Do not" card, and the amber compact "stop immediately" notice) with a
// single borderless, background-less block pinned at the BOTTOM of the page.
// Smaller text, red section titles + an amber stop-immediately line, and NO
// fills/borders — calmer and out of the way while staying visible at the
// point of use. Pure presentational; the page supplies the data.
export interface ProtocolSafetyFooterProps {
  /** Highest-severity safety warning, if any (title already humanized). */
  critical?: { title: string; message: string } | null;
  /** Stark "do not" list from the rehydration payload. */
  doNots?: string[];
  className?: string;
}

const STOP_COPY =
  "Stop immediately if you feel dizzy, faint, confused, nauseous, or unwell.";

export function ProtocolSafetyFooter({
  critical,
  doNots = [],
  className = "",
}: ProtocolSafetyFooterProps) {
  const hasDoNots = doNots.length > 0;

  return (
    <div className={`mt-6 px-1 space-y-3.5 ${className}`}>
      {/* Critical safety warning — red title, plain body, no box. */}
      {critical && (
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-func-danger-red mb-1">
            {critical.title}
          </p>
          <p className="text-[11.5px] leading-snug text-muted-foreground/75">
            {critical.message}
          </p>
        </div>
      )}

      {/* "Do not" list — red title, plain bullets, no box. */}
      {hasDoNots && (
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-func-danger-red mb-1.5">
            Do not
          </p>
          <ul className="space-y-1">
            {doNots.map((item, i) => (
              <li
                key={i}
                className="flex gap-2 text-[11.5px] leading-snug text-muted-foreground/75"
              >
                <span
                  aria-hidden="true"
                  className="text-func-danger-red/70 leading-none mt-[2px] select-none"
                >
                  •
                </span>
                <span className="flex-1">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Medical "stop immediately" — amber/orange text, no box. */}
      <p className="text-[11px] leading-snug text-func-warning-yellow/90">
        {STOP_COPY}
      </p>
    </div>
  );
}
