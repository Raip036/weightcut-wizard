// Win-moment camp-share prompt.
//
// Mirrors the arm/consume localStorage pattern in appReview.ts: when the user
// completes a genuine win (a non-skipped camp wrap-up in NextCampFlow) we ARM
// a pending flag carrying that camp's id. The next time FightCampDetail loads,
// it consumes the flag and, if it matches the camp being viewed, auto-opens
// the Trophy Hero share dialog so sharing is the first thing the fighter sees
// at their completed camp. One-shot: consuming clears the flag either way.
const PENDING_KEY = "wcw_share_camp_pending";

/** Arm the share prompt for a just-wrapped camp (call at the win moment). */
export function armSharePrompt(campId: string): void {
  try {
    localStorage.setItem(PENDING_KEY, campId);
  } catch {
    /* privacy mode — ignore */
  }
}

/** Return the armed camp id once (clears the flag). Null when nothing armed. */
export function consumeSharePrompt(): string | null {
  try {
    const campId = localStorage.getItem(PENDING_KEY);
    if (!campId) return null;
    localStorage.removeItem(PENDING_KEY);
    return campId;
  } catch {
    return null;
  }
}
