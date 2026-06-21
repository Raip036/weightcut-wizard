// WP-T18: BackToTopFAB
// Floating circular "scroll to top" button that appears once the user has
// scrolled past the configured threshold (default: 2× viewport height).
//
// Behaviour:
//   - Listens to `window` scroll with a rAF throttle so we avoid layout
//     thrash on rapid scroll events.
//   - Slides in from below + fades when shown; reverses on hide.
//   - Sits above the tab bar via `bottom-[calc(env(safe-area-inset-bottom)+88px)]`.
//   - Tap → smooth scroll to top + selection haptic.
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";

export interface BackToTopFABProps {
  /** Pixel scroll position above which the FAB becomes visible.
   *  Defaults to `2 * window.innerHeight`. */
  threshold?: number;
  className?: string;
}

export function BackToTopFAB({ threshold, className = "" }: BackToTopFABProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let raf: number | null = null;
    const computeThreshold = () =>
      threshold ??
      (typeof window !== "undefined" ? 2 * window.innerHeight : Infinity);

    const onScroll = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        setVisible(window.scrollY > computeThreshold());
      });
    };

    // Run once so the FAB shows immediately if the user lands deep-scrolled.
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [threshold]);

  const handleClick = () => {
    void triggerHapticSelection();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <button
      type="button"
      role="button"
      aria-label="Back to top"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={handleClick}
      className={`fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-40 h-11 w-11 card-surface rounded-full border border-border/40 shadow-md flex items-center justify-center text-foreground transition-all duration-200 ease-out ${
        visible
          ? "opacity-100 translate-y-0 pointer-events-auto"
          : "opacity-0 translate-y-3 pointer-events-none"
      } ${className}`.trim()}
    >
      <Icon name="chevronUpOutline" size={20} />
    </button>
  );
}
