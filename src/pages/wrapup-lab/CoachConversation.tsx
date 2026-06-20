import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, ArrowUp, Check, X } from "lucide-react";

export interface WrapUpMockProps {
  keyboardOpen: boolean;
  keyboardHeight: number;
  onKeyboardShow: () => void;
  onKeyboardHide: () => void;
}

type StepKind = "number" | "chips" | "text";

interface Step {
  key: string;
  kind: StepKind;
  question: string;
  placeholder?: string;
  chips?: string[];
}

const STEPS: Step[] = [
  { key: "endWeight", kind: "number", question: "First — what did you weigh on fight day?", placeholder: "e.g. 73.5" },
  { key: "viaDehydration", kind: "number", question: "Nice. How much of the cut came from water — sauna, sweat?", placeholder: "e.g. 2.4" },
  { key: "viaDiet", kind: "number", question: "And how much from diet — carbs, fibre, sodium?", placeholder: "e.g. 1.8" },
  { key: "outcome", kind: "chips", question: "How did it go?", chips: ["Won, felt strong", "Won, drained", "Lost, felt strong", "Lost, drained", "Didn't compete"] },
  { key: "notes", kind: "text", question: "Last one — anything you want to remember for next time?", placeholder: "What worked? What to change?" },
];

interface ChatMsg {
  id: number;
  role: "coach" | "user";
  text: string;
}

export default function CoachConversation(props: WrapUpMockProps) {
  const { keyboardOpen, keyboardHeight, onKeyboardShow, onKeyboardHide } = props;
  const [stepIndex, setStepIndex] = useState(0);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [typing, setTyping] = useState(true);
  const [draft, setDraft] = useState("");
  const [done, setDone] = useState(false);
  const idRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const step = STEPS[stepIndex];
  const isTypable = !done && (step?.kind === "number" || step?.kind === "text");

  // Drive the "typing… then bubble" beat each time we land on a new step.
  useEffect(() => {
    if (done) return;
    setTyping(true);
    const t = setTimeout(() => {
      setTyping(false);
      setMessages((m) => [...m, { id: idRef.current++, role: "coach", text: STEPS[stepIndex].question }]);
    }, 850);
    return () => clearTimeout(t);
  }, [stepIndex, done]);

  // Keyboard control: open for typable turns, hide for chip turns / completion.
  useEffect(() => {
    if (typing) return;
    if (isTypable) {
      onKeyboardShow();
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
    onKeyboardHide();
  }, [typing, isTypable, stepIndex, done, onKeyboardShow, onKeyboardHide]);

  // Auto-scroll to newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  const advance = () => {
    if (stepIndex >= STEPS.length - 1) {
      setDone(true);
      onKeyboardHide();
      setTimeout(() => {
        setMessages((m) => [...m, { id: idRef.current++, role: "coach", text: "Logged. That'll sharpen your next camp 💪" }]);
      }, 700);
    } else {
      setStepIndex((i) => i + 1);
    }
  };

  const postAnswer = (text: string) => {
    const clean = text.trim();
    if (!clean && step.kind !== "text") return;
    setMessages((m) => [...m, { id: idRef.current++, role: "user", text: clean || "Skipped" }]);
    setDraft("");
    advance();
  };

  const progress = done ? STEPS.length : stepIndex;

  return (
    <div className="absolute inset-0 flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-cyan-400/60 shadow-lg shadow-primary/20">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Coach</p>
            <p className="text-[11px] text-muted-foreground">Wrap up your camp</p>
          </div>
        </div>
        <button className="text-xs font-medium text-muted-foreground transition active:scale-95">Skip</button>
      </div>

      {/* Slim progress bar */}
      <div className="px-4 pb-1.5">
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted/40">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-primary to-cyan-400"
            initial={false}
            animate={{ width: `${(progress / STEPS.length) * 100}%` }}
            transition={{ type: "spring", stiffness: 200, damping: 26 }}
          />
        </div>
        <p className="mt-1 text-right text-[10px] text-muted-foreground">
          {Math.min(progress + (done ? 0 : 1), STEPS.length)} of {STEPS.length}
        </p>
      </div>

      {/* Chat scroll area */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 pb-4 pt-2">
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              layout
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {m.role === "coach" && (
                <div className="mr-2 mt-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-cyan-400/60">
                  <Sparkles className="h-3 w-3 text-primary-foreground" />
                </div>
              )}
              <div
                className={`max-w-[76%] px-3.5 py-2.5 text-[13px] leading-snug ${
                  m.role === "user"
                    ? "rounded-2xl rounded-tr-sm bg-primary text-primary-foreground"
                    : "rounded-2xl rounded-tl-sm bg-muted/40 text-foreground"
                }`}
              >
                {m.text}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator */}
        <AnimatePresence>
          {typing && !done && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex justify-start"
            >
              <div className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-cyan-400/60">
                <Sparkles className="h-3 w-3 text-primary-foreground" />
              </div>
              <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-muted/40 px-3.5 py-3">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70"
                    animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Compose dock — rides above the keyboard */}
      <div
        className="shrink-0 rounded-t-3xl border-t border-border/50 bg-card px-4 pt-3 pb-4"
        style={{ marginBottom: keyboardOpen ? keyboardHeight : 0, transition: "margin-bottom 0.22s ease" }}
      >
        <AnimatePresence mode="wait">
          {done ? (
            <motion.button
              key="done"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition active:scale-[0.98]"
            >
              <Check className="h-4 w-4" />
              Save &amp; continue
            </motion.button>
          ) : step?.kind === "chips" && !typing ? (
            <motion.div
              key="chips"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-wrap gap-2"
            >
              {step.chips!.map((c) => {
                const negative = c.includes("drained") || c.includes("Lost") || c.includes("Didn't");
                return (
                  <button
                    key={c}
                    onClick={() => postAnswer(c)}
                    className={`rounded-full border px-3.5 py-2 text-[12px] font-medium transition active:scale-95 ${
                      negative
                        ? "border-border/50 bg-muted/40 text-foreground"
                        : "border-primary/30 bg-primary/15 text-foreground"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </motion.div>
          ) : isTypable ? (
            <motion.form
              key={`form-${step.key}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              onSubmit={(e) => {
                e.preventDefault();
                postAnswer(draft);
              }}
              className="flex items-center gap-2"
            >
              <div className="flex flex-1 items-center rounded-full border border-border/50 bg-muted/40 px-4 py-2.5">
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onFocus={onKeyboardShow}
                  inputMode={step.kind === "number" ? "decimal" : "text"}
                  placeholder={step.placeholder}
                  className="w-full bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                {step.kind === "text" && draft.trim() === "" && (
                  <button
                    type="button"
                    onClick={() => postAnswer("")}
                    className="ml-2 flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground"
                  >
                    <X className="h-3 w-3" /> skip
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={step.kind === "number" && draft.trim() === ""}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/25 transition active:scale-90 disabled:opacity-40"
              >
                <ArrowUp className="h-5 w-5" />
              </button>
            </motion.form>
          ) : (
            <motion.div
              key="wait"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center justify-center py-2.5 text-[11px] text-muted-foreground"
            >
              Coach is typing…
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
