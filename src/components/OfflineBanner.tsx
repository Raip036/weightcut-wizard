import { useEffect, useRef, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { useUser } from "@/contexts/UserContext";

/**
 * Network status banner. Post-Convex migration the legacy "reconnecting" hop
 * (driven by `connectionRecovery.ts`) is gone; Convex's WebSocket client
 * auto-reconnects, so we only render the offline / back-online states.
 */
type BannerMode = "offline" | "back-online" | "hidden";

export function OfflineBanner() {
  const { isOffline } = useUser();
  const [showBackOnline, setShowBackOnline] = useState(false);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (isOffline) {
      wasOfflineRef.current = true;
      setShowBackOnline(false);
    } else if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      setShowBackOnline(true);
      const timer = setTimeout(() => setShowBackOnline(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isOffline]);

  const mode: BannerMode = isOffline
    ? "offline"
    : showBackOnline
      ? "back-online"
      : "hidden";

  const visible = mode !== "hidden";

  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), 300);
    return () => clearTimeout(t);
  }, [visible]);

  if (!mounted) return null;

  const palette =
    mode === "back-online"
      ? "bg-func-recovery-green/90 text-white"
      : "bg-zinc-900/95 text-zinc-300 border-b border-zinc-700/50";

  return (
    <div
      className={`fixed left-0 right-0 z-[60] flex items-center justify-center gap-2 py-2 text-sm font-medium transition-transform duration-300 ease-out ${
        visible ? "translate-y-0" : "-translate-y-full"
      } ${palette}`}
      style={{ top: "env(safe-area-inset-top, 0px)" }}
      role="status"
      aria-live="polite"
    >
      {mode === "offline" && (
        <>
          <WifiOff className="h-4 w-4" />
          <span>You're offline</span>
        </>
      )}
      {mode === "back-online" && (
        <>
          <Wifi className="h-4 w-4" />
          <span>Back online</span>
        </>
      )}
    </div>
  );
}
