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

/**
 * Module-level set of image URLs that have been fully DECODED (not merely
 * fetched). Populated by `preloadAndDecodeImages` below. Read at hook init
 * so a card whose image is already decode-ready mounts at `ready` (opacity
 * 1) with NO fade — this is what makes the tap-to-advance deck feel local:
 * when a background card is promoted to the top it remounts, and without
 * this it would replay its 0→1 opacity fade on an already-visible image.
 *
 * Never shrinks. Image bitmaps are bounded per session (feeds cap well
 * under a few hundred), and a decoded URL stays decoded, so there's no
 * correctness reason to evict.
 */
export const decodedImageUrls = new Set<string>();

// Holds in-flight preload <img> elements so the browser doesn't GC them
// (and abort the decode) before `decode()` resolves.
const inflightDecodes = new Set<HTMLImageElement>();

/**
 * Warm AND decode a batch of image URLs ahead of time. `new Image().src`
 * alone only fills the HTTP cache; the bitmap stays undecoded until first
 * paint, which on iOS WKWebView causes a visible decode hitch when the
 * image is promoted to full size. `HTMLImageElement.decode()` resolves
 * only once the bitmap is fully paint-ready, so by promotion time there's
 * no decode work left.
 *
 * Fully error-tolerant: `decode()` rejects on a load error or if the
 * element is detached (EncodingError / AbortError). Those are benign for a
 * prefetch — we simply don't mark the URL decoded and fall back to the
 * normal lazy/eager <img> load at paint time.
 */
export function preloadAndDecodeImages(urls: Array<string | null | undefined>): void {
  for (const url of urls) {
    if (!url || decodedImageUrls.has(url)) continue;
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    inflightDecodes.add(img);
    const settle = () => inflightDecodes.delete(img);
    img.decode().then(
      () => {
        decodedImageUrls.add(url);
        settle();
      },
      settle, // swallow — failed prefetch falls back to normal load
    );
  }
}

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
  // Lazy-init to "ready" when the URL is already known-decoded (see
  // `decodedImageUrls`). This is the key to a flash-free promotion: a
  // freshly-mounted <img> for an already-decoded URL renders at opacity 1
  // on its very first paint instead of starting at 0 and fading in.
  const [status, dispatch] = useReducer(
    imageStatusReducer,
    src,
    (s) => (s && decodedImageUrls.has(s) ? "ready" : "loading"),
  );
  const imgRef = useRef<HTMLImageElement | null>(null);
  const mounted = useRef(false);

  // Reset on src CHANGE only (skip the initial mount so the ref's cached
  // detection below isn't clobbered). On change, reconcile immediately with
  // the actual element — or the decoded-URL set — in case the new src is
  // already ready, so we never flash through "loading".
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const alreadyReady = isComplete(imgRef.current) || (!!src && decodedImageUrls.has(src));
    dispatch(alreadyReady ? { type: "load" } : { type: "reset" });
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
