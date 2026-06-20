import { useState, useRef, useEffect, type ChangeEvent, type KeyboardEvent } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ChevronLeft, Check, Droplets, Utensils, Scale, Trophy, PenLine } from "lucide-react";

// Drifting blue motes — same recipe as the Pro gate (ProUpsellScreen), scaled
// to the sheet height. Fixed positions so they don't re-randomize on re-render.
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

export interface WrapUpMockProps {
  keyboardOpen: boolean;
  keyboardHeight: number;
  onKeyboardShow: () => void;
  onKeyboardHide: () => void;
}

type Outcome = "won_strong" | "won_drained" | "lost_strong" | "lost_drained" | "no_comp";

const OUTCOMES: { id: Outcome; label: string }[] = [
  { id: "won_strong", label: "Won, felt strong" },
  { id: "won_drained", label: "Won, drained" },
  { id: "lost_strong", label: "Lost, felt strong" },
  { id: "lost_drained", label: "Lost, drained" },
  { id: "no_comp", label: "Didn't compete" },
];

const FRAME_H = 680;
const TOTAL = 5;

export default function FocusStepper({
  keyboardOpen,
  keyboardHeight,
  onKeyboardShow,
  onKeyboardHide,
}: WrapUpMockProps) {
  const [step, setStep] = useState<number>(0);
  const [dir, setDir] = useState<number>(1);
  const [done, setDone] = useState<boolean>(false);
  const [endWeight, setEndWeight] = useState<string>("");
  const [viaWater, setViaWater] = useState<string>("");
  const [viaDiet, setViaDiet] = useState<string>("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [notes, setNotes] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const prefersReduced = useReducedMotion();

  const isChipStep = step === 3;

  // Manage fake keyboard when arriving on the chip-only step.
  useEffect(() => {
    if (isChipStep) onKeyboardHide();
  }, [isChipStep, onKeyboardHide]);

  const go = (next: number) => {
    if (next < 0 || next > TOTAL - 1) return;
    setDir(next > step ? 1 : -1);
    setStep(next);
  };

  const advance = () => {
    if (step === TOTAL - 1) {
      onKeyboardHide();
      setDone(true);
      return;
    }
    go(step + 1);
  };

  const reset = () => {
    setDone(false);
    setStep(0);
    setDir(-1);
    setEndWeight("");
    setViaWater("");
    setViaDiet("");
    setOutcome(null);
    setNotes("");
  };

  const usableH = keyboardOpen ? FRAME_H - keyboardHeight : FRAME_H;
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      advance();
    }
  };

  type NumStep = { kind: "num"; icon: typeof Scale; q: string; help: string; value: string; set: (v: string) => void; ph: string };
  type TxtStep = { kind: "text"; icon: typeof PenLine; q: string; help: string; value: string; set: (v: string) => void; ph: string };
  type ChipStep = { kind: "chip"; icon: typeof Trophy; q: string; help: string };

  const steps: (NumStep | TxtStep | ChipStep)[] = [
    { kind: "num", icon: Scale, q: "What did you weigh on fight day?", help: "Your scale weight at weigh-in.", value: endWeight, set: setEndWeight, ph: "73.5" },
    { kind: "num", icon: Droplets, q: "How much came off via water cut?", help: "Sauna, sweat, dehydration.", value: viaWater, set: setViaWater, ph: "2.4" },
    { kind: "num", icon: Utensils, q: "And how much via diet?", help: "Carbs, fibre, sodium.", value: viaDiet, set: setViaDiet, ph: "1.8" },
    { kind: "chip", icon: Trophy, q: "How did it go?", help: "Pick the one that fits best." },
    { kind: "text", icon: PenLine, q: "Anything to remember for next time?", help: "Optional — totally fine to skip.", value: notes, set: setNotes, ph: "What worked? What to change?" },
  ];
  const cur = steps[step];

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Scrim */}
      <div className="flex-1 bg-black/40" />

      {/* Sheet */}
      <div className="relative rounded-t-3xl border-t border-border/50 bg-card overflow-hidden" style={{ height: FRAME_H }}>
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
                style={{
                  left: m.left,
                  width: m.size,
                  height: m.size,
                  filter: "blur(0.5px)",
                  boxShadow: "0 0 7px hsl(213 94% 70% / 0.7)",
                }}
                initial={{ opacity: 0, y: 0 }}
                animate={{ opacity: [0, 0.7, 0], y: [-12, -640] }}
                transition={{ duration: m.dur, delay: m.delay, repeat: Infinity, ease: "easeOut" }}
              />
            ))}
          </div>
        )}

        <div className="absolute left-1/2 top-2.5 h-1 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/30 z-10" />

        {/* Header: dots + skip */}
        <div className="relative z-10 flex items-center justify-between px-5 pt-6 pb-2">
          <button onClick={() => (step === 0 ? reset() : go(step - 1))} className={`grid h-9 w-9 place-items-center rounded-full bg-muted/40 text-muted-foreground transition ${step === 0 ? "invisible" : "active:scale-95"}`} aria-label="Back">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            {Array.from({ length: TOTAL }).map((_, i) => (
              <motion.span key={i} animate={{ width: i === step && !done ? 22 : 7, opacity: i <= step || done ? 1 : 0.3 }} className={`h-[7px] rounded-full ${i <= step || done ? "bg-primary" : "bg-muted-foreground/40"}`} />
            ))}
          </div>
          <button onClick={reset} className="text-xs font-medium text-muted-foreground active:opacity-60">Skip</button>
        </div>

        {/* Body — content lifts into the top of the usable (above-keyboard) area */}
        <div className="absolute inset-x-0 z-10 px-6" style={{ top: keyboardOpen ? 64 : 84 }}>
          <AnimatePresence mode="wait" custom={dir}>
            {done ? (
              <motion.div key="done" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center pt-10 text-center">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.05 }} className="grid h-20 w-20 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-10 w-10" strokeWidth={2.5} />
                </motion.div>
                <h2 className="mt-6 text-[24px] font-semibold tracking-tight text-foreground">All set</h2>
                <p className="mt-2 max-w-[15rem] text-sm text-muted-foreground">Your camp wrap-up is logged. Nice work closing it out.</p>
              </motion.div>
            ) : (
              <motion.div key={step} custom={dir} initial={{ opacity: 0, x: dir * 36 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -36 }} transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }} className="flex flex-col items-center text-center">
                <div className="mb-5 grid h-11 w-11 place-items-center rounded-2xl bg-muted/40 text-primary">
                  <cur.icon className="h-[22px] w-[22px]" />
                </div>
                <h2 className="text-[22px] font-semibold leading-snug tracking-tight text-foreground">{cur.q}</h2>
                <p className="mt-2 max-w-[17rem] text-sm text-muted-foreground">{cur.help}</p>

                {cur.kind === "num" && (
                  <div className="mt-7 w-full">
                    <div className="flex items-end justify-center gap-1.5" onClick={() => inputRef.current?.focus()}>
                      <span className={`text-5xl font-bold tabular-nums tracking-tight ${cur.value ? "text-foreground" : "text-muted-foreground/40"}`}>{cur.value || cur.ph}</span>
                      <span className="pb-1.5 text-xl font-semibold text-muted-foreground">kg</span>
                    </div>
                    <input ref={inputRef} value={cur.value} onChange={(e: ChangeEvent<HTMLInputElement>) => cur.set(e.target.value.replace(/[^0-9.]/g, ""))} onFocus={onKeyboardShow} onKeyDown={onEnter} inputMode="decimal" placeholder={cur.ph} className="mt-4 w-full rounded-xl border border-border/50 bg-muted/40 px-4 py-3 text-center text-base text-foreground outline-none transition focus:border-primary/60" />
                  </div>
                )}

                {cur.kind === "text" && (
                  <input ref={inputRef} value={cur.value} onChange={(e: ChangeEvent<HTMLInputElement>) => cur.set(e.target.value)} onFocus={onKeyboardShow} onKeyDown={onEnter} placeholder={cur.ph} className="mt-7 w-full rounded-xl border border-border/50 bg-muted/40 px-4 py-3.5 text-center text-base text-foreground outline-none transition placeholder:text-muted-foreground/50 focus:border-primary/60" />
                )}

                {cur.kind === "chip" && (
                  <div className="mt-7 grid w-full grid-cols-2 gap-2.5">
                    {OUTCOMES.map((o) => {
                      const active = outcome === o.id;
                      const wide = o.id === "no_comp";
                      return (
                        <button key={o.id} onClick={() => { setOutcome(o.id); window.setTimeout(advance, 260); }} className={`rounded-xl px-3 py-3.5 text-sm font-medium transition active:scale-[0.97] ${wide ? "col-span-2" : ""} ${active ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground"}`}>
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer — rides above the keyboard like an iOS accessory bar */}
        <div className="absolute inset-x-0 z-10 bg-gradient-to-t from-card via-card to-transparent px-6 pt-8" style={{ bottom: keyboardOpen ? keyboardHeight : 0, paddingBottom: keyboardOpen ? 12 : 28, height: keyboardOpen ? undefined : "auto" }}>
          {done ? (
            <button onClick={reset} className="w-full rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition active:scale-[0.98]">Save &amp; continue</button>
          ) : (
            !isChipStep && (
              <button onClick={advance} className="w-full rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition active:scale-[0.98]">
                {step === TOTAL - 1 ? "Save & continue" : "Continue"}
              </button>
            )
          )}
          {!done && isChipStep && (
            <button onClick={() => go(step + 1)} className="w-full py-3 text-sm font-medium text-muted-foreground active:opacity-60">Continue without selecting</button>
          )}
        </div>
      </div>
    </div>
  );
}
