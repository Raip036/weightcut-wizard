import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Dismiss handler for full-screen gates/walls that should return the user to
 * the screen they came from. `navigate(-1)` is a no-op when there is no in-app
 * history — which happens on iOS cold-start, where the app restores the user's
 * last route directly onto a gated screen. In that case we fall back to a safe
 * route so "Maybe later" always exits the wall instead of trapping the user.
 *
 * React Router v6 stores the history stack position in `window.history.state.idx`;
 * idx > 0 means there is a real previous in-app entry to pop back to.
 */
export function useSafeDismiss(fallback: string = "/dashboard"): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === "number" && idx > 0) {
      navigate(-1);
    } else {
      navigate(fallback, { replace: true });
    }
  }, [navigate, fallback]);
}
