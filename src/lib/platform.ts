import { Capacitor } from "@capacitor/core";

/**
 * Single source of truth for "which store/platform am I running on?".
 *
 * RULE: no other file may compare `Capacitor.getPlatform()` to a string
 * literal. Every platform difference (API keys, store URLs, native quirks)
 * is centralized here so the iOS/Android divergence stays auditable.
 */

export type StorePlatform = "ios" | "android" | "web";

export function platform(): StorePlatform {
  if (!Capacitor.isNativePlatform()) return "web";
  return Capacitor.getPlatform() === "android" ? "android" : "ios";
}

export const isIOS = () => platform() === "ios";
export const isAndroid = () => platform() === "android";
export const isNative = () => platform() !== "web";

// ─── RevenueCat public SDK keys (per store) ───
//
// The iOS key is live. The Android key comes from the RevenueCat dashboard
// (Project → Apps → the Android app, keyed to com.fightcampwizard.app) and
// starts with `goog_`.
//
// TODO(android-billing): paste the `goog_…` key once the RevenueCat Android
// app is created. Until then Android purchases are intentionally disabled
// (revenueCatApiKey() returns null → initializePurchases() no-ops safely).
const RC_API_KEYS: Record<Exclude<StorePlatform, "web">, string> = {
  ios: "appl_KEgVHMBYZuygdbadkzJDGNdIuTL",
  android: "goog_medODBDFPhmDxxkhEjAtnnLrLEl",
};

export function revenueCatApiKey(): string | null {
  const p = platform();
  if (p === "web") return null;
  return RC_API_KEYS[p] || null;
}

// ─── Store subscription-management URLs (per store) ───
const SUBSCRIPTION_URLS: Record<StorePlatform, string> = {
  ios: "https://apps.apple.com/account/subscriptions",
  android: "https://play.google.com/store/account/subscriptions",
  web: "https://fightcampwizard.com/account",
};

export function subscriptionManagementUrl(): string {
  return SUBSCRIPTION_URLS[platform()];
}

// ─── App identifiers (per store) ───
export const IOS_BUNDLE_ID = "com.weightcutwizard.app";
export const ANDROID_PACKAGE = "com.fightcampwizard.app";

// ─── Store listing / update deep links (per store) ───
// iOS uses the App Store; Android uses the Play Store. The Android package is
// the new canonical id (com.fightcampwizard.app). The iOS App Store numeric id
// is resolved at runtime via iTunes lookup (see appUpdate.ts), so the web/iOS
// fallback points at the public listing.
const STORE_LISTING_URLS: Record<StorePlatform, string> = {
  ios: "https://apps.apple.com/app/fightcamp-wizard/",
  android: `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`,
  web: "https://fightcampwizard.com",
};

export function storeListingUrl(): string {
  return STORE_LISTING_URLS[platform()];
}

// ─── Google Sign-In (native) ───
//
// The Web OAuth client id is used BOTH as the native plugin's `serverClientId`
// (so the returned id_token's audience is the web client) AND, on the Convex
// server, as the audience the `google-native` provider verifies against
// (server reads its own copy from a Convex env var: GOOGLE_CLIENT_ID).
//
// TODO(android-auth): paste the real Web OAuth client id from Google Cloud
// Console once it exists. Until then Google Sign-In is intentionally inert
// (googleWebClientId() returns null → the sign-in button no-ops with a warning).
const GOOGLE_WEB_CLIENT_ID =
  "307294042101-95kpqocn2p1l4tq0iiluphk0sg04tegf.apps.googleusercontent.com";

// iOS OAuth client id (TYPE: iOS) from Google Cloud Console, keyed to the iOS
// bundle id com.weightcutwizard.app. Required for native Google Sign-In on iOS
// (the GoogleSignIn SDK needs an iOS-type client id; the web client id won't
// work as the iOS `clientID`). Its reversed form must also be added to
// ios/App/App/Info.plist as a CFBundleURLScheme.
//
// TODO(ios-auth): paste the real iOS OAuth client id. Until then Google
// Sign-In is inert on iOS (googleInitOptions() returns null on iOS → the
// button no-ops with a "not configured yet" toast). Android is unaffected.
const GOOGLE_IOS_CLIENT_ID =
  "307294042101-qjgei4j50kjm8v76k7rkm0s75k59i2ik.apps.googleusercontent.com";

export function googleWebClientId(): string | null {
  return GOOGLE_WEB_CLIENT_ID || null;
}

export function googleIOSClientId(): string | null {
  return GOOGLE_IOS_CLIENT_ID || null;
}

/**
 * Google Sign-In init options for `@capgo/capacitor-social-login`, or null if
 * the current platform isn't configured for Google yet (caller shows a soft
 * "not configured" toast and returns).
 *
 * iOS needs the iOS client id as `iOSClientId`; setting `iOSServerClientId` to
 * the web client id makes the iOS id_token's `aud` equal the web client id, so
 * the server's audience check is uniform across platforms. Android only needs
 * the web client id.
 */
export function googleInitOptions():
  | { webClientId: string; iOSClientId?: string; iOSServerClientId?: string }
  | null {
  const web = googleWebClientId();
  if (!web) return null;
  if (isIOS()) {
    const ios = googleIOSClientId();
    if (!ios) return null; // iOS OAuth client id not pasted yet
    return { webClientId: web, iOSClientId: ios, iOSServerClientId: web };
  }
  return { webClientId: web };
}
