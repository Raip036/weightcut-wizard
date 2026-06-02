import { useCallback, useEffect, useState } from "react";

/**
 * Coaching library — formerly backed by a Postgres `coaching_library` table.
 * The table was NOT migrated to Convex during Phase 1 (it stored AI-derived
 * insight snapshots that are now produced on-demand by the training-insights
 * action). Hook reduced to a no-op shim returning an empty list so legacy
 * sheet/page UIs render their empty state without churn.
 */

export interface CoachingLibraryEntry {
  id: string;
  user_id: string;
  /** PRIMARY discipline (martial art / "S&C" / "Rest") this insight is for. */
  session_type: string;
  /** OPTIONAL activity descriptor (Sparring, Strength, …); null when absent. */
  session_tag?: string | null;
  session_id: string | null;
  session_date: string | null;
  fingerprint: string;
  insight_data: {
    session_type?: string;
    last_logged?: string;
    what_you_did?: string;
    next_focus?: string;
    [k: string]: unknown;
  };
  created_at: string;
}

export function useCoachingLibrary(userId: string | null, enabled: boolean) {
  const [entries] = useState<CoachingLibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore] = useState(false);
  const [allLoaded] = useState(true);
  const [error] = useState<string | null>(null);

  const refresh = useCallback(async () => { /* no-op */ }, []);
  const loadMore = useCallback(async () => { /* no-op */ }, []);

  useEffect(() => {
    if (!enabled || !userId) return;
    setLoading(false);
  }, [enabled, userId]);

  return { entries, loading, loadingMore, allLoaded, error, loadMore, refresh };
}
