import { useState } from "react";
import { motion } from "motion/react";
import { Keyboard, X } from "lucide-react";
import FocusStepper from "./wrapup-lab/FocusStepper";
import CoachConversation from "./wrapup-lab/CoachConversation";
import CardDeck from "./wrapup-lab/CardDeck";

/* ------------------------------------------------------------------ *
 * Wrap Up Sheet Lab (dev-only, route: /wrapup-lab)
 *
 * Mockups for a redesigned "Wrap up your camp" bottom sheet (fight camps).
 * The current production sheet stacks 4 text inputs in a 92vh sheet, so the
 * iOS keyboard pushes the active input off-screen and the user can't read +
 * type at once. These mockups all take the STEPPED-FLOW approach (one field
 * per screen) so the active input always sits above the keyboard.
 *
 * Three directions to compare:
 *   A — Focus Stepper        minimal Apple-style, one big input per screen
 *   B — Coach Conversation   the wizard asks each question chat-style
 *   C — Card Deck            tactile deck + inline number pad (numbers never
 *                            raise the OS keyboard)
 *
 * Toggle the fake keyboard to see how each layout adapts. Not wired in.
 * Shared contract per mockup: { keyboardOpen, keyboardHeight,
 * onKeyboardShow, onKeyboardHide }.
 * ------------------------------------------------------------------ */

const KB_HEIGHT = 290;

const VARIANTS = [
  { key: "focus", label: "A · Focus Stepper", Comp: FocusStepper },
  { key: "coach", label: "B · Coach Chat", Comp: CoachConversation },
  { key: "deck", label: "C · Card Deck", Comp: CardDeck },
] as const;

type VariantKey = (typeof VARIANTS)[number]["key"];

export default function WrapUpSheetLab() {
  const [variant, setVariant] = useState<VariantKey>("focus");
  const [kbOpen, setKbOpen] = useState(false);

  const Active = VARIANTS.find((v) => v.key === variant)!.Comp;

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-md px-5 py-8 space-y-4">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Wrap Up Camp — Sheet Lab</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Redesigned, keyboard-safe "Wrap up your camp" sheet. One field per screen so the active
            input always stays above the keyboard. Toggle the keyboard to see each layout adapt.
          </p>
        </header>

        {/* variant switcher */}
        <div className="flex flex-wrap gap-2">
          {VARIANTS.map((v) => {
            const active = v.key === variant;
            return (
              <button
                key={v.key}
                onClick={() => {
                  setVariant(v.key);
                  setKbOpen(false);
                }}
                className={`rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
                }`}
              >
                {v.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setKbOpen((b) => !b)}
          className="inline-flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-[12px] font-semibold text-foreground"
        >
          <Keyboard className="h-4 w-4" /> {kbOpen ? "Hide keyboard" : "Show keyboard"}
        </button>

        {/* phone frame */}
        <div className="relative mx-auto w-[330px] h-[680px] rounded-[2.4rem] border border-border/60 bg-background overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
          {/* faux fight-camp page behind */}
          <div className="absolute inset-0 p-4 select-none pointer-events-none opacity-40">
            <div className="h-28 rounded-2xl bg-card/60 mb-3" />
            <div className="h-20 rounded-2xl bg-card/60 mb-3" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-24 rounded-2xl bg-card/60" />
              <div className="h-24 rounded-2xl bg-card/60" />
            </div>
          </div>
          {/* dim */}
          <div className="absolute inset-0 bg-black/50" />

          {/* the mockup fills the frame; it reads the keyboard state via props */}
          <Active
            key={variant}
            keyboardOpen={kbOpen}
            keyboardHeight={kbOpen ? KB_HEIGHT : 0}
            onKeyboardShow={() => setKbOpen(true)}
            onKeyboardHide={() => setKbOpen(false)}
          />

          {/* fake iOS keyboard */}
          <motion.div
            className="absolute inset-x-0 bottom-0 bg-[#1c1c1e] border-t border-black/40 z-30"
            initial={false}
            animate={{ height: kbOpen ? KB_HEIGHT : 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
          >
            {kbOpen && (
              <div className="p-2">
                <div className="flex justify-end px-2 pb-1">
                  <button
                    onClick={() => setKbOpen(false)}
                    className="text-[12px] font-semibold text-primary flex items-center gap-1"
                  >
                    <X className="h-3 w-3" /> done
                  </button>
                </div>
                {["qwertyuiop", "asdfghjkl", "zxcvbnm"].map((row) => (
                  <div key={row} className="flex justify-center gap-1 my-1">
                    {row.split("").map((ch) => (
                      <span
                        key={ch}
                        className="flex-1 max-w-[30px] h-9 rounded-md bg-[#3a3a3c] text-center text-[13px] leading-9 text-white/90"
                      >
                        {ch}
                      </span>
                    ))}
                  </div>
                ))}
                <div className="flex justify-center gap-1 my-1">
                  <span className="flex-1 h-9 rounded-md bg-[#3a3a3c]" />
                  <span className="w-1/2 h-9 rounded-md bg-[#3a3a3c] text-center text-[12px] leading-9 text-white/70">
                    space
                  </span>
                  <span className="flex-1 h-9 rounded-md bg-primary text-center text-[12px] leading-9 text-white">
                    ↵
                  </span>
                </div>
              </div>
            )}
          </motion.div>
        </div>

        <p className="text-[11px] text-muted-foreground/50">
          Dev-only · route <code>/wrapup-lab</code> · not wired in
        </p>
      </div>
    </div>
  );
}
