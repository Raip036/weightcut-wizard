import { useState, useRef, type ChangeEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ChevronLeft, X, Droplets, Utensils, Scale, Trophy, PenLine, Loader2, type LucideIcon } from "lucide-react";
import { triggerHapticSelection } from "@/lib/haptics";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";
import { WizardCharacter } from "@/tutorial/WizardCharacter";

/**
 * Wrap-up reflection as a focused, one-field-per-screen stepper rendered as a
 * FULL-SCREEN overlay (own portal), not a bottom sheet.
 *
 * Why full-screen: as a bottom sheet the iOS keyboard "morphed" the panel —
 * the sheet's bottom is pinned to the keyboard inset, so opening the keyboard
 * yanked the whole card up and squashed the layout. A full-screen overlay
 * keeps the active input naturally in the upper-middle of the viewport (well
 * above the keyboard), so the keyboard can never reshape the panel. The footer
 * is lifted by `--keyboard-inset` so the primary CTA stays reachable.
 *
 * Theme: the premium wizard blue aurora (shared WizardAuroraBackground +
 * mascot), animated, matching the Pro gate / welcome cutscene look.
 *
 * The component owns the field values locally and hands them back via
 * `onComplete` on the last step; `onSkip` finishes the camp without a
 * reflection; `onCancel` (the top-right X) abandons the wrap-up entirely so
 * the camp is NOT completed and the user returns to where they were.
 */
export interface WrapUpValues {
  endWeight: string;
  dehydrationKg: string;
  dietKg: string;
  performance: string;
  notes: string;
}

interface WrapUpStepperProps {
  saving: boolean;
  onComplete: (values: WrapUpValues) => void;
  onSkip: () => void;
  /** Top-right X — cancels the whole wrap-up; camp stays as-is. */
  onCancel: () => void;
}

// Outcome ids mirror the camp schema's `performanceFeeling` values exactly.
const OUTCOMES: { id: string; label: string }[] = [
  { id: "won_strong", label: "Won, felt strong" },
  { id: "won_drained", label: "Won, drained" },
  { id: "lost_strong", label: "Lost, felt strong" },
  { id: "lost_drained", label: "Lost, drained" },
  { id: "no_show", label: "Didn't compete" },
];

type StepDef =
  | { kind: "num" | "text"; icon: LucideIcon; q: string; help: string; field: keyof WrapUpValues; ph: string }
  | { kind: "chip"; icon: LucideIcon; q: string; help: string };

const STEPS: StepDef[] = [
  { kind: "num", icon: Scale, q: "What did you weigh on fight day?", help: "Your scale weight at weigh-in.", field: "endWeight", ph: "73.5" },
  { kind: "num", icon: Droplets, q: "How much came off via water cut?", help: "Sauna, sweat, dehydration.", field: "dehydrationKg", ph: "2.4" },
  { kind: "num", icon: Utensils, q: "And how much via diet?", help: "Carbs, fibre, sodium.", field: "dietKg", ph: "1.8" },
  { kind: "chip", icon: Trophy, q: "How did it go?", help: "Pick the one that fits best." },
  { kind: "text", icon: PenLine, q: "Anything to remember for next time?", help: "Optional, totally fine to skip.", field: "notes", ph: "What worked? What to change?" },
];
const TOTAL = STEPS.length;

export function WrapUpStepper({ saving, onComplete, onSkip, onCancel }: WrapUpStepperProps) {
  const prefersReduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [values, setValues] = useState<WrapUpValues>({
    endWeight: "",
    dehydrationKg: "",
    dietKg: "",
    performance: "",
    notes: "",
  });
  const inputRef = useRef<HTMLInputElement>(null);

  const cur = STEPS[step];
  const isLast = step === TOTAL - 1;
  const setField = (f: keyof WrapUpValues, v: string) => setValues((p) => ({ ...p, [f]: v }));

  const advance = () => {
    if (saving) return;
    triggerHapticSelection();
    if (isLast) onComplete(values);
    else {
      setDir(1);
      setStep((s) => s + 1);
    }
  };
  const back = () => {
    if (step === 0) return;
    setDir(-1);
    setStep((s) => Math.max(0, s - 1));
  };
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      advance();
    }
  };

  // Mascot leans in to point on the final (optional notes) beat, otherwise idle.
  const pose = isLast ? "point" : "idle";

  const overlay = (
    <div
      className="fixed inset-0 z-[9999] flex flex-col overflow-hidden text-white"
      style={{
        // Cosmic blue vignette — matches the welcome cutscene / Pro gate shell.
        background:
          "radial-gradient(ellipse at 50% 22%, rgba(30, 42, 78, 0.82) 0%, rgba(10, 12, 22, 0.96) 56%, #020207 100%)",
        // Lift the whole stack above the keyboard so the footer CTA stays
        // reachable; the body absorbs the squeeze via overflow-y-auto.
        paddingBottom: "var(--keyboard-inset, 0px)",
        transition: "padding-bottom 300ms ease-out",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Wrap up your camp"
    >
      <WizardAuroraBackground radialGlow />

      {/* Top bar — back (left) · progress dots (center) · cancel X (right) */}
      <div
        className="relative z-20 flex items-center gap-3 px-5"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
      >
        <button
          onClick={back}
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/80 transition ${step === 0 ? "invisible" : "active:scale-95"}`}
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-1 items-center justify-center gap-2">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <motion.span
              key={i}
              animate={{ width: i === step ? 22 : 7, opacity: i <= step ? 1 : 0.3 }}
              className={`h-[7px] rounded-full ${i <= step ? "bg-primary" : "bg-white/30"}`}
            />
          ))}
        </div>
        <button
          onClick={onCancel}
          disabled={saving}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/80 transition active:scale-95 disabled:opacity-40"
          aria-label="Cancel"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Mascot — small, sits above the question. Hidden when the keyboard is
          open on short screens via the body's scroll absorbing the squeeze. */}
      <div className="relative z-10 mt-1 flex shrink-0 justify-center">
        <div className="relative flex items-center justify-center" style={{ width: 104, height: 104 }}>
          <div className="absolute inset-0 flex items-center justify-center scale-[0.74] origin-center">
            <WizardCharacter pose={pose} />
          </div>
        </div>
      </div>

      {/* Body — one centered field per step. `min-h-0 overflow-y-auto` lets the
          body absorb any squeeze when the keyboard is open; `m-auto` centres
          the field while staying scroll-safe. */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 text-center">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ opacity: 0, x: dir * 36 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -36 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="m-auto flex w-full flex-col items-center"
          >
            <h2 className="text-[24px] font-bold leading-snug tracking-tight text-white">{cur.q}</h2>
            <p className="mt-2 max-w-[18rem] text-sm text-white/55">{cur.help}</p>

            {cur.kind === "num" && (
              <div className="mt-8 w-full">
                <div className="flex items-end justify-center gap-1.5" onClick={() => inputRef.current?.focus()}>
                  <span className={`display-number text-6xl font-bold tabular-nums tracking-tight ${values[cur.field] ? "text-white" : "text-white/25"}`}>
                    {values[cur.field] || cur.ph}
                  </span>
                  <span className="pb-2 text-xl font-semibold text-white/45">kg</span>
                </div>
                <input
                  ref={inputRef}
                  value={values[cur.field]}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setField(cur.field, e.target.value.replace(/[^0-9.]/g, ""))}
                  onKeyDown={onEnter}
                  inputMode="decimal"
                  placeholder={cur.ph}
                  className="mt-5 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3.5 text-center text-base text-white outline-none transition placeholder:text-white/30 focus:border-primary/70"
                />
              </div>
            )}

            {cur.kind === "text" && (
              <input
                ref={inputRef}
                value={values[cur.field]}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setField(cur.field, e.target.value)}
                onKeyDown={onEnter}
                placeholder={cur.ph}
                className="mt-8 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3.5 text-center text-base text-white outline-none transition placeholder:text-white/30 focus:border-primary/70"
              />
            )}

            {cur.kind === "chip" && (
              <div className="mt-8 grid w-full grid-cols-2 gap-2.5">
                {OUTCOMES.map((o) => {
                  const active = values.performance === o.id;
                  const wide = o.id === "no_show";
                  return (
                    <button
                      key={o.id}
                      onClick={() => {
                        triggerHapticSelection();
                        setField("performance", o.id);
                        window.setTimeout(() => { setDir(1); setStep((s) => s + 1); }, 240);
                      }}
                      className={`rounded-xl px-3 py-3.5 text-sm font-medium transition active:scale-[0.97] ${wide ? "col-span-2" : ""} ${active ? "bg-primary text-primary-foreground" : "bg-white/[0.06] text-white/75"}`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer — primary action + subtle skip, pinned above the safe area. */}
      <div className="relative z-20 shrink-0 px-6 pb-[max(20px,env(safe-area-inset-bottom))] pt-3">
        <button
          onClick={advance}
          disabled={saving}
          className="flex w-full items-center justify-center rounded-2xl py-4 text-base font-bold text-white transition active:scale-[0.98] disabled:opacity-70"
          style={{
            background: "linear-gradient(90deg, #4068EF 0%, #2A5BDD 50%, #4AB4ED 100%)",
            boxShadow: "0 8px 32px rgba(64,104,239,0.35)",
          }}
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : isLast ? "Save & continue" : "Continue"}
        </button>
        <button
          onClick={onSkip}
          disabled={saving}
          className="mt-2 w-full py-2 text-sm font-medium text-white/55 transition active:opacity-60 disabled:opacity-40"
        >
          Skip for now
        </button>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
