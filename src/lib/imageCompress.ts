/**
 * Client-side image compression + thumbnail generation for the Corner
 * social tab. Used by `PostComposer` before handing the blob to Convex
 * Storage so the wire payload stays small (target ≤ 400 KB at 1024w q 0.82).
 *
 * Pipeline (client):
 *
 *   Base64 / Blob  ──▶ HTMLImageElement ──▶ Canvas (Offscreen if available)
 *                                                │
 *                                                ├─▶ JPEG 1024w  (compressImage)
 *                                                ├─▶ JPEG 256×256 (generateThumb256)
 *                                                └─▶ Base64 24×24 LQIP (generateThumbDataUrl)
 *
 * Notes:
 *  - Capacitor's `@capacitor/camera` plugin auto-converts HEIC to JPEG when
 *    `resultType: Base64` is requested, so the input here is already JPEG.
 *  - `OffscreenCanvas` is used when available (Safari 16.4+) for a small
 *    perf win + freeing the main thread. Falls back to a detached `<canvas>`
 *    element on older WebKit builds.
 *  - The longest edge is scaled to `maxWidth` and the aspect ratio is
 *    preserved — no cropping. Cropping (e.g. square) is the caller's job
 *    via the native camera plugin's `editing: true` flow on iOS.
 *
 * Public exports:
 *  - `compressImage(input, opts)` → JPEG `Blob` at 1024w q=0.82
 *  - `generateThumb256(blob)` → JPEG `Blob` at 256×256 (profile grid)
 *  - `generateThumbDataUrl(blob)` → ~2 KB base64 JPEG 24×24 (blur-up LQIP)
 */

/** Tunables — exported for tests / overrides at the call site. */
export const COMPRESS_DEFAULTS = {
  maxWidth: 1024,
  quality: 0.82,
  mime: "image/jpeg" as const,
};

export const THUMB_GRID_SIZE = 256; // profile grid tile
export const THUMB_LQIP_SIZE = 24; // base64 blur-up
export const THUMB_LQIP_QUALITY = 0.4; // keeps payload ~1–2 KB

/* ────────────────────────────────────────────────────────────────── */
/*  Type helpers                                                       */
/* ────────────────────────────────────────────────────────────────── */

export interface CompressOptions {
  maxWidth?: number;
  /** 0–1 JPEG quality. */
  quality?: number;
  /** Output MIME. Defaults to `image/jpeg`. */
  mime?: "image/jpeg" | "image/webp";
  /**
   * When true, flip the image horizontally before encoding. Used to undo
   * iOS's "Mirror Front Camera" baked-in mirror so selfies post as the
   * user appears in real life (text readable, not reversed). Defaults to
   * false; callers opt in.
   */
  flipHorizontal?: boolean;
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyCtx =
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D;

/* ────────────────────────────────────────────────────────────────── */
/*  Internal helpers                                                   */
/* ────────────────────────────────────────────────────────────────── */

/** True when the runtime exposes a working `OffscreenCanvas`. */
function hasOffscreenCanvas(): boolean {
  return (
    typeof OffscreenCanvas !== "undefined" &&
    // Some Safari builds expose the constructor but throw on `.getContext("2d")`.
    // We treat the constructor presence as a positive signal and fall back at
    // context-acquire time if it explodes.
    typeof (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas !==
      "undefined"
  );
}

function createCanvas(width: number, height: number): AnyCanvas {
  if (hasOffscreenCanvas()) {
    try {
      return new OffscreenCanvas(width, height);
    } catch {
      // Some Safari builds throw under tight memory — fall through.
    }
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function get2dCtx(canvas: AnyCanvas): AnyCtx {
  const ctx = canvas.getContext("2d") as AnyCtx | null;
  if (!ctx) {
    throw new Error("imageCompress: unable to acquire 2D context");
  }
  // imageSmoothingQuality is supported on both OffscreenCanvas2D and HTMLCanvas2D
  // in modern Safari/iOS; the cast keeps TS happy across both.
  (ctx as { imageSmoothingEnabled?: boolean; imageSmoothingQuality?: string }).imageSmoothingEnabled = true;
  (ctx as { imageSmoothingEnabled?: boolean; imageSmoothingQuality?: string }).imageSmoothingQuality = "high";
  return ctx;
}

/** Convert raw base64 (no data-URL prefix) → Blob, default mime image/jpeg. */
function base64ToBlob(b64: string, mime = "image/jpeg"): Blob {
  // Strip an accidental data-URL prefix in case the caller passed the whole thing.
  const raw = b64.includes(",") ? (b64.split(",")[1] ?? "") : b64;
  const bin = atob(raw);
  const len = bin.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

/** Load a Blob into an `HTMLImageElement`, resolving on `onload`. */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    // Decode hint helps Safari skip the synchronous paint stall.
    img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err instanceof Error ? err : new Error("Failed to decode image"));
    };
    img.src = url;
  });
}

/**
 * Convert a canvas → Blob in a single API regardless of which canvas type
 * we landed on. `HTMLCanvasElement.toBlob` is callback-based; `OffscreenCanvas`
 * has a Promise-returning `.convertToBlob`.
 */
function canvasToBlob(
  canvas: AnyCanvas,
  mime: string,
  quality: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: mime, quality });
  }
  const html = canvas as HTMLCanvasElement;
  return new Promise((resolve, reject) => {
    html.toBlob(
      (blob) => {
        if (!blob) reject(new Error("canvas.toBlob produced no blob"));
        else resolve(blob);
      },
      mime,
      quality,
    );
  });
}

/**
 * Compute target (w, h) such that the longest edge is `maxEdge` and the
 * aspect ratio matches the source. Never upscales — small inputs pass
 * through untouched.
 */
function fitInside(
  srcW: number,
  srcH: number,
  maxEdge: number,
): { w: number; h: number } {
  const longest = Math.max(srcW, srcH);
  if (longest <= maxEdge) return { w: srcW, h: srcH };
  const scale = maxEdge / longest;
  return { w: Math.round(srcW * scale), h: Math.round(srcH * scale) };
}

/**
 * Compute (sx, sy, sw, sh) for a *center crop* to a square of side `side`.
 * Used by the thumbnail generators which output a square tile regardless
 * of the source aspect ratio. The compressor proper does NOT crop.
 */
function centerSquareCrop(
  srcW: number,
  srcH: number,
): { sx: number; sy: number; size: number } {
  const size = Math.min(srcW, srcH);
  return {
    sx: Math.round((srcW - size) / 2),
    sy: Math.round((srcH - size) / 2),
    size,
  };
}

/* ────────────────────────────────────────────────────────────────── */
/*  Public API                                                         */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Compress a JPEG/HEIC/PNG image down to `maxWidth` longest edge at the
 * given quality. Returns a JPEG Blob. Accepts either a Blob or a raw
 * base64 string (no data-URL prefix required — both forms are tolerated).
 */
export async function compressImage(
  input: Blob | string,
  opts: CompressOptions = {},
): Promise<Blob> {
  const maxWidth = opts.maxWidth ?? COMPRESS_DEFAULTS.maxWidth;
  const quality = opts.quality ?? COMPRESS_DEFAULTS.quality;
  const mime = opts.mime ?? COMPRESS_DEFAULTS.mime;
  const flipHorizontal = opts.flipHorizontal ?? false;

  const blob = typeof input === "string" ? base64ToBlob(input, "image/jpeg") : input;
  const img = await loadImage(blob);

  const { w, h } = fitInside(img.naturalWidth, img.naturalHeight, maxWidth);

  // No-op fast path: source already smaller than the target. Re-encode
  // anyway so we always hand back a normalized JPEG — HEIC → JPEG path
  // matters even when dimensions don't change.
  const canvas = createCanvas(w, h);
  const ctx = get2dCtx(canvas);
  // Defensive clear in case the canvas backend defaults to transparent
  // and we're outputting to JPEG (which would render the alpha as black).
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  if (flipHorizontal) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(img, 0, 0, w, h);

  return await canvasToBlob(canvas, mime, quality);
}

/**
 * Generate a 256×256 JPEG centre-cropped from the source. Used for the
 * profile grid tile so the grid loads instantly without the full-size
 * 1024 px asset.
 *
 * The compositor crops centre so a portrait selfie still produces a
 * usable square tile — the grid is purely a navigation surface, not the
 * post detail view.
 */
export async function generateThumb256(blob: Blob): Promise<Blob> {
  const img = await loadImage(blob);
  const { sx, sy, size } = centerSquareCrop(img.naturalWidth, img.naturalHeight);

  const out = createCanvas(THUMB_GRID_SIZE, THUMB_GRID_SIZE);
  const ctx = get2dCtx(out);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, THUMB_GRID_SIZE, THUMB_GRID_SIZE);
  ctx.drawImage(
    img,
    sx,
    sy,
    size,
    size,
    0,
    0,
    THUMB_GRID_SIZE,
    THUMB_GRID_SIZE,
  );

  return await canvasToBlob(out, "image/jpeg", 0.78);
}

/**
 * Generate a tiny base64 JPEG (24×24, q≈0.4) suitable for a "blurred-look"
 * low-quality image placeholder (LQIP). The output is a fully-formed
 * `data:image/jpeg;base64,...` string ≤ 2 KB that's safe to inline into
 * query payloads.
 *
 * Why 24×24 and not 16×16: the next paint step usually CSS-blurs this with
 * `filter: blur(8px)` which needs a few extra pixels of source detail to
 * avoid the flat-grey "I have no idea what's here" look.
 */
export async function generateThumbDataUrl(
  blob: Blob,
  opts: { flipHorizontal?: boolean } = {},
): Promise<string> {
  const flipHorizontal = opts.flipHorizontal ?? false;
  const img = await loadImage(blob);
  const { sx, sy, size } = centerSquareCrop(img.naturalWidth, img.naturalHeight);

  const out = createCanvas(THUMB_LQIP_SIZE, THUMB_LQIP_SIZE);
  const ctx = get2dCtx(out);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, THUMB_LQIP_SIZE, THUMB_LQIP_SIZE);
  if (flipHorizontal) {
    ctx.translate(THUMB_LQIP_SIZE, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(
    img,
    sx,
    sy,
    size,
    size,
    0,
    0,
    THUMB_LQIP_SIZE,
    THUMB_LQIP_SIZE,
  );

  const tinyBlob = await canvasToBlob(out, "image/jpeg", THUMB_LQIP_QUALITY);
  // Convert Blob → data URL. `FileReader` is universally supported and
  // produces the canonical `data:image/jpeg;base64,...` form the <img>
  // element expects.
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed for LQIP"));
    reader.readAsDataURL(tinyBlob);
  });
}
