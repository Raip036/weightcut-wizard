/**
 * AppUpdateGate - mounts the MANDATORY "update required" lockout globally.
 *
 * On native iOS, shortly after launch it asks the App Store (via the iTunes
 * lookup, see src/lib/appUpdate.ts) whether the installed build is behind the
 * latest published version. If so, it surfaces the premium AppUpdatePrompt as a
 * HARD GATE: the dialog cannot be dismissed (no "Not now", backdrop does
 * nothing) so the user cannot use the app until they update. The only action is
 * "Update now", which deep-links to the App Store.
 *
 * Fail-open: the check is skipped entirely on web / non-iOS, and if the iTunes
 * lookup fails `checkForAppUpdate` reports no update, so a network/lookup error
 * can never lock a user out. Once the prompt is shown it stays open for the
 * rest of the session (no snooze) until the user updates and relaunches on the
 * new build, where the check passes and the gate never appears.
 */
import { useEffect, useState } from "react";
import { AppUpdatePrompt } from "@/components/AppUpdatePrompt";
import {
  checkForAppUpdate,
  openAppStore,
  type AppUpdateInfo,
} from "@/lib/appUpdate";
import { logger } from "@/lib/logger";

// Let the app settle (auth, first paint) before firing a network check.
const CHECK_DELAY_MS = 4000;

export function AppUpdateGate(): JSX.Element | null {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await checkForAppUpdate();
        if (cancelled || !result || !result.updateAvailable) return;
        setInfo(result);
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
    // Deep-link to the App Store. We intentionally do NOT close the gate: if
    // the user backs out without updating, the lockout is still in place.
    void openAppStore(info.storeUrl);
  };

  return (
    <AppUpdatePrompt
      open
      mandatory
      currentVersion={info.currentVersion}
      latestVersion={info.latestVersion}
      onUpdate={handleUpdate}
    />
  );
}

export default AppUpdateGate;
