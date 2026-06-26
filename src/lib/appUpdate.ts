import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { logger } from "@/lib/logger";

const BUNDLE_ID = "com.weightcutwizard.app";
const LOOKUP_URL = `https://itunes.apple.com/lookup?bundleId=${BUNDLE_ID}`;
const LOOKUP_TIMEOUT_MS = 8000;

export interface AppUpdateInfo {
  updateAvailable: boolean;
  currentVersion: string; // installed CFBundleShortVersionString
  latestVersion: string | null; // App Store version, null if lookup failed/empty
  storeUrl: string; // best deep link to update (see buildStoreUrl)
  trackId: number | null;
}

/**
 * Compare two dot-separated version strings segment by segment. Each segment is
 * parsed as a base-10 integer. Missing segments are treated as 0, and any
 * non-numeric segment is treated as 0. Returns a positive number when `a` is
 * greater than `b`, a negative number when `a` is less than `b`, and 0 when
 * they are equal. Kept private to the module.
 */
function compareVersions(a: string, b: string): number {
  const segA = String(a ?? "").split(".");
  const segB = String(b ?? "").split(".");
  const len = Math.max(segA.length, segB.length);
  for (let i = 0; i < len; i++) {
    const numA = Number.parseInt(segA[i] ?? "0", 10);
    const numB = Number.parseInt(segB[i] ?? "0", 10);
    const valA = Number.isNaN(numA) ? 0 : numA;
    const valB = Number.isNaN(numB) ? 0 : numB;
    if (valA !== valB) return valA - valB;
  }
  return 0;
}

/**
 * Build the best available link to the app's App Store page. Prefers the
 * `itms-apps://` deep link (jumps straight into the App Store app on device)
 * when the numeric track id is known, then the lookup's trackViewUrl, and
 * finally a generic App Store URL when nothing else is available.
 */
function buildStoreUrl(trackId: number | null, trackViewUrl: string | null): string {
  if (trackId != null) {
    return `itms-apps://apps.apple.com/app/id${trackId}`;
  }
  if (trackViewUrl) {
    return trackViewUrl;
  }
  return "https://apps.apple.com/";
}

/**
 * Returns null when the check is not applicable (non-iOS / not native) or when
 * it cannot determine anything (network failure, app not found). Never throws.
 */
export async function checkForAppUpdate(): Promise<AppUpdateInfo | null> {
  // This check is only meaningful on native iOS.
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") {
    return null;
  }

  // Read the installed version natively. Bail out if even this fails.
  let currentVersion: string;
  try {
    const info = await App.getInfo();
    currentVersion = info.version;
  } catch (err) {
    logger.warn("App.getInfo failed during update check", { error: String(err) });
    return null;
  }

  // Query the public iTunes Lookup API for the latest published version.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(LOOKUP_URL, { signal: controller.signal });
    if (!res.ok) {
      logger.warn("iTunes lookup returned non-ok status", { status: res.status });
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: null,
        storeUrl: buildStoreUrl(null, null),
        trackId: null,
      };
    }

    const data = (await res.json()) as {
      resultCount?: number;
      results?: Array<{
        version?: string;
        trackViewUrl?: string;
        trackId?: number;
      }>;
    };

    const result = data?.results?.[0];
    if (!data?.resultCount || !result?.version) {
      // App not found (not live yet, wrong country, etc.). Not an error.
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: null,
        storeUrl: buildStoreUrl(null, null),
        trackId: null,
      };
    }

    const latestVersion = result.version;
    const trackId = typeof result.trackId === "number" ? result.trackId : null;
    const trackViewUrl = result.trackViewUrl ?? null;
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;

    return {
      updateAvailable,
      currentVersion,
      latestVersion,
      storeUrl: buildStoreUrl(trackId, trackViewUrl),
      trackId,
    };
  } catch (err) {
    logger.warn("App update check failed", { error: String(err) });
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion: null,
      storeUrl: buildStoreUrl(null, null),
      trackId: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Opens the App Store at the given URL (deep-links into the App Store app on
 * device). Never throws.
 */
export async function openAppStore(storeUrl: string): Promise<void> {
  try {
    // `_system` hands the URL to the OS so the App Store app opens for
    // `itms-apps://` deep links. Mirrors the window.open precedent in
    // purchases.ts.
    window.open(storeUrl, "_system");
  } catch (err) {
    logger.warn("openAppStore window.open failed, falling back", {
      error: String(err),
    });
    try {
      window.location.href = storeUrl;
    } catch (fallbackErr) {
      logger.warn("openAppStore fallback failed", {
        error: String(fallbackErr),
      });
    }
  }
}
