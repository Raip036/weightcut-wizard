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

  // 3. Persist the session_media row. capturedAt defaults to the session
  // date server-side when omitted.
  const mediaId = (await client.mutation(api.fight_camp.addSessionMedia, {
    sessionId,
    storageId,
    kind,
    caption: opts?.caption,
    capturedAt: opts?.capturedAt,
    visibility: opts?.visibility,
  })) as Id<"session_media">;

  return { mediaId, kind };
}
