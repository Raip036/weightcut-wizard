import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { MacroText } from "@/components/nutrition/health/MacroText";

/* ------------------------------------------------------------------ *
 * THROWAWAY MOCK LAB - /meal-analysis-lab
 *
 * Condensed redesigns of the "Detected foods" list (post meal-photo
 * analysis). Current card stacks: name + editable quantity input, a
 * calorie stepper, a macros + whole-food row, and a full-width 4-button
 * portion-multiplier strip = ~140px per food, reads as too much.
 *
 * A · Expandable   — clean 2-line summary, edit controls revealed on tap.
 * B · Compact      — keep every control visible, just tightened.
 *
 * Delete this file + route after sign-off.
 * ------------------------------------------------------------------ */

interface Food {
  name: string;
  quantity: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
}

const FOODS: Food[] = [
  { name: "Hard boiled egg", quantity: "3 × whole egg", calories: 234, protein_g: 19, carbs_g: 2, fats_g: 16 },
  { name: "Hard boiled egg", quantity: "1 × whole egg", calories: 78, protein_g: 6, carbs_g: 1, fats_g: 5 },
  { name: "Arugula", quantity: "1 small handful", calories: 2, protein_g: 0, carbs_g: 0, fats_g: 0 },
];

const MULT = [0.5, 1, 1.5, 2] as const;
const fmtMult = (m: number) => (m === 0.5 ? "½×" : m === 1.5 ? "1½×" : `${m}×`);

function WholeFood() {
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "rgb(var(--func-recovery-green))", opacity: 0.9 }} />
      <span className="text-[10.5px] text-muted-foreground/70">Whole food</span>
    </span>
  );
}

function SectionLabel() {
  return (
    <div className="flex items-center justify-between px-0.5 mb-2">
      <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60">Detected foods</p>
      <p className="text-[10px] text-muted-foreground/50">Tap to adjust</p>
    </div>
  );
}

/* ── Variant A — Expandable ───────────────────────────────────────── */
function RowExpandable({ food, defaultOpen = false }: { food: Food; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [active, setActive] = useState(1);
  return (
    <div className="rounded-xl bg-muted/30 border border-border/30 overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full px-3 py-2.5 text-left active:bg-muted/40 transition-colors">
        <div className="flex items-center gap-2 min-w-0">
          <p className="flex-1 min-w-0 text-[14px] font-semibold text-foreground truncate leading-tight">{food.name}</p>
          <span className="text-[16px] font-bold tabular-nums leading-none shrink-0">{food.calories}</span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 shrink-0">kcal</span>
          <Icon name={open ? "chevronUpOutline" : "chevronDownOutline"} size={14} className="text-muted-foreground/40 shrink-0" />
        </div>
        <div className="mt-0.5 flex items-center gap-2 min-w-0">
          <span className="text-[11.5px] text-muted-foreground/70 truncate">{food.quantity}</span>
          <span className="text-muted-foreground/25">·</span>
          <MacroText protein_g={food.protein_g} carbs_g={food.carbs_g} fats_g={food.fats_g} />
          <span className="ml-auto"><WholeFood /></span>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-2.5 pt-0.5 flex items-center gap-2">
          <div className="flex gap-1 flex-1">
            {MULT.map((m, i) => (
              <button
                key={m}
                type="button"
                onClick={() => setActive(i)}
                className={`flex-1 h-7 rounded-lg text-[11px] font-bold tabular-nums transition-colors ${
                  active === i ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "bg-muted/40 text-muted-foreground/70 active:bg-muted/60"
                }`}
              >
                {fmtMult(m)}
              </button>
            ))}
          </div>
          <button type="button" className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-muted-foreground/50 active:text-destructive active:bg-destructive/10 transition-colors">
            <Icon name="closeOutline" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Variant B — Always-visible compact ───────────────────────────── */
function RowCompact({ food }: { food: Food }) {
  const [active, setActive] = useState(1);
  return (
    <div className="rounded-xl bg-muted/30 border border-border/30 px-3 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-foreground truncate leading-tight">{food.name}</p>
          <div className="mt-0.5 flex items-center gap-2 min-w-0">
            <span className="text-[11.5px] text-muted-foreground/70 truncate">{food.quantity}</span>
            <MacroText protein_g={food.protein_g} carbs_g={food.carbs_g} fats_g={food.fats_g} />
          </div>
        </div>
        {/* compact stepper */}
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" className="h-6 w-6 rounded-full bg-muted/60 flex items-center justify-center text-foreground/80 active:bg-muted/80">
            <Icon name="removeOutline" size={11} />
          </button>
          <div className="w-10 text-center">
            <p className="text-[15px] font-bold tabular-nums leading-none">{food.calories}</p>
            <p className="text-[8px] uppercase tracking-wider text-muted-foreground/50">kcal</p>
          </div>
          <button type="button" className="h-6 w-6 rounded-full bg-muted/60 flex items-center justify-center text-foreground/80 active:bg-muted/80">
            <Icon name="addOutline" size={11} />
          </button>
        </div>
        <button type="button" className="h-6 w-6 shrink-0 flex items-center justify-center rounded-full text-muted-foreground/40 active:text-destructive">
          <Icon name="closeOutline" size={13} />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex gap-1 flex-1">
          {MULT.map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => setActive(i)}
              className={`flex-1 h-6 rounded-lg text-[10.5px] font-bold tabular-nums transition-colors ${
                active === i ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "bg-muted/40 text-muted-foreground/70 active:bg-muted/60"
              }`}
            >
              {fmtMult(m)}
            </button>
          ))}
        </div>
        <WholeFood />
      </div>
    </div>
  );
}

export default function MealAnalysisLab() {
  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div className="mx-auto max-w-md px-5 py-8 space-y-10">
        <h1 className="text-lg font-bold">Detected foods · condensed mocks</h1>

        <section>
          <p className="text-xs font-semibold uppercase tracking-wider text-white/45 mb-3">A · Expandable (tap a row to edit)</p>
          <SectionLabel />
          <div className="space-y-1.5">
            <RowExpandable food={FOODS[0]} defaultOpen />
            <RowExpandable food={FOODS[1]} />
            <RowExpandable food={FOODS[2]} />
          </div>
        </section>

        <section>
          <p className="text-xs font-semibold uppercase tracking-wider text-white/45 mb-3">B · Compact (all controls visible)</p>
          <SectionLabel />
          <div className="space-y-1.5">
            {FOODS.map((f, i) => <RowCompact key={i} food={f} />)}
          </div>
        </section>
      </div>
    </div>
  );
}
