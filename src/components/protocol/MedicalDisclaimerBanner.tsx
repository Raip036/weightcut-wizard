// MedicalDisclaimerBanner
//
// App Store compliance (Apple Guideline 1.4.1): a PERSISTENT medical
// disclaimer that must be visible at the point a user views any
// dehydration / weight-cut protocol — not buried in Settings. This banner
// is always shown on plan / protocol surfaces, for EVERY plan (not just
// extreme cuts).
//
// It is intentionally distinct from the RED critical `SafetyWarningBanner`:
// that one is an assertive alert that only fires for dangerous cuts, while
// this is a calm, amber, always-on informational notice. The two coexist —
// the critical banner stacks above this one when present.
//
// Copy is derived from the canonical legal disclaimer in
// `src/pages/Legal.tsx` (§2 Medical Disclaimer) so wording stays consistent
// across the app.
//
// Variants:
//   - "banner"  → full top-of-page notice (title + body). Default.
//   - "compact" → slim one-liner for inline placement next to a specific
//                 heat / sauna instruction.
//
// Lightweight for iOS: no backdrop-filter / blur (the app strips those on
// native). Plain border + faint tint over the dark background.
import { useCallback, useEffect, useState } from "react";
import { Info, ShieldAlert } from "lucide-react";

export type MedicalDisclaimerVariant = "banner" | "compact";

export interface MedicalDisclaimerBannerProps {
  /** "banner" = full notice (default); "compact" = inline one-liner. */
  variant?: MedicalDisclaimerVariant;
  className?: string;
}

// Canonical copy, mirrored from Legal.tsx §2.
const TITLE = "Educational guidance only, not medical advice";
const BODY =
  "Consult a physician or sports dietitian before cutting weight. Stop and seek medical help if you feel dizzy, faint, confused, nauseous, or unwell.";
const COMPACT_COPY =
  "Stop immediately if you feel dizzy, faint, confused, nauseous, or unwell.";

// Amber/info tone — calm and persistent, visually separate from the red
// critical banner. `func-warning-yellow` is the project's amber token.
const AMBER_BORDER = "border-func-warning-yellow/35";
const AMBER_TINT = "bg-func-warning-yellow/[0.04]";
const AMBER_TEXT = "text-func-warning-yellow";

/**
 * Persistent medical disclaimer banner.
 *
 * Pure presentational. Render once near the top of any plan/protocol view
 * (variant="banner"), and inline next to heat/sauna instructions
 * (variant="compact").
 */
export function MedicalDisclaimerBanner({
  variant = "banner",
  className = "",
}: MedicalDisclaimerBannerProps) {
  if (variant === "compact") {
    return (
      <div
        role="note"
        className={`flex items-start gap-1.5 rounded-2xl border ${AMBER_BORDER} ${AMBER_TINT} px-2.5 py-1.5 ${className}`}
      >
        <span className={`mt-[1px] shrink-0 ${AMBER_TEXT}`}>
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
        </span>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {COMPACT_COPY}
        </p>
      </div>
    );
  }

  return (
    <div
      // Polite status region — informational, never interrupts the screen
      // reader the way the red critical alert does.
      role="note"
      aria-label="Medical disclaimer"
      className={`card-surface rounded-2xl border ${AMBER_BORDER} ${AMBER_TINT} p-2.5 ${className}`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-[1px] flex shrink-0 ${AMBER_TEXT}`}>
          <Info className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className={`text-[12px] font-semibold leading-tight ${AMBER_TEXT}`}>
            {TITLE}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
            {BODY}
          </p>
        </div>
      </div>
    </div>
  );
}

// localStorage key for the one-time first-view acknowledgement. Mirrors the
// project's `wcw_*` flag convention (see Onboarding / CutPlanReview flags).
const ACK_STORAGE_KEY = "wcw_medical_disclaimer_ack";

/** Read the persisted acknowledgement flag (SSR / private-mode safe). */
function readAck(): boolean {
  try {
    return localStorage.getItem(ACK_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export interface MedicalDisclaimerAckProps {
  /** Extra classes for the outer wrapper. */
  className?: string;
}

/**
 * First-view acknowledgement gate.
 *
 * The first time a user views a generated protocol, this renders the full
 * disclaimer banner plus an "I understand" button. Tapping it persists the
 * acknowledgement (localStorage), after which this component renders the
 * passive banner only — it never blocks a user who has already acknowledged.
 *
 * It is deliberately non-modal / non-blocking: the rest of the page stays
 * scrollable underneath. The page should still render its own passive
 * `MedicalDisclaimerBanner` separately if it wants the notice to persist in a
 * specific slot; this component is the acknowledgement-aware top placement.
 */
export function MedicalDisclaimerAck({ className = "" }: MedicalDisclaimerAckProps) {
  // Initialise from storage so an already-acknowledged user never sees the
  // button flash on mount.
  const [acknowledged, setAcknowledged] = useState<boolean>(() => readAck());

  // Defensive re-sync in case storage was written elsewhere between renders
  // (e.g. a parallel tab / route). Runs once on mount.
  useEffect(() => {
    if (!acknowledged && readAck()) setAcknowledged(true);
  }, [acknowledged]);

  const handleAcknowledge = useCallback(() => {
    try {
      localStorage.setItem(ACK_STORAGE_KEY, "true");
    } catch {
      /* private-mode / storage pressure — non-fatal, just dismiss for now. */
    }
    setAcknowledged(true);
  }, []);

  // Already acknowledged → passive banner only.
  if (acknowledged) {
    return <MedicalDisclaimerBanner variant="banner" className={className} />;
  }

  return (
    <div
      role="note"
      aria-label="Medical disclaimer, please acknowledge"
      className={`card-surface rounded-2xl border ${AMBER_BORDER} ${AMBER_TINT} p-2.5 ${className}`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-[1px] flex shrink-0 ${AMBER_TEXT}`}>
          <Info className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className={`text-[12px] font-semibold leading-tight ${AMBER_TEXT}`}>
            {TITLE}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
            {BODY}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={handleAcknowledge}
        className={`mt-2.5 w-full rounded-2xl border ${AMBER_BORDER} bg-func-warning-yellow/10 px-4 py-2 text-[12px] font-semibold ${AMBER_TEXT} active:scale-[0.98] transition-transform`}
      >
        I understand
      </button>
    </div>
  );
}
