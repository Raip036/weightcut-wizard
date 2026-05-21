import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const color =
    calGoal === 0 ? "text-muted-foreground" : diff <= 20 ? "text-func-recovery-green" : diff <= 50 ? "text-func-warning-yellow" : "text-func-danger-red";

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
      <DialogContent className="sm:max-w-[300px] rounded-xs p-0 border-0 bg-card/95 backdrop-blur-xl gap-0">
        <div className="px-4 pt-4 pb-2">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-semibold text-center">Edit Targets</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground text-center mt-0.5">Override AI recommendations</p>
        </div>
        <div className="px-4 space-y-2.5 pb-1">
          <div>
            <Label htmlFor="edit-calories" className="text-[13px] text-muted-foreground">
              Daily Calories *
            </Label>
            <Input
              id="edit-calories"
              type="number"
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
              className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20 mt-0.5"
            />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div>
              <Label htmlFor="edit-protein" className="text-[13px] text-muted-foreground">Protein</Label>
              <Input
                id="edit-protein"
                type="number"
                step="1"
                placeholder="150"
                value={editingTargets.protein}
                min="0"
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  if (!handleAdjust("protein", val)) setEditingTargets((prev) => ({ ...prev, protein: e.target.value }));
                }}
                className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20 mt-0.5"
              />
            </div>
            <div>
              <Label htmlFor="edit-carbs" className="text-[13px] text-muted-foreground">Carbs</Label>
              <Input
                id="edit-carbs"
                type="number"
                step="1"
                placeholder="200"
                value={editingTargets.carbs}
                min="0"
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  if (!handleAdjust("carbs", val)) setEditingTargets((prev) => ({ ...prev, carbs: e.target.value }));
                }}
                className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20 mt-0.5"
              />
            </div>
            <div>
              <Label htmlFor="edit-fats" className="text-[13px] text-muted-foreground">Fats</Label>
              <Input
                id="edit-fats"
                type="number"
                step="1"
                placeholder="65"
                value={editingTargets.fats}
                min="0"
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  if (!handleAdjust("fats", val)) setEditingTargets((prev) => ({ ...prev, fats: e.target.value }));
                }}
                className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20 mt-0.5"
              />
            </div>
          </div>
          {calGoal > 0 && (
            <p className={`text-[13px] font-medium ${color}`}>
              Macro total: {Math.round(macroTotal)} / {Math.round(calGoal)} kcal &bull; {pPct}% P / {cPct}% C / {fPct}% F
            </p>
          )}
        </div>
        <div className="border-t border-border/40 mt-2">
          <button
            onClick={onSave}
            className="w-full py-2.5 text-[14px] font-semibold text-primary active:bg-muted/50 transition-colors"
          >
            Save Targets
          </button>
          <div className="border-t border-border/40" />
          <button
            onClick={() => onOpenChange(false)}
            className="w-full py-2.5 text-[14px] font-normal text-muted-foreground active:bg-muted/50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
