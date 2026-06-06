import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";
import { useScrollIntoViewOnFocus } from "@/hooks/useScrollIntoViewOnFocus";
import { AiIngredientList, type AiIngredientItem } from "../AiIngredientList";
import type { ManualMealForm, AiLineItem } from "@/pages/nutrition/types";
import { MEAL_TYPES } from "./MealTypeSelector";

interface MacroOverrides {
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fats_g?: number;
}

interface MacrosEditorProps {
  manualMeal: ManualMealForm;
  setManualMeal: React.Dispatch<React.SetStateAction<ManualMealForm>>;
  aiLineItems: AiLineItem[];
  setAiLineItems: React.Dispatch<React.SetStateAction<AiLineItem[]>>;
  overrideTotals: MacroOverrides;
  setOverrideTotals: React.Dispatch<React.SetStateAction<MacroOverrides>>;
  photoBase64: string | null;
  savingMeal: boolean;
  onSave: () => void;
  /** Reset whole flow back to AI input (e.g. "discard / start over"). */
  onStartOver?: () => void;
  /** Show the "add a side angle" nudge (low-confidence item + room for more photos). */
  canAddAngle?: boolean;
  /** Capture another angle and re-run the analysis with all photos. */
  onAddAngle?: () => void;
}

/**
 * Post-detection macro + ingredients editor. Owns the meal-name field,
 * meal-type chip row, 2×2 macro grid (with inline-edit + Atwater cascade),
 * the editable AI-detected food list, and the primary save button.
 *
 * The Atwater cascade is preserved from the prior implementation: editing
 * a macro recomputes the calories headline; editing calories scales the
 * macros proportionally.
 */
export function MacrosEditor({
  manualMeal,
  setManualMeal,
  aiLineItems,
  setAiLineItems,
  overrideTotals,
  setOverrideTotals,
  photoBase64,
  savingMeal,
  onSave,
  canAddAngle,
  onAddAngle,
}: MacrosEditorProps) {
  const handleInputFocus = useScrollIntoViewOnFocus();
  const [editingMacro, setEditingMacro] = useState<
    null | "calories" | "protein_g" | "carbs_g" | "fats_g"
  >(null);
  const [editingDraft, setEditingDraft] = useState("");

  // Drop any in-flight edit when the parent unmounts/resets the AI flow.
  useEffect(() => {
    if (aiLineItems.length === 0) {
      setEditingMacro(null);
      setEditingDraft("");
    }
  }, [aiLineItems.length]);

  const summedAiCalories = aiLineItems.reduce((s, i) => s + i.calories, 0);
  const summedAiProtein = aiLineItems.reduce((s, i) => s + i.protein_g, 0);
  const summedAiCarbs = aiLineItems.reduce((s, i) => s + i.carbs_g, 0);
  const summedAiFats = aiLineItems.reduce((s, i) => s + i.fats_g, 0);
  const totalAiLineItemCalories = overrideTotals.calories ?? summedAiCalories;
  const totalAiProtein = overrideTotals.protein_g ?? summedAiProtein;
  const totalAiCarbs = overrideTotals.carbs_g ?? summedAiCarbs;
  const totalAiFats = overrideTotals.fats_g ?? summedAiFats;

  const beginEditMacro = (
    key: "calories" | "protein_g" | "carbs_g" | "fats_g",
    currentValue: number,
  ) => {
    triggerHapticSelection();
    setEditingMacro(key);
    setEditingDraft(String(Math.round(currentValue)));
  };

  const commitEditMacro = () => {
    if (!editingMacro) return;
    const trimmed = editingDraft.trim();
    setOverrideTotals((prev) => {
      const next = { ...prev };
      if (trimmed === "") {
        delete next[editingMacro!];
        return next;
      }
      const n = parseFloat(trimmed);
      if (!Number.isFinite(n) || n < 0) return prev;
      const rounded = Math.round(n * 10) / 10;
      next[editingMacro!] = rounded;

      const currentProtein = next.protein_g ?? summedAiProtein;
      const currentCarbs = next.carbs_g ?? summedAiCarbs;
      const currentFats = next.fats_g ?? summedAiFats;

      if (editingMacro === "calories") {
        const atwater = 4 * currentProtein + 4 * currentCarbs + 9 * currentFats;
        if (atwater > 0) {
          const ratio = rounded / atwater;
          next.protein_g = Math.round(currentProtein * ratio * 10) / 10;
          next.carbs_g = Math.round(currentCarbs * ratio * 10) / 10;
          next.fats_g = Math.round(currentFats * ratio * 10) / 10;
        }
      } else {
        next.calories = Math.round(4 * currentProtein + 4 * currentCarbs + 9 * currentFats);
      }
      return next;
    });
    setEditingMacro(null);
    setEditingDraft("");
  };

  const macros: Array<{
    key: "calories" | "protein_g" | "carbs_g" | "fats_g";
    label: string;
    value: number;
    unit: string;
    iconName: IonIconName;
    color: string;
  }> = [
    { key: "calories", label: "Calories", value: Math.round(totalAiLineItemCalories), unit: "",  iconName: "flame",  color: "rgb(var(--func-carbs-orange))" },
    { key: "carbs_g",  label: "Carbs",    value: Math.round(totalAiCarbs),            unit: "g", iconName: "pizza",  color: "rgb(var(--func-carbs-orange))" },
    { key: "protein_g",label: "Protein",  value: Math.round(totalAiProtein),          unit: "g", iconName: "fish",   color: "rgb(var(--func-protein-blue))" },
    { key: "fats_g",   label: "Fats",     value: Math.round(totalAiFats),             unit: "g", iconName: "water",  color: "rgb(var(--func-fats-purple))"  },
  ];

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Photo (clean — detected foods live in the editable list below). */}
      {photoBase64 && (
        <div className="relative w-full rounded-2xl overflow-hidden">
          <img
            src={`data:image/jpeg;base64,${photoBase64}`}
            alt="Meal"
            className="block w-full h-44 object-cover"
          />
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/25 via-transparent to-transparent" />
        </div>
      )}

      {/* Meal-type chip row + AI-generated name (editable) */}
      <div className="space-y-2">
        <div className="flex items-center justify-center gap-1.5">
          {MEAL_TYPES.map((t) => {
            const active = manualMeal.meal_type === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  setManualMeal((prev) => ({ ...prev, meal_type: t.value }));
                }}
                aria-pressed={active}
                className={`h-7 px-3 rounded-full text-[11px] font-semibold tracking-tight transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/40 text-muted-foreground/80 active:bg-muted/60"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <Input
          value={manualMeal.meal_name}
          onChange={(e) => setManualMeal((prev) => ({ ...prev, meal_name: e.target.value }))}
          placeholder="Name this meal"
          onFocus={handleInputFocus}
          className="h-12 rounded-2xl bg-transparent border-0 text-[18px] font-semibold tracking-tight text-foreground placeholder:text-muted-foreground/40 px-0 focus-visible:ring-0"
        />
      </div>

      {/* 2×2 macro grid */}
      <div className="grid grid-cols-2 gap-2">
        {macros.map((m) => {
          const isEditing = editingMacro === m.key;
          const isOverridden = overrideTotals[m.key] !== undefined;
          return (
            <div
              key={m.label}
              className={`card-surface relative rounded-2xl px-3 py-3 flex items-center gap-2.5 text-left transition-transform ${
                isEditing ? "ring-2 ring-primary/40" : "active:scale-[0.98]"
              }`}
              onClick={() => {
                if (!isEditing) beginEditMacro(m.key, m.value);
              }}
              role="button"
              tabIndex={0}
            >
              <span className="flex-shrink-0 inline-flex" style={{ color: m.color }}>
                <Icon name={m.iconName} size={20} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-muted-foreground/70 leading-none">
                  {m.label}
                  {isOverridden && !isEditing && (
                    <span className="ml-1 text-foreground/70">·&nbsp;edited</span>
                  )}
                </p>
                {isEditing ? (
                  <input
                    autoFocus
                    type="number"
                    inputMode="decimal"
                    value={editingDraft}
                    onChange={(e) => setEditingDraft(e.target.value)}
                    onBlur={commitEditMacro}
                    onFocus={handleInputFocus}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                      if (e.key === "Escape") {
                        setEditingMacro(null);
                        setEditingDraft("");
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full bg-transparent border-0 outline-none text-[15px] font-bold tabular-nums leading-none mt-1 p-0 focus:ring-0"
                    aria-label={`Edit ${m.label}`}
                  />
                ) : (
                  <p className="text-[15px] font-bold tabular-nums text-foreground leading-none mt-1">
                    {m.value}
                    <span className="text-[11px] font-semibold text-muted-foreground/60">
                      {m.unit}
                    </span>
                  </p>
                )}
              </div>
              <Icon
                name="pencilOutline"
                size={11}
                className="flex-shrink-0 text-muted-foreground/40"
              />
            </div>
          );
        })}
      </div>

      {/* Confidence-gated nudge: an item was hard to size and there's room
          for another photo — offer a side angle that re-runs the analysis. */}
      {canAddAngle && onAddAngle && (
        <button
          type="button"
          onClick={() => {
            triggerHapticSelection();
            onAddAngle();
          }}
          className="w-full flex items-center gap-2.5 rounded-2xl bg-[rgb(var(--func-warning-yellow)/0.1)] border border-[rgb(var(--func-warning-yellow)/0.28)] px-3 py-2.5 text-left active:scale-[0.99] transition-transform"
        >
          <span className="text-[rgb(var(--func-warning-yellow))] text-[15px] leading-none">⚠</span>
          <span className="flex-1 text-[12px] leading-snug text-[rgb(var(--func-warning-yellow))]/90">
            Some items were hard to size — add a side angle to sharpen the estimate.
          </span>
          <span className="shrink-0 text-[11px] font-bold text-black bg-[rgb(var(--func-warning-yellow))] rounded-lg px-2.5 py-1">
            + Angle
          </span>
        </button>
      )}

      {/* Editable detected-foods list. Mutating any row recomputes the
          macro totals above and clears stale tile overrides so the
          headline numbers stay truthful to the (now user-edited) list. */}
      <AiIngredientList
        items={aiLineItems as AiIngredientItem[]}
        onChange={(next) => {
          setAiLineItems(next);
          setOverrideTotals({});
        }}
      />

      {/* Save action */}
      <button
        onClick={onSave}
        disabled={aiLineItems.length === 0 || savingMeal}
        className="w-full h-12 rounded-2xl text-[15px] font-semibold bg-primary text-primary-foreground active:scale-[0.98] transition-transform disabled:opacity-40"
      >
        {savingMeal ? (
          <span className="inline-flex items-center gap-2">
            <Icon name="syncOutline" size={16} className="animate-spin" />
            Adding…
          </span>
        ) : (
          "Save meal"
        )}
      </button>
    </div>
  );
}
