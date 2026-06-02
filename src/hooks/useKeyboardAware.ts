import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/**
 * iOS-friendly keyboard-aware hook.
 *
 * Listens to `window.visualViewport` resize events and returns the current
 * height the on-screen keyboard is occupying. Components anchored to the
 * bottom of the screen (bottom sheets, dialogs) can use this to pad
 * themselves so the focused input remains visible.
 *
 * Works on:
 *   - iOS Capacitor (uses visualViewport — supported since iOS 13)
 *   - Web (mobile Safari, Chrome — supported in all modern browsers)
 *   - Desktop (always returns 0)
 *
 * Returns:
 *   - `keyboardHeight: number` — pixels of vertical space the keyboard
 *     currently occupies. 0 when no keyboard, never negative.
 */
export function useKeyboardAware(): { keyboardHeight: number } {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return; // SSR or very old browser

    let raf: number | null = null;

    const update = () => {
      // The visible viewport's height shrinks when the keyboard opens.
      // Difference between the layout viewport and visual viewport tells
      // us how much the keyboard is occupying.
      const innerHeight = window.innerHeight;
      const viewportHeight = vv.height;
      const offsetTop = vv.offsetTop ?? 0;
      // Compute keyboard height; clamp at 0 to never go negative on
      // miscellaneous viewport jumps (orientation, browser chrome, etc.)
      const height = Math.max(0, innerHeight - viewportHeight - offsetTop);
      setKeyboardHeight(height);
    };

    const onResize = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        update();
      });
    };

    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    update();

    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  return { keyboardHeight };
}

/**
 * Returns a ref + an onFocus handler. Attach both to an input. When the
 * input gains focus, smooth-scrolls it into the center of the viewport
 * after a tiny delay so the keyboard has time to open first.
 *
 * Note: this is a separate helper from `src/hooks/useScrollIntoViewOnFocus.ts`
 * which exposes an event-handler-only API. Use this variant when you'd
 * rather attach a ref + handler pair to your input.
 */
export function useScrollIntoViewOnFocus<
  T extends HTMLElement,
>(): { ref: RefObject<T>; onFocus: () => void } {
  const ref = useRef<T | null>(null);
  const onFocus = useCallback(() => {
    // Wait one frame so the keyboard begins its animation and the
    // visualViewport has resized, otherwise the scroll target is wrong.
    requestAnimationFrame(() => {
      // Second rAF after a 200ms tick — total ~220ms which matches iOS
      // keyboard show duration. Then smooth-scroll the input to center.
      setTimeout(() => {
        ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
    });
  }, []);
  return { ref: ref as RefObject<T>, onFocus };
}
