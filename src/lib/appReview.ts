import { Capacitor } from "@capacitor/core";
import { InAppReview } from "@capacitor-community/in-app-review";
import { logger } from "@/lib/logger";

// Win-moment review ask.
//
// `requestReview()` triggers Apple's native StoreKit dialog, which is
// system-rendered, non-customizable, and limited to a few shows per year. To
// spend that scarce prompt on a high point, we ARM a pending flag when the user
// completes a genuine win (wrapping up a fight camp) and then show our own
// aurora pre-prompt card the next time they're on the Dashboard; only if they
// tap "Rate" do we call the native dialog. A long-delay fallback still catches
// users who never finish a camp.
const REVIEW_KEY = "wcw_review_prompted"; // hard one-shot: native dialog has been shown
const INSTALL_DATE_KEY = "wcw_install_date";
const SNOOZE_KEY = "wcw_review_snoozed_at"; // "Maybe later" soft cooldown
const PENDING_KEY = "wcw_review_pending"; // armed at a win moment
const MIN_DAYS_BEFORE_PROMPT = 7;
const SNOOZE_DAYS = 45;

export function trackInstallDate(): void {
  if (!localStorage.getItem(INSTALL_DATE_KEY)) {
    localStorage.setItem(INSTALL_DATE_KEY, new Date().toISOString());
  }
}

function daysSinceInstall(): number | null {
  const installDate = localStorage.getItem(INSTALL_DATE_KEY);
  if (!installDate) return null;
  return Math.floor((Date.now() - new Date(installDate).getTime()) / 86_400_000);
}

/** True when we may ask for a review at all: native, never shown, old enough,
 *  and not inside a "Maybe later" cooldown. */
export function isReviewEligible(minDays = MIN_DAYS_BEFORE_PROMPT): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  if (localStorage.getItem(REVIEW_KEY)) return false;
  const snoozed = localStorage.getItem(SNOOZE_KEY);
  if (snoozed) {
    const days = (Date.now() - new Date(snoozed).getTime()) / 86_400_000;
    if (days < SNOOZE_DAYS) return false;
  }
  const age = daysSinceInstall();
  return age !== null && age >= minDays;
}

/** Arm the custom card to show on the next Dashboard visit (call at a win). */
export function armReviewPending(): void {
  if (!isReviewEligible()) return;
  try {
    localStorage.setItem(PENDING_KEY, "1");
  } catch {
    /* privacy mode — ignore */
  }
}

/** Whether the custom card should show now (armed at a win + still eligible). */
export function hasReviewPending(): boolean {
  return localStorage.getItem(PENDING_KEY) === "1" && isReviewEligible();
}

export function consumeReviewPending(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* privacy mode — ignore */
  }
}

/** "Maybe later" — start a cooldown so the card doesn't nag every win. */
export function snoozeReview(): void {
  try {
    localStorage.setItem(SNOOZE_KEY, new Date().toISOString());
  } catch {
    /* privacy mode — ignore */
  }
}

/** Show Apple's native dialog now and burn the one-shot. Called when the user
 *  taps "Rate" on the custom card (or by the late fallback). */
export async function requestReviewNow(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    localStorage.setItem(REVIEW_KEY, new Date().toISOString());
    await InAppReview.requestReview();
  } catch (err) {
    logger.warn("In-app review request failed", { error: err });
  }
}

/** Late fallback: directly trigger the native dialog for users who never hit a
 *  win moment. Uses a longer install-age floor so engaged users get asked at
 *  their win first. */
export async function maybeRequestReview(minDays = MIN_DAYS_BEFORE_PROMPT): Promise<void> {
  if (!isReviewEligible(minDays)) return;
  await requestReviewNow();
}
