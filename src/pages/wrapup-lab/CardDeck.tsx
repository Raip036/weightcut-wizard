import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronLeft, Delete, Check, Minus, Plus } from "lucide-react";

export interface WrapUpMockProps {
  keyboardOpen: boolean; // true when the fake OS keyboard is showing
  keyboardHeight: number; // px height when open (e.g. 290), 0 when closed
  onKeyboardShow: () => void; // call to OPEN the fake OS keyboard (ONLY the Notes text step)
  onKeyboardHide: () => void; // call to CLOSE it (every numeric/chip step, and completion)
}

type NumericKey = "end" | "cut" | "diet";
const TOTAL = 5;
const PAD: string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];
const CHIPS = ["Won, felt strong", "Won, drained", "Lost, felt strong", "Lost, drained", "Didn't compete"];

function sanitize(raw: string): string {
  const parts = raw.split(".");
  const clean = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : raw;
  return clean.replace(/[^0-9.]/g, "").slice(0, 6);
}
function bump(raw: string, delta: number): string {
  const next = Math.max(0, (parseFloat(raw || "0") || 0) + delta);
  return (Math.round(next * 10) / 10).toString();
}

export default function CardDeck({ keyboardOpen, keyboardHeight, onKeyboardShow, onKeyboardHide }: WrapUpMockProps) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [done, setDone] = useState(false);
  const [vals, setVals] = useState<Record<NumericKey, string>>({ end: "", cut: "", diet: "" });
  const [chip, setChip] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  const go = (next: number) => {
    setDir(next > step ? 1 : -1);
    onKeyboardHide();
    if (next >= TOTAL) {
      setDone(true);
    } else {
      setStep(Math.max(0, next));
    }
  };

  const numericFor = (s: number): NumericKey | null => (s === 0 ? "end" : s === 1 ? "cut" : s === 2 ? "diet" : null);
  const editPad = (key: NumericKey, k: string) =>
    setVals((v) => ({ ...v, [key]: k === "back" ? v[key].slice(0, -1) : sanitize(v[key] + k) }));

  const meta: { title: string; subtitle: string }[] = [
    { title: "End weight", subtitle: "What you weighed on fight day." },
    { title: "Via water cut", subtitle: "Sauna, sweat, dehydration." },
    { title: "Via diet", subtitle: "Carbs, fibre, sodium." },
    { title: "How did it go?", subtitle: "One tap — be honest with yourself." },
    { title: "Notes", subtitle: "What worked? What to change next time?" },
  ];

  const cardVariants = {
    enter: (d: number) => ({ y: d > 0 ? 46 : -46, scale: 0.92, opacity: 0 }),
    center: { y: 0, scale: 1, opacity: 1 },
    exit: (d: number) => ({ y: d > 0 ? -56 : 56, scale: 0.9, opacity: 0 }),
  };

  // ---- Completion screen ----
  if (done) {
    return (
      <div className="absolute inset-0 flex flex-col bg-background px-6">
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
            className="h-24 w-24 rounded-full bg-primary/15 flex items-center justify-center mb-7"
          >
            <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center">
              <Check className="h-9 w-9 text-primary-foreground" strokeWidth={3} />
            </div>
          </motion.div>
          <h2 className="text-2xl font-bold text-foreground">Camp wrapped</h2>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed max-w-[15rem]">
            Your numbers are logged. We'll use them to sharpen your next cut.
          </p>
        </div>
        <button className="mb-8 h-14 w-full rounded-2xl bg-primary text-primary-foreground font-semibold active:scale-[0.98] transition-transform">
          Save &amp; continue
        </button>
      </div>
    );
  }

  const numKey = numericFor(step);
  const isNotes = step === 4;
  const liftPad = isNotes && keyboardOpen ? keyboardHeight : 0;

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      {/* Header: segmented progress + skip */}
      <div className="px-6 pt-6 pb-2 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            Step {step + 1} of {TOTAL}
          </span>
          <button onClick={() => setDone(true)} className="text-xs font-medium text-muted-foreground active:text-foreground">
            Skip
          </button>
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <div key={i} className="h-1.5 flex-1 rounded-full bg-muted/40 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={false}
                animate={{ width: i <= step ? "100%" : "0%" }}
                transition={{ duration: 0.3 }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Deck area */}
      <div className="relative flex-1 px-5" style={{ paddingBottom: liftPad }}>
        {/* faint stacked deck edges */}
        <div className="absolute left-5 right-5 top-3 h-full rounded-3xl bg-card border border-border/40 opacity-40 scale-[0.94]" />
        <div className="absolute left-5 right-5 top-1.5 h-full rounded-3xl bg-card border border-border/50 opacity-70 scale-[0.97]" />

        <AnimatePresence mode="popLayout" custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            variants={cardVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="relative h-full w-full rounded-3xl bg-card border border-border/50 shadow-xl shadow-black/40 p-6 flex flex-col"
          >
            <div className="shrink-0">
              <h2 className="text-xl font-bold text-foreground">{meta[step].title}</h2>
              <p className="text-sm text-muted-foreground mt-1">{meta[step].subtitle}</p>
            </div>

            {/* Numeric steps */}
            {numKey && (
              <div className="flex-1 flex flex-col">
                <div className="flex items-end justify-center gap-3 mt-5 mb-5">
                  <button
                    onClick={() => setVals((v) => ({ ...v, [numKey]: bump(v[numKey], -0.1) }))}
                    className="h-12 w-12 rounded-xl bg-muted/40 flex items-center justify-center active:scale-95 transition-transform"
                  >
                    <Minus className="h-5 w-5 text-foreground" />
                  </button>
                  <div className="flex items-baseline gap-1 min-w-[7rem] justify-center">
                    <span className="text-5xl font-bold tabular-nums text-foreground">{vals[numKey] || "0"}</span>
                    <span className="text-lg font-medium text-muted-foreground">kg</span>
                  </div>
                  <button
                    onClick={() => setVals((v) => ({ ...v, [numKey]: bump(v[numKey], 0.1) }))}
                    className="h-12 w-12 rounded-xl bg-muted/40 flex items-center justify-center active:scale-95 transition-transform"
                  >
                    <Plus className="h-5 w-5 text-foreground" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-auto">
                  {PAD.map((k) => (
                    <button
                      key={k}
                      onClick={() => editPad(numKey, k)}
                      className="h-11 rounded-xl bg-muted/30 active:bg-muted/50 text-lg font-semibold tabular-nums text-foreground flex items-center justify-center transition-colors"
                    >
                      {k === "back" ? <Delete className="h-5 w-5" /> : k}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Chips step */}
            {step === 3 && (
              <div className="flex-1 flex flex-col justify-center">
                <div className="grid grid-cols-2 gap-2.5">
                  {CHIPS.map((c, i) => {
                    const active = chip === i;
                    const wide = i === 4;
                    return (
                      <button
                        key={c}
                        onClick={() => {
                          setChip(i);
                          setTimeout(() => go(4), 180);
                        }}
                        className={`${wide ? "col-span-2" : ""} h-14 rounded-2xl text-sm font-medium px-3 transition-colors active:scale-[0.97] ${
                          active ? "bg-primary text-primary-foreground" : "bg-muted/40 text-foreground"
                        }`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Notes step (real keyboard) */}
            {isNotes && (
              <div className="flex-1 flex flex-col mt-5">
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onFocus={onKeyboardShow}
                  onBlur={onKeyboardHide}
                  placeholder="Type a quick reflection…"
                  className="w-full rounded-2xl bg-muted/30 border border-border/50 px-4 py-4 text-base text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/60 transition-colors"
                />
                <p className="text-xs text-muted-foreground/70 mt-3">Optional — leave blank to skip.</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer nav */}
      <div
        className="px-5 pt-3 pb-7 shrink-0 flex items-center gap-3"
        style={{ marginBottom: liftPad }}
      >
        {step > 0 && (
          <button
            onClick={() => go(step - 1)}
            className="h-14 w-14 shrink-0 rounded-2xl bg-muted/40 flex items-center justify-center active:scale-95 transition-transform"
          >
            <ChevronLeft className="h-6 w-6 text-foreground" />
          </button>
        )}
        <button
          onClick={() => go(step + 1)}
          className="h-14 flex-1 rounded-2xl bg-primary text-primary-foreground font-semibold active:scale-[0.98] transition-transform"
        >
          {step === TOTAL - 1 ? "Save & continue" : "Continue"}
        </button>
      </div>
    </div>
  );
}
