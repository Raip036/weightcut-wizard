import { Share } from "@capacitor/share";
import { Capacitor } from "@capacitor/core";
import { logger } from "@/lib/logger";

export interface ShareInviteArgs {
  gymName: string;
  code: string;
  origin?: string;
}

export interface ShareInviteResult {
  via: "native" | "web-share" | "clipboard" | "none";
}

/**
 * Universal share for gym invite codes.
 * Order of preference: Capacitor native share → navigator.share → clipboard.
 * Returns which channel was used so the caller can toast accordingly.
 */
// Canonical public site for invite links. We deliberately do NOT fall back to
// `window.location.origin`: on the native app that is `capacitor://localhost`
// and in a preview build it could be a builder/preview domain, neither of which
// is a shareable address. Invite links must always point at the public site.
const PUBLIC_SITE = "https://fightcampwizard.com";

export async function shareGymInvite({ gymName, code, origin }: ShareInviteArgs): Promise<ShareInviteResult> {
  const baseOrigin = origin || PUBLIC_SITE;
  const url = `${baseOrigin}/join?code=${encodeURIComponent(code)}`;
  const title = `Join ${gymName} on FightCamp Wizard`;
  const text = `Join my gym ${gymName} on FightCamp Wizard. Code: ${code}`;

  // 1. Native iOS / Android share sheet
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ title, text, url, dialogTitle: "Invite to gym" });
      return { via: "native" };
    } catch (err: any) {
      // User-cancel is not an error; bubble out cleanly.
      if (err?.message?.toLowerCase?.().includes("cancel")) return { via: "none" };
      logger.warn("shareGymInvite: native share failed", { error: String(err) });
    }
  }

  // 2. Web Share API (Safari, modern browsers)
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return { via: "web-share" };
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        logger.warn("shareGymInvite: web share failed", { error: String(err) });
      } else {
        return { via: "none" };
      }
    }
  }

  // 3. Clipboard fallback
  try {
    await navigator.clipboard.writeText(url);
    return { via: "clipboard" };
  } catch (err) {
    logger.error("shareGymInvite: clipboard fallback failed", err);
    return { via: "none" };
  }
}
