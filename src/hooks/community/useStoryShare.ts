/**
 * Share the weekly-highlight card as a 1080×1920 PNG suitable for an
 * Instagram Story.
 *
 * Flow:
 *  1. Caller invokes `share(data)` with the same `WeeklyHighlightData`
 *     the in-feed card renders. We pre-inline every `topThumbs` image
 *     as a base64 dataURL — html-to-image renders cross-origin <img>
 *     tags as blank on iOS WKWebView unless the data is already inline.
 *  2. We flip `templateProps` so the off-screen `<WeeklyHighlightStoryTemplate>`
 *     mounts; the consumer reads `templateProps` + `templateRef` and
 *     renders the template hidden (left:-9999px).
 *  3. After a one-frame settle we rasterise via `html-to-image.toPng`,
 *     write to the Capacitor filesystem cache, and call
 *     `@capacitor/share` with `files: [uri]` — the iOS share sheet
 *     opens with Instagram Story as a first-class destination.
 *  4. Web fallback: `navigator.share({ files })` when supported, plain
 *     `<a download>` blob URL otherwise.
 */
import { useCallback, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { logger } from "@/lib/logger";
import type { WeeklyHighlightData } from "@/components/community/WeeklyHighlightCard";

export interface UseStoryShareResult {
  share: (data: WeeklyHighlightData, displayName?: string) => Promise<void>;
  isSharing: boolean;
  /** Props to feed into the off-screen `<WeeklyHighlightStoryTemplate>`.
   *  When null, don't mount the template. */
  templateProps: {
    data: WeeklyHighlightData;
    inlinedThumbs: string[];
    displayName?: string;
  } | null;
  templateRef: React.RefObject<HTMLDivElement>;
}

export function useStoryShare(): UseStoryShareResult {
  const [isSharing, setIsSharing] = useState(false);
  const [templateProps, setTemplateProps] = useState<
    UseStoryShareResult["templateProps"]
  >(null);
  const templateRef = useRef<HTMLDivElement>(null);

  const share = useCallback(
    async (data: WeeklyHighlightData, displayName?: string) => {
      if (isSharing) return;
      setIsSharing(true);
      try {
        // 1. Inline every thumb as a data URL so html-to-image can paint
        //    them. Convex storage usually serves CORS-friendly assets,
        //    but iOS WKWebView still blanks cross-origin tags during
        //    foreignObject serialisation — pre-inlining is the safe path.
        const inlinedThumbs = await Promise.all(
          data.topThumbs.map(async (url) => {
            try {
              const res = await fetch(url, { mode: "cors" });
              const blob = await res.blob();
              return await blobToDataUrl(blob);
            } catch (err) {
              logger.warn("Story share: failed to inline thumb", {
                url,
                err: String(err),
              });
              return url; // fall back to the live URL; better than nothing
            }
          }),
        );

        // 2. Mount the off-screen template via state. Wait two animation
        //    frames so the browser flushes layout before the snapshot.
        setTemplateProps({ data, inlinedThumbs, displayName });
        await nextFrame();
        await nextFrame();

        const node = templateRef.current;
        if (!node) throw new Error("Story template ref not attached");

        // 3. Rasterise. Width/height match the off-screen template's
        //    intrinsic 1080×1920, so pixelRatio: 1 produces a Story-ready
        //    PNG without scaling artefacts. `cacheBust` defeats WKWebView
        //    aggressive image caching from prior shares.
        const dataUrl = await toPng(node, {
          width: 1080,
          height: 1920,
          pixelRatio: 1,
          cacheBust: true,
          backgroundColor: "#000000",
        });

        // 4. Persist + share via the right transport for the runtime.
        if (Capacitor.isNativePlatform()) {
          await shareOnCapacitor(dataUrl);
        } else {
          await shareOnWeb(dataUrl);
        }
      } catch (err) {
        logger.error("Story share failed", { err: String(err) });
        // Re-throw so the caller can toast; the UI's catch path keeps
        // the button enabled.
        throw err;
      } finally {
        setTemplateProps(null);
        setIsSharing(false);
      }
    },
    [isSharing],
  );

  return { share, isSharing, templateProps, templateRef };
}

/* ─── transports ─── */

async function shareOnCapacitor(dataUrl: string): Promise<void> {
  // Strip the data: prefix — Filesystem.writeFile expects raw base64.
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const fileName = `weekly-highlight-${Date.now()}.png`;
  const written = await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
  });
  const uri = written.uri;
  await Share.share({
    title: "My week of training",
    text: "My week at the gym",
    files: [uri],
    dialogTitle: "Share to Instagram Story",
  });
}

async function shareOnWeb(dataUrl: string): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], "weekly-highlight.png", { type: "image/png" });
  type ShareWithFiles = (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
  const navAny = navigator as Navigator & { share?: ShareWithFiles; canShare?: (data: { files: File[] }) => boolean };
  const canFileShare =
    typeof navAny.share === "function" &&
    typeof navAny.canShare === "function" &&
    navAny.canShare({ files: [file] });
  if (canFileShare && navAny.share) {
    await navAny.share({
      files: [file],
      title: "My week of training",
      text: "My week at the gym",
    });
    return;
  }
  // Last resort: trigger a browser download so the user has the asset.
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = "weekly-highlight.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/* ─── helpers ─── */

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
