import { useCallback, useEffect, useReducer, useRef } from "react";

/**
 * Image load state machine for feed/grid images.
 *
 * Fixes a recurring community-feed freeze: cards gated their `<img>` opacity
 * on a `loaded` flag that was set ONLY by `onLoad`, with no `onError` handler
 * and no reset when the `src` changed. When a background card was promoted to
 * the top on swipe, it remounted with the full-res `src`; if that image failed
 * or stalled (external dev `mockUrl`s, stale Convex signed URLs, iOS WKWebView
 * quirks) `onLoad` never fired, the flag stayed false, opacity stayed 0, and
 * the card froze showing only the blurred LQIP backdrop. Navigating away and
 * back rebuilt everything from a fresh query, which is why it "fixed" itself
 * until the next swipe re-entered the same path.
 *
 * This hook makes the state machine robust:
 *   - `error` is a real terminal state (via `onError`), so a failed image
 *     resolves to a visible fallback instead of an invisible frozen card.
 *   - the status resets to `loading` whenever `src` changes (promotion case).
 *   - a ref callback catches browser-cached images whose `onLoad` fired before
 *     React attached the listener (common in WKWebView) by checking
 *     `img.complete` on attach.
 */
export type ImageStatus = "loading" | "ready" | "error";

export type ImageAction = { type: "reset" } | { type: "load" } | { type: "error" };

/** Pure transition function — unit-tested, no DOM required. */
export function imageStatusReducer(state: ImageStatus, action: ImageAction): ImageStatus {
  switch (action.type) {
    case "reset":
      return "loading";
    case "load":
      return "ready";
    case "error":
      return "error";
    default:
      return state;
  }
}

export interface UseImageReady {
  status: ImageStatus;
  /** True once the image has decoded — drives fade-in opacity. */
  ready: boolean;
  /** True if the image failed — render a visible fallback, never freeze. */
  errored: boolean;
  onLoad: () => void;
  onError: () => void;
  /** ref callback for the <img> — catches already-cached images. */
  ref: (el: HTMLImageElement | null) => void;
}

function isComplete(el: HTMLImageElement | null): boolean {
  return !!el && el.complete && el.naturalWidth > 0;
}

export function useImageReady(src: string | null | undefined): UseImageReady {
  const [status, dispatch] = useReducer(imageStatusReducer, "loading");
  const imgRef = useRef<HTMLImageElement | null>(null);
  const mounted = useRef(false);

  // Reset on src CHANGE only (skip the initial mount so the ref's cached
  // detection below isn't clobbered). On change, reconcile immediately with
  // the actual element in case the new src is already cached.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    dispatch(isComplete(imgRef.current) ? { type: "load" } : { type: "reset" });
  }, [src]);

  const ref = useCallback((el: HTMLImageElement | null) => {
    imgRef.current = el;
    if (isComplete(el)) dispatch({ type: "load" });
  }, []);

  const onLoad = useCallback(() => dispatch({ type: "load" }), []);
  const onError = useCallback(() => dispatch({ type: "error" }), []);

  return {
    status,
    ready: status === "ready",
    errored: status === "error",
    onLoad,
    onError,
    ref,
  };
}
