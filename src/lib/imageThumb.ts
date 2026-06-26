/**
 * Client-side thumbnail + LQIP generation for the training-media gallery.
 *
 * Goal: the gallery should never have to fetch full-resolution images. When a
 * photo is uploaded we synthesize two cheap byproducts on-device:
 *   - `thumbBlob`  : a 256px-longest-edge JPEG (q ~0.72) uploaded as a second
 *                    storage object the gallery loads instead of the original.
 *   - `thumbDataUrl`: a tiny (~24px) base64 LQIP for instant blur-up + aspect
 *                     locking before the thumb arrives.
 * We also surface the intrinsic `width`/`height` so callers can reserve layout
 * space and avoid reflow.
 *
 * This mirrors the OffscreenCanvas/HTMLCanvasElement + convertToBlob/toBlob
 * downscale pattern already used by `downscaleDataUrl` in `capturePhoto.ts`
 * so the approach stays consistent with the rest of the codebase. No new deps.
 *
 * Everything here is BEST-EFFORT: any failure returns `null` and the caller
 * proceeds with the main upload untouched. Nothing in this module throws.
 */
import { logger } from "@/lib/logger";

const THUMB_MAX_EDGE = 256;
const LQIP_MAX_EDGE = 24;
const THUMB_QUALITY = 0.72;
const LQIP_QUALITY = 0.4;
/** Safety ceiling for the inline LQIP so we never bloat the mutation payload. */
const LQIP_MAX_CHARS = 4000;

export interface GeneratedImageThumb {
  /** 256px-longest-edge JPEG, uploaded as a second storage object. */
  thumbBlob: Blob;
  /** Tiny base64 data URL for blur-up / aspect lock. "" if it could not stay small. */
  thumbDataUrl: string;
  /** Intrinsic pixel width of the source image. */
  width: number;
  /** Intrinsic pixel height of the source image. */
  height: number;
}

/** A minimal source we can draw to a canvas (ImageBitmap or HTMLImageElement). */
type DrawableSource = ImageBitmap | HTMLImageElement;

/**
 * Decode `file` into a drawable source plus its intrinsic dimensions. Tries the
 * fast `createImageBitmap` path first, falling back to an `HTMLImageElement`
 * loaded from an object URL (which we always revoke). Returns null on failure.
 */
async function decodeImage(
  file: Blob,
): Promise<{ source: DrawableSource; width: number; height: number } | null> {
  // Fast path: createImageBitmap (available in most modern browsers/WKWebView).
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return { source: bitmap, width: bitmap.width, height: bitmap.height };
      }
      // Degenerate dimensions: discard and fall through to the <img> path.
      bitmap.close?.();
    } catch {
      // Fall through to the HTMLImageElement path below.
    }
  }

  // Fallback path: HTMLImageElement via an object URL.
  let objectUrl: string | null = null;
  try {
    objectUrl = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = objectUrl as string;
    });
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) return null;
    return { source: img, width, height };
  } catch {
    return null;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/** Longest-edge-bounded target size, preserving aspect, never upscaling past the source. */
function fitDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { w: number; h: number } {
  const longest = Math.max(width, height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}

/** Draw `source` scaled to `w`x`h` onto an OffscreenCanvas when available, else a real canvas. */
function drawScaled(
  source: DrawableSource,
  w: number,
  h: number,
  preferOffscreen: boolean,
): OffscreenCanvas | HTMLCanvasElement | null {
  const useOffscreen = preferOffscreen && typeof OffscreenCanvas !== "undefined";
  const canvas: OffscreenCanvas | HTMLCanvasElement = useOffscreen
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return null;
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  return canvas;
}

/** Encode a canvas to a JPEG Blob (OffscreenCanvas → convertToBlob, else toBlob). */
async function encodeJpeg(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: "image/jpeg", quality });
  }
  return new Promise<Blob | null>((resolve) =>
    (canvas as HTMLCanvasElement).toBlob(resolve, "image/jpeg", quality),
  );
}

/**
 * Best-effort: generate a 256px thumb Blob, a tiny LQIP data URL and the
 * source's intrinsic dimensions. Returns null on any error (never throws).
 */
export async function generateImageThumb(
  file: Blob,
): Promise<GeneratedImageThumb | null> {
  try {
    const decoded = await decodeImage(file);
    if (!decoded) return null;
    const { source, width, height } = decoded;

    try {
      // 1. Thumb (256px longest edge) — prefer OffscreenCanvas for speed.
      const thumbSize = fitDimensions(width, height, THUMB_MAX_EDGE);
      const thumbCanvas = drawScaled(source, thumbSize.w, thumbSize.h, true);
      if (!thumbCanvas) return null;
      const thumbBlob = await encodeJpeg(thumbCanvas, THUMB_QUALITY);
      if (!thumbBlob) return null;

      // 2. LQIP (tiny ~24px) — must use a real HTMLCanvasElement because
      //    OffscreenCanvas has no toDataURL.
      let thumbDataUrl = "";
      try {
        const lqipSize = fitDimensions(width, height, LQIP_MAX_EDGE);
        const lqipCanvas = drawScaled(source, lqipSize.w, lqipSize.h, false);
        if (lqipCanvas && lqipCanvas instanceof HTMLCanvasElement) {
          const url = lqipCanvas.toDataURL("image/jpeg", LQIP_QUALITY);
          // Keep the inline LQIP small; drop it if it somehow bloats.
          thumbDataUrl = url.length <= LQIP_MAX_CHARS ? url : "";
        }
      } catch {
        thumbDataUrl = "";
      }

      return { thumbBlob, thumbDataUrl, width, height };
    } finally {
      // Release the ImageBitmap's backing memory when we are done with it.
      if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
        source.close?.();
      }
    }
  } catch (err) {
    logger.warn("generateImageThumb failed", { error: String(err) });
    return null;
  }
}
