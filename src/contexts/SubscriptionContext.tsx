import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from "react";
import { useProfile, useAuth } from "@/contexts/UserContext";
import { Capacitor } from "@capacitor/core";
import {
  initializePurchases,
  addCustomerInfoUpdateListener,
  isPremiumFromCustomerInfo,
  getCustomerInfo,
  getEntitlementDisplayInfo,
} from "@/lib/purchases";
import { useAction, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { logger } from "@/lib/logger";
import type { Tier } from "@/lib/featureGates";

// ─── localStorage scope ───────────────────────────────────────────────────
//
// The premium override (`wcw_premium_<uid>`) and gem cache (`wcw_gems_*`)
// that used to live here are GONE. The Convex `profile.subscription_tier`
// reactive query is the only source of truth for premium — written
// exclusively by the RC webhook or by the server-verified
// `api.actions.activatePremium.run` action that hits the RC REST API.
//
// We still sweep the legacy keys on every mount so users who installed an
// earlier build don't carry around a stale "premium" override or a stale
// gem count flash.

const PREMIUM_KEY_PREFIX = "wcw_premium_"; // legacy per-user — cleaned up on mount
const LEGACY_PREMIUM_KEY = "wcw_premium_override"; // legacy GLOBAL — cleaned up on mount
const GEMS_KEY_PREFIX = "wcw_gems_"; // legacy per-user — cleaned up on mount
const LEGACY_GEMS_KEY = "wcw_gems"; // legacy GLOBAL — cleaned up on mount

/** Exported helper — called from UserContext signOut to scrub this user's local state. */
export function clearLocalSubscriptionState(userId: string): void {
  try {
    localStorage.removeItem(`${PREMIUM_KEY_PREFIX}${userId}`); // legacy
    localStorage.removeItem(`${GEMS_KEY_PREFIX}${userId}`); // legacy
    localStorage.removeItem(`wcw_welcome_pro_shown_${userId}`);
  } catch { /* privacy mode — silently ignore */ }
}

/** One-time cleanup of legacy localStorage keys.
 *  Removes the obsolete gem cache and the per-user / global premium
 *  override keys from earlier builds. Idempotent and cheap. */
function cleanupLegacyKeys(): void {
  try {
    localStorage.removeItem(LEGACY_PREMIUM_KEY);
    localStorage.removeItem(LEGACY_GEMS_KEY);
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(PREMIUM_KEY_PREFIX)) toRemove.push(key);
      else if (key.startsWith(GEMS_KEY_PREFIX)) toRemove.push(key);
      else if (key.startsWith("wcw_ai_count_")) toRemove.push(key);
      else if (key.startsWith("wcw_ai_limit_")) toRemove.push(key);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch { /* privacy mode — silently ignore */ }
}

// ─── Context ──────────────────────────────────────────────────────────────

interface SubscriptionContextType {
  isPremium: boolean;
  tier: Tier;
  /** Raw subscription product tier (free / premium_monthly / premium_annual / premium_lifetime).
   *  Kept exposed so paywall UI can show the active plan label. */
  rawTier: string;
  expiresAt: Date | null;
  /** True while a free trial is active. Always false until the trial schema
   *  fields are populated by the server (the trial UX ships in a later PR). */
  isInTrial: boolean;
  trialEndsAt: Date | null;
  /** RC display-only signals for the trial banner (native; null on web/dev).
   *  `willRenew` false = the user cancelled auto-renew (the "save" moment).
   *  `isTrialActive` = RC reports the entitlement is in its trial/intro phase. */
  willRenew: boolean | null;
  isTrialActive: boolean;
  isPaywallOpen: boolean;
  isSubscriptionResolved: boolean;
  openPaywall: () => void;
  closePaywall: () => void;
  // `forcePremium` is intentionally removed. The Convex `profile.subscription_tier`
  // (written only by the server-verified `activatePremium` action or the RC
  // webhook) is the single source of truth for premium. Any future
  // contributor tempted to add an optimistic override here should remember
  // this surface is exactly how non-paying users got upgraded in sandbox.
  showWelcomePro: boolean;
  dismissWelcomePro: () => void;
  showProEnded: boolean;
  dismissProEnded: () => void;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

// Narrow shape we read off the profile snapshot in async callbacks.
type ProfileSubscriptionShape = {
  subscription_tier?: string | null;
  subscription_expires_at?: string | null;
  trial_ends_at?: number | string | null;
} | null | undefined;

function parseTrialEndsAt(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { profile, refreshProfile } = useProfile();
  const { userId } = useAuth();
  const activatePremium = useAction(api.actions.activatePremium.run);
  const markWelcomeProShown = useMutation(api.profiles.markWelcomeProShown);
  const markProEndedShown = useMutation(api.profiles.markProEndedShown);
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);
  const [showWelcomePro, setShowWelcomePro] = useState(false);
  const [showProEnded, setShowProEnded] = useState(false);
  // `false` until profile has resolved at least once (undefined = loading, null/obj = resolved)
  const [isSubscriptionResolved, setIsSubscriptionResolved] = useState(false);
  // RC display-only renewal context for the trial banner. Captured from
  // `customerInfo` reads (cold-start reconcile, resume reconcile, RC listener).
  // DISPLAY ONLY — never gates entitlement. Stays null on web/dev (no RC).
  const [rcWillRenew, setRcWillRenew] = useState<boolean | null>(null);
  const [rcPeriodType, setRcPeriodType] = useState<string | null>(null);

  // One-time cleanup of legacy localStorage on every mount.
  useEffect(() => {
    cleanupLegacyKeys();
  }, []);

  // Track whether profile has resolved (transitioned out of `undefined`) at least once
  useEffect(() => {
    if (profile !== undefined && !isSubscriptionResolved) {
      setIsSubscriptionResolved(true);
    }
  }, [profile, isSubscriptionResolved]);

  // Mirror latest profile into a ref so async callbacks (RC listener, startup check)
  // can read fresh server state without re-subscribing on every profile change.
  const profileRef = useRef(profile);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  // Guards for the server-verified reconcile path (cold-start + resume).
  //  - `verifyInFlightRef`: skip overlapping verifies.
  //  - `lastVerifyAtRef`: throttle to at most once per RECONCILE_THROTTLE_MS.
  const verifyInFlightRef = useRef(false);
  const lastVerifyAtRef = useRef(0);

  // Shared server-verified reconcile. Reads RC `customerInfo`; if it looks
  // premium, runs the server-verified `activatePremium` action (the SOLE
  // legitimate client-initiated write path) then refreshes the profile.
  // Otherwise just refreshes. Throttled + in-flight guarded so reopen storms
  // / rapid visibility flips don't spam RC or the action. Native-only.
  const RECONCILE_THROTTLE_MS = 30_000;
  const reconcileEntitlement = useCallback(async (force = false) => {
    if (!Capacitor.isNativePlatform()) return;
    if (verifyInFlightRef.current) return;
    if (!force && Date.now() - lastVerifyAtRef.current < RECONCILE_THROTTLE_MS) return;
    verifyInFlightRef.current = true;
    lastVerifyAtRef.current = Date.now();
    try {
      const info = await getCustomerInfo();
      if (info) {
        const display = getEntitlementDisplayInfo(info);
        setRcWillRenew(display.willRenew);
        setRcPeriodType(display.periodType);
      }
      if (info && isPremiumFromCustomerInfo(info)) {
        try {
          await activatePremium({});
          await refreshProfile();
        } catch (err) {
          logger.info("Reconcile: activatePremium did not confirm entitlement", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        // RC says not premium (or unavailable). Nothing to grant locally —
        // the reactive profile query is the source of truth.
        await refreshProfile();
      }
    } finally {
      verifyInFlightRef.current = false;
    }
  }, [activatePremium, refreshProfile]);

  // Tier + expiry derive PURELY from the reactive Convex profile query.
  // No client override, no localStorage hydration, no optimistic flip.
  // The only writers to `profile.subscription_tier` are the server-verified
  // `activatePremium` action and the RC webhook — both of which require
  // a cryptographically-confirmed StoreKit payment via the RC platform.
  const rawTier = profile?.subscription_tier || "free";
  const expiresAt = profile?.subscription_expires_at
    ? new Date(profile.subscription_expires_at)
    : null;

  // Bounded-expiry rule (mirrors the server `effectiveTier` core invariant):
  // a non-"free" tier with a null `subscription_expires_at` is treated as
  // premium ONLY when it's the lifetime tier. Any other non-free tier requires
  // a finite, future expiry. The server is authoritative — this just keeps the
  // client from rendering Pro for an unbounded non-lifetime tier.
  const isLifetimeTier = rawTier === "premium_lifetime";
  const isPremium =
    rawTier !== "free" &&
    (isLifetimeTier
      ? expiresAt === null || expiresAt > new Date()
      : expiresAt !== null && expiresAt > new Date());

  // Effective tier exposed to feature-gate checks.
  const tier: Tier = isPremium ? "pro" : "free";

  // Trial fields remain exposed as INFORMATIONAL ONLY (analytics / display).
  // They MUST NOT grant `isPremium` or `tier === "pro"` — the device-clock
  // `trial_ends_at` is no longer a source of truth for entitlement (see F4).
  // Pro derives solely from the server-written tier + expiry above.
  const trialEndsAtMs = parseTrialEndsAt((profile as ProfileSubscriptionShape)?.trial_ends_at);
  const trialEndsAt = trialEndsAtMs !== null ? new Date(trialEndsAtMs) : null;
  const isInTrial = trialEndsAtMs !== null && trialEndsAtMs > Date.now();

  // RC display-only signals (native). `willRenew` exposes auto-renew state for
  // the trial banner; `isTrialActive` reflects RC's trial/intro billing phase
  // and is the reliable trial indicator (the device-clock `trial_ends_at` may
  // be unpopulated). Both are for UI copy only and never affect entitlement.
  const willRenew = rcWillRenew;
  const isTrialActive = rcPeriodType === "trial" || rcPeriodType === "intro";

  const wasPremiumRef = useRef(isPremium);

  // Fire the one-time "Welcome to Pro" cutscene on a GENUINE upgrade only.
  // Guards, in order:
  //  1. Wait for the profile to resolve — the cold-start undefined→loaded
  //     flip must NOT be mistaken for a free→pro upgrade.
  //  2. Require a free→pro edge within this session.
  //  3. The server flag `welcome_pro_shown_at` is the source of truth for
  //     "already celebrated" — restores, returning devices and reinstalls
  //     already carry it, so they never replay.
  //  4. A server compare-and-set (`markWelcomeProShown`) decides who actually
  //     shows it, so concurrent devices can't double-fire.
  // A cancelled / backed-out purchase never flips the DB tier, so `isPremium`
  // never goes true and this never runs.
  useEffect(() => {
    if (!isSubscriptionResolved) return;
    const wasPremium = wasPremiumRef.current;
    wasPremiumRef.current = isPremium;
    if (!isPremium || wasPremium || !userId) return;
    if (profileRef.current?.welcome_pro_shown_at != null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await markWelcomeProShown({});
        if (!cancelled && res?.firstTime) setShowWelcomePro(true);
      } catch (err) {
        // Non-fatal: skip the celebration rather than risk firing it wrongly.
        logger.warn("markWelcomeProShown failed", { err });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPremium, isSubscriptionResolved, userId, markWelcomeProShown]);

  // Fire the one-time "Pro ended" cutscene after a GENUINE lapse. Unlike the
  // welcome (which is edge-driven from a free->pro transition this session),
  // this is SERVER-ARMED: the EXPIRATION webhook stamps `proEndedPendingAt`,
  // and we read the reactive pending/shown flags straight off `profile`. A
  // server compare-and-set (`markProEndedShown`) decides who actually shows it,
  // keyed to the pending timestamp so a later lapse re-fires exactly once.
  useEffect(() => {
    if (!isSubscriptionResolved || !userId) return;
    if (isPremium) return; // never while Pro
    const pending = profile?.pro_ended_pending_at ?? null;
    const shown = profile?.pro_ended_shown_at ?? null;
    if (pending == null) return;
    if (shown != null && shown >= pending) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await markProEndedShown({});
        if (!cancelled && res?.firstTime) setShowProEnded(true);
      } catch (err) {
        logger.warn("markProEndedShown failed", { err });
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.pro_ended_pending_at, profile?.pro_ended_shown_at, isPremium, isSubscriptionResolved, userId, markProEndedShown]);

  // Initialize RevenueCat when userId becomes available
  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return;

    let removeListener: (() => void) | null = null;

    // Yield to first paint before initializing RevenueCat (~500ms native overhead).
    const idle: (cb: () => void) => unknown =
      (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => unknown }).requestIdleCallback
        ? (cb) => (window as unknown as { requestIdleCallback: (cb: () => void, opts: { timeout: number }) => unknown }).requestIdleCallback(cb, { timeout: 3000 })
        : (cb) => setTimeout(cb, 500);

    const init = async () => {
      await initializePurchases(userId);

      // STRICT POLICY (do not weaken):
      //   - The `customerInfoUpdate` listener NEVER grants premium client-side.
      //     Background RC events on iOS sandbox fire transient "active"
      //     entitlement reads right after the paywall is dismissed
      //     (compressed-time trial renews, residual TestFlight receipts).
      //     Trusting them here is exactly how non-paying users got upgraded.
      //   - The startup re-sync NEVER grants premium client-side either. The
      //     ONLY path that flips `profile.subscriptionTier` from "free" to a
      //     paid tier is `api.actions.activatePremium.run()` (server-side RC
      //     REST verification) or the RC server-to-server webhook.
      //   - This handler's only job is to call `refreshProfile()` so the
      //     reactive `useQuery(api.profiles.getMine)` re-fetches the row.
      const cleanup = await addCustomerInfoUpdateListener(async (info: unknown) => {
        // Capture display-only renewal context for the trial banner. This does
        // NOT grant premium (see the strict policy above) — it only updates UI
        // copy signals. Tier still flows solely from the reactive profile.
        if (info) {
          const display = getEntitlementDisplayInfo(info);
          setRcWillRenew(display.willRenew);
          setRcPeriodType(display.periodType);
        }
        await refreshProfile();
      });
      removeListener = cleanup;

      // Cold-start reconcile: ask Convex to verify entitlement against RC
      // REST server-side. The action is idempotent and the SOLE legitimate
      // client-initiated write path. If the user is genuinely premium on RC
      // but Convex hasn't seen the webhook yet, this catches them up in one
      // round-trip. If RC says not-entitled, the action throws and we do
      // nothing — no local state flip. `force` bypasses the resume throttle so
      // cold-start always runs once.
      await reconcileEntitlement(true);
    };

    let cancelled = false;
    idle(() => {
      if (cancelled) return;
      init().catch((err) =>
        logger.warn("RevenueCat init failed", { error: String(err) })
      );
    });

    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, [userId, refreshProfile, reconcileEntitlement]);

  // On app resume (visibility → visible): re-run the SAME server-verified
  // reconcile used at cold start. This lets a paying user whose RENEWAL
  // webhook was missed self-heal on reopen — `reconcileEntitlement` reads RC
  // `customerInfo` and, only if it looks premium, calls the server-verified
  // `activatePremium` action (which hits the RC REST API) before refreshing
  // the profile. It NEVER grants premium client-side, and is throttled +
  // in-flight guarded so rapid foreground/background flips don't spam RC or
  // the action. Falls back to a plain `refreshProfile()` when not premium.
  useEffect(() => {
    if (!userId || !Capacitor.isNativePlatform()) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        reconcileEntitlement().catch((err) =>
          logger.warn("Resume reconcile failed", { error: String(err) }),
        );
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [userId, reconcileEntitlement]);

  const openPaywall = useCallback(() => {
    if (isPremium) return;
    setIsPaywallOpen(true);
  }, [isPremium]);
  const closePaywall = useCallback(() => setIsPaywallOpen(false), []);
  const dismissWelcomePro = useCallback(() => setShowWelcomePro(false), []);
  const dismissProEnded = useCallback(() => setShowProEnded(false), []);

  // Memoize the context value. `profile` pushes from Convex (every weight log,
  // name edit, etc.) re-render this provider, but the subscription-relevant
  // facts rarely change — without this, EVERY consumer of useSubscription /
  // useFeatureAccess (every Pro gate, the floating chat, the coach context)
  // re-rendered on any unrelated profile change. Keyed on primitives so the
  // Date instances (expiresAt/trialEndsAt) also keep a stable identity.
  const expiresAtMs = expiresAt?.getTime() ?? null;
  const value = useMemo(
    () => ({
      isPremium,
      tier,
      rawTier,
      expiresAt,
      isInTrial,
      trialEndsAt,
      willRenew,
      isTrialActive,
      isPaywallOpen,
      isSubscriptionResolved,
      openPaywall,
      closePaywall,
      showWelcomePro,
      dismissWelcomePro,
      showProEnded,
      dismissProEnded,
    }),
    // `expiresAt`/`trialEndsAt` are keyed by their ms timestamps (stable across
    // renders) rather than Date identity; the objects themselves are recreated
    // each render but only land in `value` when a timestamp actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isPremium,
      tier,
      rawTier,
      expiresAtMs,
      isInTrial,
      trialEndsAtMs,
      willRenew,
      isTrialActive,
      isPaywallOpen,
      isSubscriptionResolved,
      openPaywall,
      closePaywall,
      showWelcomePro,
      dismissWelcomePro,
      showProEnded,
      dismissProEnded,
    ],
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscriptionContext() {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error("useSubscriptionContext must be used within SubscriptionProvider");
  }
  return context;
}
