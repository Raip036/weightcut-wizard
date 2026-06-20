import { toBlob } from "html-to-image";
import { Capacitor } from "@capacitor/core";
import { logger } from "./logger";

/**
 * Wait for every <img> inside the node to finish loading + decoding. Without
 * this, an imported asset (e.g. the wizard PNG) that hasn't decoded yet renders
 * BLANK in the captured image — which is exactly the "wizard missing from the
 * saved card" bug. Never rejects: a single broken image must not block capture.
 */
async function preloadImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          const finish = () => {
            if (typeof img.decode === "function") {
              img.decode().then(() => resolve(), () => resolve());
            } else {
              resolve();
            }
          };
          if (img.complete && img.naturalWidth > 0) {
            finish();
            return;
          }
          img.addEventListener("load", finish, { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
}

export async function captureCardAsBlob(
  element: HTMLElement,
  options?: { pixelRatio?: number; transparent?: boolean }
): Promise<Blob> {
  // Make sure embedded images (wizard asset, avatars) are decoded first.
  await preloadImages(element);

  const opts = {
    pixelRatio: options?.pixelRatio ?? 2,
    cacheBust: true,
    skipAutoScale: true,
    skipFonts: true, // skip cross-origin Google Fonts — cards use inline font-family
    ...(options?.transparent ? {} : { backgroundColor: "#080808" }),
  };

  // html-to-image embeds <img> assets asynchronously and a known quirk is that
  // the FIRST render can omit them (cache not warm yet). Run a throwaway pass to
  // warm the image/font cache, then the real capture so the wizard always lands.
  await toBlob(element, opts).catch(() => null);
  const blob = await toBlob(element, opts);
  if (!blob) throw new Error("Failed to capture card image");
  return blob;
}

export function downloadCardImage(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function shareCardImage(
  blob: Blob,
  title: string,
  text: string
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const { Share } = await import("@capacitor/share");

      // Convert blob to base64
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const fileName = `weightcut-wizard-${Date.now()}.png`;
      const result = await Filesystem.writeFile({
        path: fileName,
        data: base64,
        directory: Directory.Cache,
      });

      await Share.share({
        title,
        text,
        url: result.uri,
      });
      return;
    } catch (e) {
      logger.warn("Native share failed, falling back", { error: e });
    }
  }

  // Web Share API
  if (navigator.share && navigator.canShare) {
    const file = new File([blob], "weightcut-wizard.png", { type: "image/png" });
    const shareData = { title, text, files: [file] };
    if (navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        return;
      } catch (e) {
        // User cancelled or error — fall through to download
        if ((e as DOMException).name === "AbortError") return;
      }
    }
  }

  // Fallback: download
  downloadCardImage(blob, `weightcut-wizard-${Date.now()}.png`);
}
