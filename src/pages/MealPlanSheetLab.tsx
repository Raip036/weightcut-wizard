import { useState } from "react";
import { motion } from "motion/react";
import { Sparkles, Minus, Plus, Keyboard, X } from "lucide-react";

/* ------------------------------------------------------------------ *
 * Meal Plan Sheet Lab (dev-only, route: /mealplan-sheet-lab)
 *
 * Redesigned "Meal plan ideas" bottom sheet: bigger / more structured input
 * state, and KEYBOARD-SAFE (flex column — fixed header + scrollable body +
 * sticky footer that rides above the keyboard, instead of a fixed h-[88dvh]
 * that pushes the Generate button off-screen). Toggle the keyboard to see it
 * adapt. Not wired in.
 * ------------------------------------------------------------------ */

const CHIPS = ["High protein", "Low carb", "Budget", "Fight week prep"];
const KB_HEIGHT = 290;

function MacroChip({ v, label, tone }: { v: string; label: string; tone?: string }) {
  return (
    <div className="flex-1 rounded-xl bg-muted/25 border border-border/40 px-2 py-2 text-center">
      <p className="text-[15px] font-bold tabular-nums leading-none" style={tone ? { color: tone } : undefined}>{v}</p>
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground/70 mt-1">{label}</p>
    </div>
  );
}

function Sheet({ kbOpen, setKbOpen }: { kbOpen: boolean; setKbOpen: (b: boolean) => void }) {
  const [prompt, setPrompt] = useState("");
  const [meals, setMeals] = useState(4);

  return (
    <motion.div
      className="absolute inset-x-0 flex flex-col rounded-t-3xl border-t border-white/10 bg-card shadow-[0_-12px_40px_rgba(0,0,0,0.5)]"
      animate={{ bottom: kbOpen ? KB_HEIGHT : 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 36 }}
      style={{ maxHeight: kbOpen ? `calc(100% - ${KB_HEIGHT}px)` : "90%" }}
    >
      {/* drag handle */}
      <div className="flex justify-center pt-2.5 pb-1 shrink-0">
        <div className="h-[5px] w-9 rounded-full bg-white/25" />
      </div>

      {/* fixed header — title + target macros (gives the sheet presence) */}
      <div className="shrink-0 px-5 pt-2 pb-3 border-b border-white/5">
        <h2 className="text-[20px] font-bold tracking-tight">Meal plan ideas</h2>
        <p className="text-[12px] text-muted-foreground mt-0.5">A full day tuned to your targets</p>
        <div className="mt-3 flex gap-2">
          <MacroChip v="2400" label="kcal" />
          <MacroChip v="180g" label="protein" tone="hsl(152 64% 47%)" />
          <MacroChip v="240g" label="carbs" tone="hsl(35 92% 58%)" />
          <MacroChip v="70g" label="fats" tone="hsl(217 91% 58%)" />
        </div>
      </div>

      {/* scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
        <div>
          <label className="text-[12px] font-semibold text-foreground/80">What are you after?</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onFocus={() => setKbOpen(true)}
            placeholder="high protein, no dairy, I train BJJ at 5pm…"
            rows={3}
            className="mt-1.5 w-full resize-none rounded-xl border border-border/40 bg-muted/20 px-3.5 py-3 text-[14px] outline-none focus:border-primary/40"
          />
          <div className="mt-2.5 flex flex-wrap gap-2">
            {CHIPS.map((c) => (
              <button key={c} onClick={() => setPrompt((p) => (p ? p.trimEnd() + " " + c : c))}
                className="rounded-full bg-muted/40 px-3 py-1.5 text-[12px] text-muted-foreground active:bg-muted/60">{c}</button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-muted/15 px-3.5 py-3">
          <span className="text-[13px] font-medium text-foreground/90">Meals in the day</span>
          <div className="flex items-center gap-4">
            <button onClick={() => setMeals((n) => Math.max(2, n - 1))} className="h-9 w-9 rounded-xl bg-muted/40 flex items-center justify-center active:scale-95"><Minus className="h-4 w-4" /></button>
            <b className="w-5 text-center text-[18px] tabular-nums">{meals}</b>
            <button onClick={() => setMeals((n) => Math.min(6, n + 1))} className="h-9 w-9 rounded-xl bg-muted/40 flex items-center justify-center active:scale-95"><Plus className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      {/* sticky footer — Generate always reachable, rides above the keyboard */}
      <div className="shrink-0 px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] border-t border-white/5 bg-card">
        <button className="w-full flex items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-[14px] font-bold text-primary-foreground active:scale-[0.99]">
          <Sparkles className="h-4 w-4" /> Generate my day
        </button>
      </div>
    </motion.div>
  );
}

export default function MealPlanSheetLab() {
  const [kbOpen, setKbOpen] = useState(false);
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-md px-5 py-8 space-y-4">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Meal Plan Sheet Lab</h1>
          <p className="mt-1 text-sm text-muted-foreground">Redesigned, keyboard-safe "Meal plan ideas" sheet — bigger/structured input + sticky Generate that stays above the keyboard. Toggle the keyboard to see it adapt.</p>
        </header>

        <button onClick={() => setKbOpen((b) => !b)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground">
          <Keyboard className="h-4 w-4" /> {kbOpen ? "Hide keyboard" : "Show keyboard"}
        </button>

        {/* phone frame */}
        <div className="relative mx-auto w-[330px] h-[680px] rounded-[2.4rem] border border-border/60 bg-background overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
          {/* faux nutrition page behind */}
          <div className="absolute inset-0 p-4 select-none pointer-events-none opacity-40">
            <div className="h-24 rounded-2xl bg-card/60 mb-3" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-20 rounded-2xl bg-card/60" />
              <div className="h-20 rounded-2xl bg-card/60" />
            </div>
          </div>
          {/* dim */}
          <div className="absolute inset-0 bg-black/40" />

          <Sheet kbOpen={kbOpen} setKbOpen={setKbOpen} />

          {/* fake iOS keyboard */}
          <motion.div
            className="absolute inset-x-0 bottom-0 bg-[#1c1c1e] border-t border-black/40 z-20"
            initial={false}
            animate={{ height: kbOpen ? KB_HEIGHT : 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
          >
            {kbOpen && (
              <div className="p-2">
                <div className="flex justify-end px-2 pb-1">
                  <button onClick={() => setKbOpen(false)} className="text-[12px] font-semibold text-primary flex items-center gap-1"><X className="h-3 w-3" /> done</button>
                </div>
                {["qwertyuiop", "asdfghjkl", "zxcvbnm"].map((row) => (
                  <div key={row} className="flex justify-center gap-1 my-1">
                    {row.split("").map((ch) => (
                      <span key={ch} className="flex-1 max-w-[30px] h-9 rounded-md bg-[#3a3a3c] text-center text-[13px] leading-9 text-white/90">{ch}</span>
                    ))}
                  </div>
                ))}
                <div className="flex justify-center gap-1 my-1">
                  <span className="flex-1 h-9 rounded-md bg-[#3a3a3c]" />
                  <span className="w-1/2 h-9 rounded-md bg-[#3a3a3c] text-center text-[12px] leading-9 text-white/70">space</span>
                  <span className="flex-1 h-9 rounded-md bg-primary text-center text-[12px] leading-9 text-white">↵</span>
                </div>
              </div>
            )}
          </motion.div>
        </div>

        <p className="text-[11px] text-muted-foreground/50">Dev-only · route <code>/mealplan-sheet-lab</code> · not wired in</p>
      </div>
    </div>
  );
}
