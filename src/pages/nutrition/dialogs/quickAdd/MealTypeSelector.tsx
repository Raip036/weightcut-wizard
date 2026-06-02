import { motion } from "motion/react";
import { triggerHapticSelection } from "@/lib/haptics";

/**
 * 4-up "LOG TO" segmented pill row used at the top of the Add-a-meal sheet.
 * Mirrors the existing meal-type chip behaviour from the old QuickAddDialog:
 * tapping a pill flips the `meal_type` field on the form state and fires
 * a haptic tick. Active pill paints with the primary tint.
 */
export const MEAL_TYPES = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
] as const;

export type MealType = (typeof MEAL_TYPES)[number]["value"];

interface MealTypeSelectorProps {
  value: string;
  onChange: (value: MealType) => void;
}

export function MealTypeSelector({ value, onChange }: MealTypeSelectorProps) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60 mb-1.5">
        Log to
      </p>
      <div className="grid grid-cols-4 gap-1.5">
        {MEAL_TYPES.map((t, i) => {
          const active = value === t.value;
          return (
            <motion.button
              key={t.value}
              type="button"
              onClick={() => {
                if (!active) {
                  triggerHapticSelection();
                  onChange(t.value);
                }
              }}
              aria-pressed={active}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              className={`h-9 rounded-2xl text-[12px] font-semibold transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/40 text-muted-foreground/80 active:bg-muted/60"
              }`}
            >
              {t.label}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
