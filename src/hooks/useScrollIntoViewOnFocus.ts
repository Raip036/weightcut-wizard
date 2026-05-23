import { useCallback, type FocusEvent } from "react";

/**
 * Keeps a focused input visible above the iOS software keyboard.
 *
 * Pairs with `Keyboard.resize: "none"` in capacitor.config.ts and the
 * `--keyboard-inset` mirror in src/main.tsx — those keep the WKWebView
 * height stable, this nudges the focused field into the middle of its
 * scroll container after the keyboard animation has landed.
 *
 * The setTimeout delay (default 320ms) matches the iOS keyboard slide-in
 * (~250ms) plus a small buffer so the layout has settled before scrolling.
 */
export function useScrollIntoViewOnFocus(delayMs = 320) {
  return useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const el = event.currentTarget;
      if (!el) return;
      window.setTimeout(() => {
        if (document.activeElement === el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, delayMs);
    },
    [delayMs],
  );
}
