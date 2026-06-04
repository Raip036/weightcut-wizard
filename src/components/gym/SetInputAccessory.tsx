/**
 * SetInputAccessory — a quick-increment bar docked above the keyboard while a
 * set weight/reps field is focused (the single biggest data-entry quality win).
 *
 * Mounted once in ActiveSessionView. Subscribes to `setInputBus`; when a field
 * is focused it slides in pinned to `--keyboard-inset` (the var Capacitor
 * maintains for the iOS keyboard height; 0 on web → the bar simply sits at the
 * bottom, harmless). Buttons use pointerDown + preventDefault so tapping them
 * never steals focus from the input (which would dismiss the keyboard).
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { setInputBus, type ActiveSetField } from "./setInputBus";

const WEIGHT_STEPS = [-5, -2.5, 2.5, 5];
const REPS_STEPS = [-1, 1];

export function SetInputAccessory() {
  const [active, setActive] = useState<ActiveSetField | null>(setInputBus.get());

  useEffect(() => setInputBus.subscribe(() => setActive(setInputBus.get())), []);

  const steps = active?.kind === "reps" ? REPS_STEPS : WEIGHT_STEPS;

  // pointerDown + preventDefault keeps the input focused through the tap.
  const hold = (e: React.PointerEvent) => e.preventDefault();

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="set-accessory"
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 38 }}
          className="fixed inset-x-0 z-50 flex items-center gap-2 border-t border-border/60 bg-card/95 px-3 py-2 backdrop-blur-xl"
          style={{ bottom: "var(--keyboard-inset, 0px)" }}
        >
          {steps.map((s) => (
            <button
              key={s}
              type="button"
              onPointerDown={hold}
              onClick={() => {
                triggerHaptic(ImpactStyle.Light);
                setInputBus.get()?.apply(s);
              }}
              className="flex-1 rounded-xl bg-muted/50 py-2.5 text-[15px] font-bold tabular-nums text-foreground active:scale-95"
            >
              {s > 0 ? `+${s}` : s}
            </button>
          ))}
          <button
            type="button"
            onPointerDown={hold}
            onClick={() => setInputBus.focusNext()}
            className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-[15px] font-bold text-primary-foreground active:scale-95"
          >
            Next →
          </button>
          <button
            type="button"
            onClick={() => active.el.blur()}
            className="shrink-0 rounded-xl px-3 py-2.5 text-[14px] font-semibold text-muted-foreground active:text-foreground"
          >
            Done
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
