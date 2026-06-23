import { useState, useRef, type ChangeEvent, type KeyboardEvent } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ChevronLeft, Droplets, Utensils, Scale, Trophy, PenLine, Loader2, type LucideIcon } from "lucide-react";
import { triggerHapticSelection } from "@/lib/haptics";
import { SheetTitle } from "@/components/ui/sheet";

/**
 * Wrap-up reflection as a focused, one-field-per-screen stepper. Replaces the
 * old single-sheet form that stacked four text inputs — when the iOS keyboard
 * opened it pushed the active field off-screen. Showing one short field at a
 * time keeps content compact enough that the sheet (which already lifts above
 * the keyboard via `--keyboard-inset`) never hides the active input.
 *
 * The component owns the field values locally and hands them back via
 * `onComplete` on the last step; `onSkip` bails out of the whole reflection.
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
}

// Drifting blue motes — same recipe as the Pro gate (ProUpsellScreen), scaled
// to the compact sheet. Fixed positions so they don't re-randomize on render.
const MOTES: Array<{ left: string; size: number; dur: number; delay: number }> = [
  { left: "8%", size: 4, dur: 7.5, delay: 0.0 },
  { left: "20%", size: 3, dur: 9.0, delay: 1.6 },
  { left: "32%", size: 5, dur: 8.0, delay: 0.7 },
  { left: "44%", size: 3, dur: 9.5, delay: 2.4 },
  { left: "56%", size: 4, dur: 8.3, delay: 1.1 },
  { left: "68%", size: 3, dur: 9.1, delay: 0.4 },
  { left: "80%", size: 5, dur: 7.8, delay: 2.0 },
  { left: "91%", size: 3, dur: 9.3, delay: 1.0 },
];

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
  { kind: "text", icon: PenLine, q: "Anything to remember for next time?", help: "Optional - totally fine to skip.", field: "notes", ph: "What worked? What to change?" },
];
const TOTAL = STEPS.length;

export function WrapUpStepper({ saving, onComplete, onSkip }: WrapUpStepperProps) {
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
    setDir(-1);
    setStep((s) => Math.max(0, s - 1));
  };
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      advance();
    }
  };

  return (
    <div className="relative flex flex-col overflow-hidden max-h-[calc(100dvh-var(--keyboard-inset,0px))] transition-[max-height] duration-300 ease-out">
      <SheetTitle className="sr-only">Wrap up your camp</SheetTitle>

      {/* Blue animated backdrop — matches the Pro gate (ProUpsellScreen) */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, hsl(var(--primary) / 0.08) 55%, hsl(217 91% 58% / 0.16) 82%, hsl(213 94% 68% / 0.22) 100%)",
        }}
        initial={prefersReduced ? false : { opacity: 0 }}
        animate={prefersReduced ? { opacity: 1 } : { opacity: 1, scale: [1, 1.05, 1] }}
        transition={
          prefersReduced
            ? { duration: 0 }
            : {
                opacity: { duration: 1, ease: "easeOut" },
                scale: { duration: 8, ease: "easeInOut", repeat: Infinity },
              }
        }
      />
      {!prefersReduced && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {MOTES.map((m, i) => (
            <motion.span
              key={i}
              className="absolute bottom-0 rounded-full bg-blue-300/70"
              style={{ left: m.left, width: m.size, height: m.size, filter: "blur(0.5px)", boxShadow: "0 0 7px hsl(213 94% 70% / 0.7)" }}
              initial={{ opacity: 0, y: 0 }}
              animate={{ opacity: [0, 0.7, 0], y: [-12, -440] }}
              transition={{ duration: m.dur, delay: m.delay, repeat: Infinity, ease: "easeOut" }}
            />
          ))}
        </div>
      )}

      {/* Header — back + progress dots */}
      <div className="relative z-10 flex items-center gap-3 px-5 pt-6 pb-2">
        <button
          onClick={back}
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted/40 text-muted-foreground transition ${step === 0 ? "invisible" : "active:scale-95"}`}
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-1 items-center justify-center gap-2">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <motion.span
              key={i}
              animate={{ width: i === step ? 22 : 7, opacity: i <= step ? 1 : 0.3 }}
              className={`h-[7px] rounded-full ${i <= step ? "bg-primary" : "bg-muted-foreground/40"}`}
            />
          ))}
        </div>
        <span className="h-9 w-9 shrink-0" aria-hidden />
      </div>

      {/* Body — one centered field per step. `min-h-0 overflow-y-auto` lets the
          body (not the footer) absorb any squeeze when the keyboard is open on
          small screens. `pb-6` guarantees a gap above the opaque footer so the
          active input is never flush with — or hidden behind — the Continue
          button when the keyboard shortens the sheet. `m-auto` (instead of
          `justify-center`) centres the field while staying scroll-safe: when
          content is taller than the squeezed body it scrolls instead of
          clipping the top out of reach. */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-7 pb-6 text-center">
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
            <div className="mb-5 grid h-11 w-11 place-items-center rounded-2xl bg-muted/40 text-primary">
              <cur.icon className="h-[22px] w-[22px]" />
            </div>
            <h2 className="text-[22px] font-semibold leading-snug tracking-tight text-foreground">{cur.q}</h2>
            <p className="mt-2 max-w-[17rem] text-sm text-muted-foreground">{cur.help}</p>

            {cur.kind === "num" && (
              <div className="mt-7 w-full">
                <div className="flex items-end justify-center gap-1.5" onClick={() => inputRef.current?.focus()}>
                  <span className={`text-5xl font-bold tabular-nums tracking-tight ${values[cur.field] ? "text-foreground" : "text-muted-foreground/40"}`}>
                    {values[cur.field] || cur.ph}
                  </span>
                  <span className="pb-1.5 text-xl font-semibold text-muted-foreground">kg</span>
                </div>
                <input
                  ref={inputRef}
                  value={values[cur.field]}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setField(cur.field, e.target.value.replace(/[^0-9.]/g, ""))}
                  onKeyDown={onEnter}
                  inputMode="decimal"
                  placeholder={cur.ph}
                  className="mt-4 w-full rounded-xl border border-border/50 bg-muted/40 px-4 py-3 text-center text-base text-foreground outline-none transition focus:border-primary/60"
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
                className="mt-7 w-full rounded-xl border border-border/50 bg-muted/40 px-4 py-3.5 text-center text-base text-foreground outline-none transition placeholder:text-muted-foreground/50 focus:border-primary/60"
              />
            )}

            {cur.kind === "chip" && (
              <div className="mt-7 grid w-full grid-cols-2 gap-2.5">
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
                      className={`rounded-xl px-3 py-3.5 text-sm font-medium transition active:scale-[0.97] ${wide ? "col-span-2" : ""} ${active ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground"}`}
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

      {/* Footer — primary action + subtle skip. Opaque `bg-card` with a hairline
          top divider (survives the native box-shadow stripping) so it reads as a
          distinct bottom bar: the active input always sits clearly above it and
          can never be overlapped by the Continue button, even when the keyboard
          shortens the sheet. */}
      <div className="relative z-20 border-t border-white/[0.06] bg-card/90 px-6 pb-[max(20px,env(safe-area-inset-bottom))] pt-5">
        <button
          onClick={advance}
          disabled={saving}
          className="flex w-full items-center justify-center rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition active:scale-[0.98] disabled:opacity-70"
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : isLast ? "Save & continue" : "Continue"}
        </button>
        <button
          onClick={onSkip}
          disabled={saving}
          className="mt-2 w-full py-2 text-sm font-medium text-muted-foreground transition active:opacity-60 disabled:opacity-40"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
