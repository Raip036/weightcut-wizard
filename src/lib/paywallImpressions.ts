// Per-user paywall impression counter (localStorage).
//
// Tracks how many times a user has seen the full-screen ProUpsellScreen so
// repeat viewers (analytics showed 7 of 21 paywall viewers bounced off walls
// 4-8 times without buying; converters' median was 3 views) can be shown an
// escalated, trial-first pitch instead of the same generic wall again.
//
// Key precedent: `wcw_welcome_pro_shown_${userId}` in SubscriptionContext.

/** Threshold of PRIOR views at which the upsell escalates to the trial pitch. */
export const UPSELL_ESCALATION_THRESHOLD = 3;

function buildKey(userId: string | null): string {
  // Logged-out (shouldn't normally see the wall) falls back to a shared key
  // so the counter still degrades gracefully instead of throwing.
  return `wcw_upsell_views_${userId ?? "anon"}`;
}

/** Read the number of upsell-screen views recorded so far (0 if none/unavailable). */
export function readUpsellViews(userId: string | null): number {
  try {
    const raw = localStorage.getItem(buildKey(userId));
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Increment the counter by one view. Returns the PRIOR count. */
export function recordUpsellView(userId: string | null): number {
  const prior = readUpsellViews(userId);
  try {
    localStorage.setItem(buildKey(userId), String(prior + 1));
  } catch {
    // Storage unavailable/full: skip silently, counting is best-effort.
  }
  return prior;
}
