import { Capacitor } from "@capacitor/core";
import { logger } from "@/lib/logger";

// RevenueCat modules — dynamically imported only on native
let Purchases: any = null;
let LOG_LEVEL: any = null;
let RevenueCatUI: any = null;

const RC_API_KEY_IOS = "appl_KEgVHMBYZuygdbadkzJDGNdIuTL";
const ENTITLEMENT_ID = "FightCamp Wizard Pro";

export const PRODUCT_IDS = {
  monthly: "com.weightcutwizard.premium.monthly",
  yearly: "com.weightcutwizard.premium.yearly",
} as const;

let rcPromise: Promise<void> | null = null;
let rcUIPromise: Promise<void> | null = null;

// The RC SDK may be `configure`d only ONCE per app process — configuring a
// second time is unsupported. We track the configured state + the appUserID
// it was configured for so an account switch (without an app restart) routes
// through `logIn(userId)` instead of a second `configure()`.
let rcConfigured = false;
let rcConfiguredUserId: string | null = null;

async function loadRC() {
  if (Purchases) return;
  if (!Capacitor.isNativePlatform()) return;
  if (rcPromise) return rcPromise;
  rcPromise = (async () => {
    try {
      const mod = await import("@revenuecat/purchases-capacitor");
      Purchases = mod.Purchases;
      LOG_LEVEL = mod.LOG_LEVEL;
    } catch (err) {
      logger.warn("RevenueCat plugin not available", { error: String(err) });
    }
  })();
  return rcPromise;
}

async function loadRCUI() {
  if (RevenueCatUI) return;
  if (!Capacitor.isNativePlatform()) return;
  if (rcUIPromise) return rcUIPromise;
  rcUIPromise = (async () => {
    try {
      const mod = await import("@revenuecat/purchases-capacitor-ui");
      RevenueCatUI = mod.RevenueCatUI;
    } catch (err) {
      logger.warn("RevenueCat UI plugin not available", { error: String(err) });
    }
  })();
  return rcUIPromise;
}

// ─── Initialization ───

export async function initializePurchases(userId: string): Promise<void> {
  await loadRC();
  if (!Purchases) return;

  try {
    if (!rcConfigured) {
      // First configure in this process.
      await Purchases.configure({
        apiKey: RC_API_KEY_IOS,
        appUserID: userId,
      });
      rcConfigured = true;
      rcConfiguredUserId = userId;
      // Enable debug logs in development
      if (import.meta.env.DEV) {
        await Purchases.setLogLevel({ level: LOG_LEVEL?.DEBUG ?? 4 });
      }
      logger.info("RevenueCat initialized", { userId });
    } else if (rcConfiguredUserId !== userId) {
      // Already configured for a different user (account switch without an
      // app restart). Re-`configure` is unsupported — log the new user in.
      await Purchases.logIn(userId);
      rcConfiguredUserId = userId;
      logger.info("RevenueCat re-identified via logIn", { userId });
    }
    // Same user, already configured — nothing to do.
  } catch (err) {
    logger.error("RevenueCat configure failed", err);
  }
}

// ─── Log out (account switch / sign-out) ───

/**
 * Log the current user out of RevenueCat so a different user on the same
 * device cannot inherit the previous user's entitlements. The RC SDK reverts
 * to an anonymous appUserID after this. Native-only; failures are swallowed.
 *
 * NOTE: `Purchases.logOut()` throws if invoked while already anonymous — that
 * is benign, so we catch and log at warn level rather than surfacing it.
 */
export async function logOutPurchases(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await loadRC();
  if (!Purchases) return;

  try {
    await Purchases.logOut();
    rcConfiguredUserId = null;
    logger.info("RevenueCat logged out");
  } catch (err) {
    // RC throws when logging out an anonymous user — swallow it.
    logger.warn("RevenueCat logOut failed (likely already anonymous)", {
      error: String(err),
    });
  }
}

// ─── Offerings & Packages ───

export async function getOfferings(): Promise<any | null> {
  await loadRC();
  if (!Purchases) return null;

  try {
    const offerings = await Purchases.getOfferings();
    return offerings?.current ?? null;
  } catch (err) {
    logger.error("Failed to get offerings", err);
    return null;
  }
}

// ─── Purchase ───

export interface PurchaseResult {
  customerInfo: any;
  cancelled: boolean;
}

export async function purchasePackage(packageToPurchase: any): Promise<PurchaseResult> {
  // Dev mock purchase for testing in browser
  if (!Capacitor.isNativePlatform() && import.meta.env.DEV) {
    return mockPurchase();
  }

  await loadRC();
  if (!Purchases) throw new Error("RevenueCat not available");

  try {
    const result = await Purchases.purchasePackage({ aPackage: packageToPurchase });
    const customerInfo = result?.customerInfo;

    // Check if entitlement is now active
    if (customerInfo?.entitlements?.active?.[ENTITLEMENT_ID]) {
      logger.info("Purchase successful", {
        entitlement: ENTITLEMENT_ID,
        productId: customerInfo.entitlements.active[ENTITLEMENT_ID]?.productIdentifier,
      });
    }

    return { customerInfo, cancelled: false };
  } catch (error: any) {
    // RevenueCat error codes — PURCHASE_CANCELLED_ERROR = 1
    if (error?.code === 1 || error?.code === "PURCHASE_CANCELLED_ERROR") {
      logger.info("Purchase cancelled by user");
      return { customerInfo: null, cancelled: true };
    }
    // Re-throw other errors (network, billing, etc.)
    throw error;
  }
}

// ─── Mock Purchase (dev only) ───

async function mockPurchase(): Promise<PurchaseResult> {
  logger.info("[MOCK] Simulating purchase flow...");

  // Simulate StoreKit delay
  await new Promise((r) => setTimeout(r, 1500));

  // Build mock customer info with active entitlement
  const mockCustomerInfo = {
    entitlements: {
      active: {
        [ENTITLEMENT_ID]: {
          identifier: ENTITLEMENT_ID,
          isActive: true,
          productIdentifier: "monthly",
          willRenew: true,
          expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          isSandbox: true,
        },
      },
      all: {},
    },
    activeSubscriptions: ["monthly"],
    firstSeen: new Date().toISOString(),
    originalAppUserId: "mock_user",
    managementURL: null,
  };

  logger.info("[MOCK] Purchase complete — entitlement active:", { entitlement: ENTITLEMENT_ID });
  return { customerInfo: mockCustomerInfo, cancelled: false };
}

// ─── Restore ───

export async function restorePurchases(): Promise<any | null> {
  await loadRC();
  if (!Purchases) return null;

  const result = await Purchases.restorePurchases();
  return result?.customerInfo ?? null;
}

// ─── Customer Info ───

export async function getCustomerInfo(): Promise<any | null> {
  await loadRC();
  if (!Purchases) return null;

  try {
    const result = await Purchases.getCustomerInfo();
    const info = result?.customerInfo ?? null;
    logger.info("getCustomerInfo", {
      hasInfo: !!info,
      entitlementKeys: info?.entitlements?.active ? Object.keys(info.entitlements.active) : [],
      activeSubs: info?.activeSubscriptions ?? [],
    });
    return info;
  } catch (err) {
    logger.error("getCustomerInfo failed", err);
    return null;
  }
}

/**
 * Strict client-side entitlement check. Returns true ONLY when:
 *   - `entitlements.active[ENTITLEMENT_ID]` exists (exact match)
 *   - `purchaseDate` is set (the user actually paid at some point)
 *   - either `expirationDate` is null (lifetime) OR strictly > now
 *
 * This is intentionally lenient compared to a server-side RC REST check —
 * it's local-only and exists purely as a defence-in-depth gate before the
 * paywall handler calls the `activatePremium` action. The action ALSO
 * hits the RC REST API and is the actual source of truth.
 *
 * Previous versions had two fallback branches (any-active-entitlement +
 * fuzzy `activeSubscriptions` match) that flipped premium true on sandbox
 * residue and sibling-RC-project entitlements. Both removed deliberately.
 */
export function isPremiumFromCustomerInfo(customerInfo: any): boolean {
  if (!customerInfo) return false;

  const entitlement = customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
  if (!entitlement) return false;
  if (entitlement.isActive === false) return false;
  // `purchaseDate` must be present — guarantees there was a real StoreKit
  // transaction (RC populates this from the receipt).
  if (!entitlement.purchaseDate) return false;
  if (entitlement.expirationDate) {
    if (new Date(entitlement.expirationDate) <= new Date()) return false;
  }
  return true;
}

/**
 * Strict client-side read of the configured entitlement (display only).
 * Returns null unless the EXACT `ENTITLEMENT_ID` is in `entitlements.active`
 * — matching the strictness of `isPremiumFromCustomerInfo`. Used for the
 * Settings "Renews on..." copy. The Convex profile (written by the
 * server-verified `activatePremium` action and the webhook) is the
 * authoritative tier + expiry.
 */
export function getSubscriptionFromCustomerInfo(customerInfo: any): { tier: string; expiresAt: string | null } | null {
  const entitlement = customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
  if (!entitlement) return null;
  const productId: string = entitlement.productIdentifier || "";
  const lower = productId.toLowerCase();
  const tier = lower.includes("lifetime")
    ? "premium_lifetime"
    : lower.includes("yearly") || lower.includes("annual")
      ? "premium_annual"
      : "premium_monthly";
  return { tier, expiresAt: entitlement.expirationDate || null };
}

/**
 * DISPLAY-ONLY read of the entitlement's renewal context for the trial banner.
 * `willRenew` tells us whether the App Store will auto-charge at period end
 * (false = the user cancelled / turned off auto-renew). `periodType` is RC's
 * billing phase: "trial" / "intro" / "normal". Both are surfaced purely for
 * UI copy — they NEVER influence entitlement (the Convex profile written by
 * the server-verified action / webhook stays the only source of truth).
 * Returns nulls when the configured entitlement isn't active.
 */
export function getEntitlementDisplayInfo(
  customerInfo: any,
): { willRenew: boolean | null; periodType: string | null } {
  const entitlement = customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
  if (!entitlement) return { willRenew: null, periodType: null };
  const willRenew = typeof entitlement.willRenew === "boolean" ? entitlement.willRenew : null;
  const periodType = typeof entitlement.periodType === "string" ? entitlement.periodType.toLowerCase() : null;
  return { willRenew, periodType };
}

// ─── RevenueCat Native Paywall ───

/**
 * Present RevenueCat's native paywall UI.
 * This uses the paywall configured in the RevenueCat dashboard.
 * Returns the customer info after the paywall is dismissed.
 */
export async function presentPaywall(): Promise<{ customerInfo: any; paywallResult: string } | null> {
  await loadRC();
  await loadRCUI();
  if (!RevenueCatUI) return null;

  try {
    const result = await RevenueCatUI.presentPaywall();
    logger.info("RevenueCatUI.presentPaywall raw result", {
      keys: result ? Object.keys(result) : "null",
      paywallResult: result?.result,
      hasCustomerInfo: !!result?.customerInfo,
    });
    return {
      customerInfo: result?.customerInfo ?? null,
      paywallResult: result?.result ?? "NOT_PRESENTED",
    };
  } catch (err) {
    logger.error("Failed to present paywall", err);
    return null;
  }
}

/**
 * Present RevenueCat's native paywall UI if the user is not entitled.
 * Only shows if the user doesn't have the entitlement.
 */
export async function presentPaywallIfNeeded(): Promise<{ customerInfo: any; paywallResult: string } | null> {
  await loadRC();
  await loadRCUI();
  if (!RevenueCatUI) return null;

  try {
    const result = await RevenueCatUI.presentPaywallIfNeeded({
      requiredEntitlementIdentifier: ENTITLEMENT_ID,
    });
    return {
      customerInfo: result?.customerInfo ?? null,
      paywallResult: result?.result ?? "NOT_PRESENTED",
    };
  } catch (err) {
    logger.error("Failed to present paywall", err);
    return null;
  }
}

// ─── Customer Center ───

/**
 * Present RevenueCat's Customer Center for subscription management.
 * Handles cancellation, plan changes, and support.
 */
export async function presentCustomerCenter(): Promise<void> {
  await loadRC();
  await loadRCUI();
  if (!RevenueCatUI) {
    // Fallback: open Apple subscription management
    window.open("https://apps.apple.com/account/subscriptions", "_blank");
    return;
  }

  try {
    await RevenueCatUI.presentCustomerCenter();
  } catch (err) {
    logger.error("Failed to present customer center", err);
    // Fallback
    window.open("https://apps.apple.com/account/subscriptions", "_blank");
  }
}

// ─── Manage Subscriptions (legacy fallback) ───

export async function showManageSubscriptions(): Promise<void> {
  await loadRC();
  if (!Purchases) {
    window.open("https://apps.apple.com/account/subscriptions", "_blank");
    return;
  }

  try {
    await Purchases.showManageSubscriptions();
  } catch {
    window.open("https://apps.apple.com/account/subscriptions", "_blank");
  }
}

// ─── Listener for real-time customer info changes ───

export async function addCustomerInfoUpdateListener(
  callback: (customerInfo: any) => void
): Promise<(() => void) | null> {
  await loadRC();
  if (!Purchases) return null;

  try {
    const listener = await Purchases.addCustomerInfoUpdateListener(
      (info: any) => callback(info.customerInfo)
    );
    return () => listener?.remove?.();
  } catch {
    return null;
  }
}
