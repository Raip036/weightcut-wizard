/**
 * Fires once when an element scrolls into the viewport — used to defer
 * entrance animations until the user can actually see them.
 *
 * The dashboard's section-enter animation (`dashboard-enter-stagger`) runs
 * on mount. For sections below the fold that means the fade-up plays while
 * the user is still at the top of the screen, so by the time they scroll
 * down the motion is already over. Gating the animation class behind this
 * hook means it only plays as the section enters view.
 *
 * Respects `prefers-reduced-motion`: when the user has opted out of motion
 * we report `inView` immediately so content is shown without waiting on a
 * scroll (and the CSS reduced-motion rules skip the animation anyway).
 */
import { useEffect, useRef, useState } from "react";

interface UseInViewOptions {
  /** Fraction(s) of the element that must be visible to trigger. Default 0. */
  threshold?: number | number[];
  /**
   * Viewport inset applied before measuring intersection. A negative bottom
   * (e.g. "0px 0px -20% 0px") delays the trigger until the element has
   * scrolled a little way up into view rather than firing at the very edge.
   */
  rootMargin?: string;
  /** Keep `inView` true after the first trigger (one-shot). Default true. */
  once?: boolean;
}

export function useInView<T extends HTMLElement = HTMLDivElement>({
  threshold = 0,
  rootMargin = "0px 0px -20% 0px",
  once = true,
}: UseInViewOptions = {}) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // No observer support / reduced motion → reveal immediately so the
    // content is never gated behind a scroll the user didn't ask for.
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (typeof IntersectionObserver === "undefined" || prefersReducedMotion) {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) observer.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  return { ref, inView };
}
