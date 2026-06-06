/**
 * setInputBus — a tiny module bus connecting the currently-focused set
 * weight/reps field to the floating keyboard accessory bar.
 *
 * Kept out of React context because the focused field changes on every tap
 * across many rows; a subscribe/emit singleton is lighter than threading a
 * provider through ExerciseBlock → SetRow. The accessory bar reads the active
 * field and calls `apply(delta)` (±2.5 / ±5) or `next()` (advance focus).
 */

export interface ActiveSetField {
  /** Unique key per field — `${setId}:${kind}`. */
  key: string;
  kind: "weight" | "reps";
  /** The input element — used to advance focus to the next field. */
  el: HTMLInputElement;
  /** Apply a signed delta to the field's current numeric value. */
  apply: (delta: number) => void;
}

let active: ActiveSetField | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const setInputBus = {
  focus(field: ActiveSetField) {
    active = field;
    emit();
  },
  blur(key: string) {
    if (active?.key === key) {
      active = null;
      emit();
    }
  },
  get(): ActiveSetField | null {
    return active;
  },
  /** Move focus to the next set field in DOM order (weight → reps → next row). */
  focusNext() {
    if (!active) return;
    const all = Array.from(
      document.querySelectorAll<HTMLInputElement>("[data-setfield]"),
    );
    const i = all.indexOf(active.el);
    if (i >= 0 && i < all.length - 1) {
      all[i + 1].focus();
      all[i + 1].select?.();
    } else {
      active.el.blur();
    }
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
