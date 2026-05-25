import { useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";

export interface AiIngredientItem {
  name: string;
  quantity: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  bbox?: { x: number; y: number; w: number; h: number };
}

interface AiIngredientListProps {
  items: AiIngredientItem[];
  onChange: (next: AiIngredientItem[]) => void;
}

/**
 * Editable list of foods the meal-photo AI detected. Replaces the
 * previous on-image bubble labels — the photo now renders clean and
 * this list is the canonical edit surface for per-item calories,
 * quantity, and macro adjustments.
 *
 * Editing calories on a row scales the macros proportionally (so users
 * don't have to redo all four numbers when correcting a portion).
 * Mutating any row triggers a single `onChange(next)` so the parent
 * can recompute totals and clear any stale macro overrides.
 */
export function AiIngredientList({ items, onChange }: AiIngredientListProps) {
  const updateItem = useCallback(
    (idx: number, patch: Partial<AiIngredientItem>) => {
      onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
    },
    [items, onChange],
  );

  const removeItem = useCallback(
    (idx: number) => {
      triggerHapticSelection();
      onChange(items.filter((_, i) => i !== idx));
    },
    [items, onChange],
  );

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-0.5">
        <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60">
          Detected foods
        </p>
        <p className="text-[10px] text-muted-foreground/50">
          Tap to adjust
        </p>
      </div>
      <div className="space-y-1.5">
        <AnimatePresence initial={false}>
          {items.map((item, idx) => (
            <motion.div
              key={`${item.name}-${idx}`}
              layout
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            >
              <IngredientRow
                item={item}
                onUpdate={(patch) => updateItem(idx, patch)}
                onRemove={() => removeItem(idx)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface IngredientRowProps {
  item: AiIngredientItem;
  onUpdate: (patch: Partial<AiIngredientItem>) => void;
  onRemove: () => void;
}

function IngredientRow({ item, onUpdate, onRemove }: IngredientRowProps) {
  const scaleMacros = (newCalories: number) => {
    if (!Number.isFinite(newCalories) || newCalories < 0) return;
    const oldCal = item.calories || 1;
    const ratio = newCalories / oldCal;
    onUpdate({
      calories: Math.round(newCalories),
      protein_g: Math.round(item.protein_g * ratio * 10) / 10,
      carbs_g: Math.round(item.carbs_g * ratio * 10) / 10,
      fats_g: Math.round(item.fats_g * ratio * 10) / 10,
    });
  };

  const adjustCalories = (delta: number) => {
    triggerHapticSelection();
    const next = Math.max(0, Math.round(item.calories + delta));
    scaleMacros(next);
  };

  return (
    <div className="rounded-xs bg-muted/30 border border-border/30 px-3 py-2.5 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-foreground truncate leading-tight">
            {capitalize(item.name)}
          </p>
          <Input
            value={item.quantity}
            onChange={(e) => onUpdate({ quantity: e.target.value })}
            placeholder="Quantity"
            className="h-6 mt-0.5 px-1 text-[12px] text-muted-foreground/80 bg-transparent border-0 rounded-xs focus-visible:ring-0 focus-visible:bg-muted/40 placeholder:text-muted-foreground/40"
          />
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => adjustCalories(-10)}
            disabled={item.calories <= 0}
            aria-label="Decrease calories"
            className="h-7 w-7 rounded-full bg-muted/60 flex items-center justify-center text-foreground/80 active:bg-muted/80 transition-colors disabled:opacity-30"
          >
            <Icon name="removeOutline" size={12} />
          </button>
          <div className="w-14 text-center">
            <Input
              type="number"
              inputMode="numeric"
              value={item.calories}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (Number.isFinite(n)) scaleMacros(n);
              }}
              className="h-8 text-center text-[14px] font-bold tabular-nums bg-background/60 border-border/30 px-1 rounded-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              aria-label={`Calories for ${item.name}`}
            />
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/50 mt-0.5">kcal</p>
          </div>
          <button
            type="button"
            onClick={() => adjustCalories(10)}
            aria-label="Increase calories"
            className="h-7 w-7 rounded-full bg-muted/60 flex items-center justify-center text-foreground/80 active:bg-muted/80 transition-colors"
          >
            <Icon name="addOutline" size={12} />
          </button>
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-muted-foreground/50 active:text-destructive active:bg-destructive/10 transition-colors"
          aria-label={`Remove ${item.name}`}
        >
          <Icon name="closeOutline" size={14} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[10px] tabular-nums">
        <span className="px-1.5 py-0.5 rounded-xs bg-[rgb(var(--func-protein-blue)/0.12)] text-foreground font-semibold">
          {Math.round(item.protein_g)}P
        </span>
        <span className="px-1.5 py-0.5 rounded-xs bg-[rgb(var(--func-carbs-orange)/0.12)] text-foreground font-semibold">
          {Math.round(item.carbs_g)}C
        </span>
        <span className="px-1.5 py-0.5 rounded-xs bg-[rgb(var(--func-fats-purple)/0.12)] text-foreground font-semibold">
          {Math.round(item.fats_g)}F
        </span>
      </div>
    </div>
  );
}
