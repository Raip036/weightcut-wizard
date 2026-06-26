/**
 * AppUpdateGate - mounts the "update available" prompt globally.
 *
 * On native iOS, shortly after launch it asks the App Store (via the iTunes
 * lookup, see src/lib/appUpdate.ts) whether the installed build is behind the
 * latest published version. If so, it surfaces the premium AppUpdatePrompt and
 * deep-links to the App Store on confirm.
 *
 * Anti-nag: a snooze cooldown is stored in localStorage keyed by the LATEST
 * store version, so dismissing hides it for a few days but a brand-new release
 * re-prompts immediately. The check is skipped entirely on web / non-iOS.
 */
import { useEffect, useState } from "react";
import { AppUpdatePrompt } from "@/components/AppUpdatePrompt";
import {
  checkForAppUpdate,
  openAppStore,
  type AppUpdateInfo,
} from "@/lib/appUpdate";
import { logger } from "@/lib/logger";

// Snooze a dismissed version for this long before asking again. A different
// latestVersion bypasses the cooldown (new release, fresh prompt).
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const SNOOZE_KEY = "wcw_app_update_snooze";
// Let the app settle (auth, first paint) before firing a network check.
const CHECK_DELAY_MS = 4000;

type SnoozeState = { version: string; until: number };

function readSnooze(): SnoozeState | null {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.version === "string" && typeof p?.until === "number") return p;
  } catch {
    /* ignore */
  }
  return null;
}

function isSnoozed(latestVersion: string | null): boolean {
  if (!latestVersion) return false;
  const s = readSnooze();
  return !!s && s.version === latestVersion && Date.now() < s.until;
}

export function AppUpdateGate(): JSX.Element | null {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await checkForAppUpdate();
        if (cancelled || !result || !result.updateAvailable) return;
        if (isSnoozed(result.latestVersion)) return;
        setInfo(result);
        setOpen(true);
      } catch (err) {
        // checkForAppUpdate already swallows its own errors; this is belt-and-braces.
        logger.warn("AppUpdateGate check failed", { error: err });
      }
    }, CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (!info) return null;

  const handleUpdate = () => {
    setOpen(false);
    void openAppStore(info.storeUrl);
  };

  const handleDismiss = () => {
    setOpen(false);
    if (info.latestVersion) {
      try {
        localStorage.setItem(
          SNOOZE_KEY,
          JSON.stringify({ version: info.latestVersion, until: Date.now() + SNOOZE_MS }),
        );
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <AppUpdatePrompt
      open={open}
      currentVersion={info.currentVersion}
      latestVersion={info.latestVersion}
      onUpdate={handleUpdate}
      onDismiss={handleDismiss}
    />
  );
}

export default AppUpdateGate;
