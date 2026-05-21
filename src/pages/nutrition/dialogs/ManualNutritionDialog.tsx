import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ManualNutritionDialogState } from "@/pages/nutrition/types";

interface MacroCalcShape {
  debouncedMacroCalculation: (
    calories: string,
    cb: (macros: { protein_g: string; carbs_g: string; fats_g: string }) => void
  ) => void;
}

interface ManualNutritionDialogProps {
  state: ManualNutritionDialogState;
  setState: React.Dispatch<React.SetStateAction<ManualNutritionDialogState>>;
  macroCalc: MacroCalcShape;
  onSubmit: () => void;
  onClose: () => void;
}

const EMPTY_STATE: ManualNutritionDialogState = {
  open: false,
  ingredientName: "",
  grams: 0,
  calories_per_100g: "",
  protein_per_100g: "",
  carbs_per_100g: "",
  fats_per_100g: "",
};

export function ManualNutritionDialog({
  state,
  setState,
  macroCalc,
  onSubmit,
  onClose,
}: ManualNutritionDialogProps) {
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setState(EMPTY_STATE);
      onClose();
    }
  };

  return (
    <Dialog open={state.open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[300px] rounded-xs p-0 border-0 bg-card/95 backdrop-blur-xl shadow-2xl gap-0">
        <div className="px-4 pt-4 pb-2">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-semibold text-center">Enter Nutrition</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground text-center mt-0.5">
            Per 100g for "{state.ingredientName}"
          </p>
        </div>
        <div className="px-4 space-y-2.5 pb-1">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xs bg-muted/20 text-[13px]">
            <span className="font-medium flex-1">{state.ingredientName}</span>
            <span className="text-muted-foreground">{state.grams}g</span>
          </div>
          <div>
            <Label htmlFor="manual-calories-dialog" className="text-[13px] text-muted-foreground">
              Calories per 100g *
            </Label>
            <Input
              id="manual-calories-dialog"
              type="number"
              placeholder="165"
              value={state.calories_per_100g}
              onChange={(e) => {
                const calories = e.target.value;
                setState({ ...state, calories_per_100g: calories });
                macroCalc.debouncedMacroCalculation(calories, (macros) => {
                  setState((prev) => ({
                    ...prev,
                    protein_per_100g: macros.protein_g,
                    carbs_per_100g: macros.carbs_g,
                    fats_per_100g: macros.fats_g,
                  }));
                });
              }}
              className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20 mt-0.5"
            />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div>
              <Label htmlFor="manual-protein-dialog" className="text-[13px] text-muted-foreground">
                Protein
              </Label>
              <Input
                id="manual-protein-dialog"
                type="number"
                step="0.1"
                placeholder="31.0"
                value={state.protein_per_100g}
                onChange={(e) => setState({ ...state, protein_per_100g: e.target.value })}
                className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20 mt-0.5"
              />
            </div>
            <div>
              <Label htmlFor="manual-carbs-dialog" className="text-[13px] text-muted-foreground">
                Carbs
              </Label>
              <Input
                id="manual-carbs-dialog"
                type="number"
                step="0.1"
                placeholder="0.0"
                value={state.carbs_per_100g}
                onChange={(e) => setState({ ...state, carbs_per_100g: e.target.value })}
                className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20 mt-0.5"
              />
            </div>
            <div>
              <Label htmlFor="manual-fats-dialog" className="text-[13px] text-muted-foreground">
                Fats
              </Label>
              <Input
                id="manual-fats-dialog"
                type="number"
                step="0.1"
                placeholder="3.6"
                value={state.fats_per_100g}
                onChange={(e) => setState({ ...state, fats_per_100g: e.target.value })}
                className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20 mt-0.5"
              />
            </div>
          </div>
        </div>
        <div className="border-t border-border/40 mt-2">
          <button
            onClick={onSubmit}
            className="w-full py-2.5 text-[14px] font-semibold text-primary active:bg-muted/50 transition-colors"
          >
            Add Ingredient
          </button>
          <div className="border-t border-border/40" />
          <button
            onClick={() => {
              setState(EMPTY_STATE);
              onClose();
            }}
            className="w-full py-2.5 text-[14px] font-normal text-muted-foreground active:bg-muted/50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
