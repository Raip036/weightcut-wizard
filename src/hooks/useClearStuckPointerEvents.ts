import { useEffect } from "react";

/**
 * Clears a stuck `document.body { pointer-events: none }` that a Radix/vaul
 * overlay can leave behind when it closes badly. A full-screen fixed/portaled
 * wall mounted afterward would otherwise inherit it and have ALL its buttons
 * (upgrade AND dismiss) frozen. Call this at the top of any such wall; also
 * give the wall's root `pointer-events: auto` so it is immune even if the body
 * style reappears. Mirrors the guard in CampCompleteCutscene.tsx.
 */
export function useClearStuckPointerEvents(): void {
  useEffect(() => {
    if (document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
  }, []);
}
