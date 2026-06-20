import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { motion } from "motion/react";
import { Check, AlertTriangle } from "lucide-react";
import type { EditingTargets } from "@/pages/nutrition/types";

interface MacroCalcShape {
  calculateMacrosFromCalories: (cal: number) => { protein_g: string; carbs_g: string; fats_g: string };
  adjustMacrosToMatchCalories: (
    field: "protein" | "carbs" | "fats",
    value: number,
    current: { protein: number; carbs: number; fats: number },
    calGoal: number
  ) => { protein: number; carbs: number; fats: number };
}

interface EditTargetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingTargets: EditingTargets;
  setEditingTargets: React.Dispatch<React.SetStateAction<EditingTargets>>;
  macroCalc: MacroCalcShape;
  onSave: () => void;
}

const MACROS = [
  { key: "protein", label: "Protein", rgb: "var(--func-protein-blue)" },
  { key: "carbs", label: "Carbs", rgb: "var(--func-carbs-orange)" },
  { key: "fats", label: "Fats", rgb: "var(--func-fats-purple)" },
] as const;

const STATUS_META = {
  good: { cls: "func-recovery-green", icon: Check },
  warn: { cls: "func-warning-yellow", icon: AlertTriangle },
  bad: { cls: "func-danger-red", icon: AlertTriangle },
} as const;

export function EditTargetsDialog({
  open,
  onOpenChange,
  editingTargets,
  setEditingTargets,
  macroCalc,
  onSave,
}: EditTargetsDialogProps) {
  const p = parseFloat(editingTargets.protein) || 0;
  const c = parseFloat(editingTargets.carbs) || 0;
  const f = parseFloat(editingTargets.fats) || 0;
  const calGoal = parseFloat(editingTargets.calories) || 0;
  const macroTotal = p * 4 + c * 4 + f * 9;
  const diff = Math.abs(macroTotal - calGoal);
  const totalMacroG = p + c + f;
  const pPct = totalMacroG > 0 ? Math.round((p / totalMacroG) * 100) : 0;
  const cPct = totalMacroG > 0 ? Math.round((c / totalMacroG) * 100) : 0;
  const fPct = totalMacroG > 0 ? 100 - pPct - cPct : 0;
  const pct = { protein: pPct, carbs: cPct, fats: fPct } as const;
  const status: "none" | "good" | "warn" | "bad" =
    calGoal === 0 ? "none" : diff <= 20 ? "good" : diff <= 50 ? "warn" : "bad";
  const meta = status !== "none" ? STATUS_META[status] : null;

  const handleAdjust = (field: "protein" | "carbs" | "fats", value: number) => {
    if (calGoal > 0) {
      const adjusted = macroCalc.adjustMacrosToMatchCalories(field, value, { protein: p, carbs: c, fats: f }, calGoal);
      setEditingTargets((prev) => ({
        ...prev,
        protein: adjusted.protein.toString(),
        carbs: adjusted.carbs.toString(),
        fats: adjusted.fats.toString(),
      }));
      return true;
    }
    return false;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[330px] rounded-[22px] p-4 border border-border/50 bg-card/95 backdrop-blur-xl gap-0">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-bold tracking-tight text-center">Edit Targets</DialogTitle>
        </DialogHeader>
        <p className="text-[12px] text-muted-foreground text-center mt-0.5 mb-3">Override AI recommendations</p>

        {/* calorie hero + macro split bar */}
        <div className="rounded-2xl border border-border/50 bg-muted/15 px-4 py-3">
          <div className="flex items-end justify-between">
            <div className="min-w-0">
              <label htmlFor="edit-calories" className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                Daily Calories
              </label>
              <div className="mt-0.5 flex items-baseline gap-1">
                <input
                  id="edit-calories"
                  type="number"
                  inputMode="numeric"
                  placeholder="2000"
                  value={editingTargets.calories}
                  min="1"
                  required
                  onChange={(e) => {
                    const calories = e.target.value;
                    const cv = parseInt(calories) || 0;
                    const macros = cv > 0 ? macroCalc.calculateMacrosFromCalories(cv) : null;
                    setEditingTargets((prev) => ({
                      ...prev,
                      calories,
                      ...(macros ? { protein: macros.protein_g, carbs: macros.carbs_g, fats: macros.fats_g } : {}),
                    }));
                  }}
                  className="w-[120px] bg-transparent text-[34px] font-bold leading-none tracking-tight text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-sm font-medium text-muted-foreground">kcal</span>
              </div>
            </div>
            {meta && (
              <div className="flex items-center gap-1 text-[11px] font-semibold tabular-nums" style={{ color: `rgb(var(--${meta.cls}))` }}>
                <meta.icon className="h-3.5 w-3.5" strokeWidth={2.5} />
                {Math.round(macroTotal)}
              </div>
            )}
          </div>
          <div className="mt-2.5 flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted/40">
            {totalMacroG > 0 &&
              MACROS.map((m) => (
                <motion.div
                  key={m.key}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{ background: `rgb(${m.rgb})` }}
                  animate={{ width: `${pct[m.key]}%` }}
                  transition={{ type: "spring", stiffness: 320, damping: 34 }}
                />
              ))}
          </div>
        </div>

        {/* macro rows */}
        <div className="mt-3 space-y-2">
          {MACROS.map((m) => (
            <div key={m.key} className="flex items-center gap-3 rounded-xl border border-border/40 bg-muted/10 px-3 py-2">
              <span className="h-7 w-1 shrink-0 rounded-full" style={{ background: `rgb(${m.rgb})` }} />
              <div className="min-w-0">
                <label htmlFor={`edit-${m.key}`} className="text-[13px] font-semibold leading-tight block">
                  {m.label}
                </label>
                <div className="text-[10px] font-medium text-muted-foreground">{pct[m.key]}% of intake</div>
              </div>
              <div className="ml-auto flex items-baseline gap-0.5">
                <input
                  id={`edit-${m.key}`}
                  type="number"
                  inputMode="numeric"
                  step="1"
                  placeholder="0"
                  value={editingTargets[m.key]}
                  min="0"
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    if (!handleAdjust(m.key, val)) setEditingTargets((prev) => ({ ...prev, [m.key]: e.target.value }));
                  }}
                  className="w-[52px] bg-transparent text-right text-[22px] font-bold leading-none tracking-tight text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-[12px] font-medium text-muted-foreground">g</span>
              </div>
            </div>
          ))}
        </div>

        {/* actions */}
        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={onSave}
            className="w-full rounded-xl bg-primary py-2.5 text-[14px] font-semibold text-primary-foreground active:opacity-90 transition-opacity"
          >
            Save Targets
          </button>
          <button
            onClick={() => onOpenChange(false)}
            className="w-full py-1 text-[13px] font-medium text-muted-foreground active:opacity-70 transition-opacity"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
