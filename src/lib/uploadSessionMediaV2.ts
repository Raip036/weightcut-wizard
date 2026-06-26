/**
 * Multi-attachment upload helper for the new `session_media` table.
 *
 * Replaces the legacy single-mediaUrl flow in `uploadSessionMedia.ts`
 * (which patched `fight_camp_calendar.mediaStorageId` directly). The new
 * flow:
 *   1. mutation `fight_camp.generateMediaUploadUrl` → one-time POST URL.
 *   2. fetch(uploadUrl, { method: "POST", body: file }) → returns storageId.
 *   3. mutation `fight_camp.addSessionMedia({ sessionId, storageId, kind })`
 *      writes the row + cascades to the chronological library.
 *
 * Caller passes the file (from <input type="file"> or Capacitor Camera)
 * and the session id. We sniff the MIME prefix to decide kind=photo|video
 * so the lightbox can pick the right element without sniffing again.
 */
import { ConvexReactClient } from "convex/react";
import { convex as defaultConvex } from "@/integrations/convex/client";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { logger } from "@/lib/logger";
import { generateImageThumb } from "@/lib/imageThumb";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB — videos can be chunky
const UPLOAD_TIMEOUT_MS = 30_000;
const ALLOWED_PREFIXES = ["image/", "video/"];

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms),
    ),
  ]);
}

export interface UploadedSessionMedia {
  /** session_media row id, returned by addSessionMedia. */
  mediaId: Id<"session_media">;
  kind: "photo" | "video";
}

export async function uploadSessionMediaV2(
  sessionId: Id<"fight_camp_calendar">,
  file: File,
  opts?: {
    caption?: string;
    capturedAt?: string;
    /** Defaults to "gym" server-side. Pass "private" from the round-card
     *  "Log only" CTA so the polaroid lands in private history without
     *  surfacing on the gym feed (spec §3.6). */
    visibility?: "gym" | "private";
  },
  client: ConvexReactClient = defaultConvex,
): Promise<UploadedSessionMedia> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("File is too large. Maximum size is 50MB.");
  }
  const mime = file.type || "image/jpeg";
  if (!ALLOWED_PREFIXES.some((p) => mime.startsWith(p))) {
    throw new Error("Unsupported file type. Pick an image or video.");
  }
  const kind: "photo" | "video" = mime.startsWith("video/") ? "video" : "photo";

  logger.info("uploadSessionMediaV2: starting upload", {
    sessionId,
    size: file.size,
    type: mime,
  });

  // 1. Mint a one-time upload URL.
  const uploadUrl = (await withTimeout(
    client.mutation(api.fight_camp.generateMediaUploadUrl, {}),
    UPLOAD_TIMEOUT_MS,
    "Generate upload URL",
  )) as string;

  // 2. POST the file bytes.
  const uploadRes = await withTimeout(
    fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": mime },
      body: file,
    }),
    UPLOAD_TIMEOUT_MS,
    "Upload session media",
  );
  if (!uploadRes.ok) {
    throw new Error(`Upload failed (${uploadRes.status})`);
  }
  const { storageId } = (await uploadRes.json()) as {
    storageId: Id<"_storage">;
  };

  // 2b. BEST-EFFORT: synthesize a 256px thumb + tiny LQIP for photos so the
  // gallery never fetches full-resolution originals. This must NEVER fail or
  // block the main upload — any error just drops the thumb fields and we
  // persist the row exactly as before. Videos skip this entirely.
  let thumbStorageId: Id<"_storage"> | undefined;
  let thumbDataUrl: string | undefined;
  let thumbWidth: number | undefined;
  let thumbHeight: number | undefined;

  if (kind === "photo") {
    const thumb = await generateImageThumb(file).catch(() => null);
    if (thumb) {
      // Intrinsic dimensions + LQIP are cheap and useful for aspect-locking,
      // so we keep them even if the thumb-blob upload below fails.
      thumbWidth = thumb.width;
      thumbHeight = thumb.height;
      thumbDataUrl = thumb.thumbDataUrl || undefined;

      // Upload the thumb blob as a SECOND storage object. Wrapped so any
      // failure leaves thumbStorageId undefined and the main flow continues.
      try {
        const thumbUploadUrl = (await withTimeout(
          client.mutation(api.fight_camp.generateMediaUploadUrl, {}),
          UPLOAD_TIMEOUT_MS,
          "Generate thumb upload URL",
        )) as string;

        const thumbRes = await withTimeout(
          fetch(thumbUploadUrl, {
            method: "POST",
            headers: { "Content-Type": "image/jpeg" },
            body: thumb.thumbBlob,
          }),
          UPLOAD_TIMEOUT_MS,
          "Upload session media thumb",
        );
        if (!thumbRes.ok) {
          throw new Error(`Thumb upload failed (${thumbRes.status})`);
        }
        const parsed = (await thumbRes.json()) as { storageId: Id<"_storage"> };
        thumbStorageId = parsed.storageId;
      } catch (err) {
        thumbStorageId = undefined;
        logger.warn("uploadSessionMediaV2: thumb upload failed, continuing", {
          error: String(err),
        });
      }
    }
  }

  // 3. Persist the session_media row. capturedAt defaults to the session
  // date server-side when omitted.
  const mediaId = (await client.mutation(api.fight_camp.addSessionMedia, {
    sessionId,
    storageId,
    kind,
    caption: opts?.caption,
    capturedAt: opts?.capturedAt,
    visibility: opts?.visibility,
    thumbStorageId,
    thumbDataUrl,
    width: thumbWidth,
    height: thumbHeight,
  })) as Id<"session_media">;

  return { mediaId, kind };
}
