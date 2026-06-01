import { useEffect, useRef } from "react";
import { toast } from "@/hooks/use-toast";

const STORAGE_KEY_PREFIX = "recovery-model-v2-acked:";

/**
 * Fires a one-time toast informing the user that the training-load model
 * has been upgraded (EWMA-ACWR + sport weights + CNS multiplier).
 *
 * Keyed per-user via localStorage; idempotent across mounts and refreshes.
 * Only fires when the user has at least one session loaded so empty-state
 * users aren't surprised by a notification about scores they don't have.
 */
export function useModelMigrationToast(
  userId: string | null,
  hasSessions: boolean,
): void {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (!userId || !hasSessions) return;

    const key = STORAGE_KEY_PREFIX + userId;

    try {
      if (localStorage.getItem(key)) {
        // Already acknowledged on a previous visit — mark as fired so we
        // don't re-check on every prop change within this mount.
        firedRef.current = true;
        return;
      }
    } catch {
      // localStorage unavailable (e.g. privacy mode) — fail open and skip
      // the toast rather than risk firing repeatedly.
      firedRef.current = true;
      return;
    }

    toast({
      title: "We improved your training-load model",
      description:
        "Your scores now reflect sparring impact, weekly variety, and your camp phase. Your last 28 days have been recalculated.",
      // Default (neutral) variant — not destructive. 8s auto-dismiss.
      duration: 8000,
    });

    try {
      localStorage.setItem(key, String(Date.now()));
    } catch {
      // Best-effort persistence; we've already fired the toast.
    }
    firedRef.current = true;
  }, [userId, hasSessions]);
}
