/**
 * Product analytics (PostHog, frontend).
 *
 * Single wrapper around the posthog-js singleton so the rest of the app never
 * imports posthog directly. Goals:
 *   - "where do users go / what do they open first / what do they traverse" →
 *     answered by autocapture + manual SPA $pageview (see RouteTracker).
 *   - "do they return" → answered by identify() binding events to a stable
 *     userId so PostHog can compute retention across sessions.
 *   - high-signal custom events for the actions that matter (see EVENTS).
 *
 * No-ops gracefully when VITE_POSTHOG_KEY is absent (local dev without a key,
 * SSR, or tests) so nothing throws and no events leak to prod from dev.
 *
 * Privacy: session replay runs with ALL inputs masked (health app). Tag any
 * extra sensitive element with the `ph-no-capture` class to redact it too.
 */
import posthog from "posthog-js";

// Publishable PostHog project key (phc_…) + EU ingestion host. These are
// CLIENT-side values — the phc key is designed to ship in the browser bundle,
// not a secret. Env vars override the defaults: set VITE_POSTHOG_KEY /
// VITE_POSTHOG_HOST in .env.local to move them out of source if preferred.
const KEY =
  (import.meta.env.VITE_POSTHOG_KEY as string | undefined) ||
  "phc_CrH8pFsAVCiuRHRCTNff3gttoqJJpzr5BKBi3BppR4JU";
const HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ||
  "https://eu.i.posthog.com";

let started = false;

/** True once posthog has a key and has been initialised. */
export function analyticsEnabled(): boolean {
  return started;
}

/** Initialise PostHog once, at app boot. Safe to call when no key is set. */
export function initAnalytics(): void {
  if (started || !KEY) return;
  // PRODUCTION ONLY. `import.meta.env.PROD` is true for `vite build` (the
  // bundle that ships to the App Store / web deploy) and false for the
  // `vite dev` server. This keeps local development out of the analytics so
  // the dashboards reflect real production usage, not our own dev clicks.
  if (!import.meta.env.PROD) return;
  posthog.init(KEY, {
    api_host: HOST,
    // We capture SPA pageviews manually from RouteTracker (react-router has no
    // full page loads), so disable the automatic one to avoid double counts.
    capture_pageview: false,
    capture_pageleave: true,
    // Autocapture every click/change/submit → instant "most-used / traversal"
    // data with zero per-component wiring.
    autocapture: true,
    // Health app → record sessions but mask all text inputs. Project-level
    // recording opt-in is also required (enabled via the PostHog dashboard).
    session_recording: {
      maskAllInputs: true,
    },
    // Uncaught exceptions → PostHog error tracking. Session replays showed
    // console errors in over half of sessions while error tracking sat empty;
    // this gives crash/error visibility without a separate SDK.
    capture_exceptions: true,
    persistence: "localStorage+cookie",
    // Don't fire a $pageview/$pageleave for bots or our own dev noise.
    loaded: (ph) => {
      if (import.meta.env.DEV) ph.debug(false);
    },
  });
  started = true;
}

/**
 * Bind subsequent events to a stable user. Call when a real userId resolves
 * (never with the transient "pending" sentinel). Enables retention/return
 * analysis. `props` become person properties (no PII — no email/name here).
 */
export function identifyUser(
  userId: string,
  props?: Record<string, unknown>,
): void {
  if (!started || !userId || userId === "pending") return;
  posthog.identify(userId, props);
}

/** Clear identity on logout so the next user starts a fresh anonymous id. */
export function resetAnalytics(): void {
  if (!started) return;
  posthog.reset();
}

/** Manual SPA pageview. Called from RouteTracker on every route change. */
export function trackPageview(path: string): void {
  if (!started) return;
  posthog.capture("$pageview", { $current_url: path, path });
}

// ───────────────────────────────────────────────────────────────────────────
// Custom event catalog — the curated, high-signal actions. Keep names stable;
// PostHog insights/dashboards reference them by string. Autocapture covers the
// long tail of clicks/navigation, so only add events here for actions whose
// SEMANTIC success matters (a logged weight, a generated plan, a subscribe).
// ───────────────────────────────────────────────────────────────────────────
export const EVENTS = {
  // Activation
  SIGNED_UP: "signed_up",
  ONBOARDING_STEP_COMPLETED: "onboarding_step_completed",
  ONBOARDING_COMPLETED: "onboarding_completed",
  // App lifecycle — fired on cold start and on native foreground resume so
  // "opens" are countable even when no route change happens.
  APP_OPENED: "app_opened",
  // Core logging loop
  WEIGHT_LOGGED: "weight_logged",
  MEAL_LOGGED: "meal_logged",
  SESSION_LOGGED: "session_logged",
  WELLNESS_CHECKIN: "wellness_checkin",
  // Plans / AI features
  PLAN_GENERATED: "plan_generated",
  // Navigation intent (a feature surface was opened) — complements autocapture
  // with a clean, queryable "top features" event.
  FEATURE_OPENED: "feature_opened",
  // Re-engagement — a local-notification reminder was tapped (props: { pillar }).
  REMINDER_TAPPED: "reminder_tapped",
  // Monetisation
  PAYWALL_VIEWED: "paywall_viewed",
  PAYWALL_DISMISSED: "paywall_dismissed",
  SUBSCRIBE_STARTED: "subscribe_started",
  SUBSCRIBED: "subscribed",
  // Sharing / virality
  SHARE_CARD_SHARED: "share_card_shared",
  // Community — separates posters from lurkers (deck views) in the gym feed.
  POST_CREATED: "post_created",
  POST_ENGAGED: "post_engaged", // props: { action: "like" | "reaction" | "comment" | "report" }
  DECK_POST_VIEWED: "deck_post_viewed",
} as const;

export type AnalyticsEvent = (typeof EVENTS)[keyof typeof EVENTS];

/**
 * Capture a custom event. Prefer the EVENTS constants for the name so the
 * catalog stays the single source of truth. Keep `props` small and PII-free
 * (no email, name, free-text notes) — they become event properties.
 */
export function track(
  event: AnalyticsEvent | (string & {}),
  props?: Record<string, unknown>,
): void {
  if (!started) return;
  posthog.capture(event, props);
}

/** Escape hatch for advanced use (feature flags, group analytics, etc.). */
export function getPosthog(): typeof posthog | null {
  return started ? posthog : null;
}
