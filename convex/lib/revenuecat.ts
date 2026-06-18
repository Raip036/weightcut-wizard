/**
 * Server-side RevenueCat REST verification.
 *
 * This is the ONLY trusted way the application learns whether a user has a
 * real, paid entitlement. The client cannot forge it because the call
 * happens inside a Convex action with a server-held `REVENUECAT_API_KEY`
 * (project-scoped REST secret, never shipped to the client). RevenueCat in
 * turn cryptographically verifies the underlying StoreKit receipt against
 * Apple before recording the entitlement, so a positive answer here means
 * Apple itself has confirmed payment.
 *
 * Strict rules — match the production design:
 *   - The exact entitlement identifier `ENTITLEMENT_ID` MUST be present in
 *     `subscriber.entitlements`. No fallback to other keys.
 *   - `purchase_date` MUST be set.
 *   - `expires_date` MUST be either null (lifetime) OR a future timestamp.
 *   - Lifetime / annual / monthly tier derivation is product-id based.
 *
 * Any deviation returns `null`, which the calling action turns into a
 * user-facing "Could not verify purchase" error and a refusal to mutate
 * the profile.
 */

/** Entitlement identifier in the RevenueCat dashboard. MUST exactly match
 *  the entitlement string configured under Product → Entitlements. Case
 *  and whitespace are significant. */
export const ENTITLEMENT_ID = "FightCamp Wizard Pro";

/** Per-call timeout. 10s gives RC's REST API enough room while keeping the
 *  paywall "Confirming purchase…" loader from hanging. */
const RC_REST_TIMEOUT_MS = 10_000;

export type VerifiedTier = "premium_lifetime" | "premium_annual" | "premium_monthly";

export interface VerifiedEntitlement {
  tier: VerifiedTier;
  /** Epoch ms expiry, or `undefined` for lifetime. */
  expiresAtMs?: number;
  /** Raw RC `product_identifier` — kept for logging / debugging. */
  productId: string;
  /** Raw `purchase_date_ms` from RC. Useful for audit trails. */
  purchaseDateMs: number;
}

function tierFromProductId(pid: string): VerifiedTier {
  const lower = pid.toLowerCase();
  if (lower.includes("lifetime")) return "premium_lifetime";
  if (lower.includes("yearly") || lower.includes("annual")) return "premium_annual";
  return "premium_monthly";
}

interface RcEntitlement {
  product_identifier?: string;
  purchase_date?: string | null;
  purchase_date_ms?: number | null;
  expires_date?: string | null;
  expires_date_ms?: number | null;
}

interface RcSubscriberResponse {
  subscriber?: {
    entitlements?: Record<string, RcEntitlement>;
  };
}

/**
 * Hit RC's `/v1/subscribers/<app_user_id>` REST endpoint and return the
 * strictly-verified entitlement, or `null` if the user is not entitled.
 *
 * Throws on configuration / network errors so the caller can distinguish
 * "user really isn't paying" (resolves with `null`) from "we couldn't
 * check, please retry" (rejects).
 */
export async function verifyEntitlement(
  appUserId: string,
): Promise<VerifiedEntitlement | null> {
  const apiKey = process.env.REVENUECAT_API_KEY;
  if (!apiKey) {
    // Surface as a config error to fail loud at deploy time. The action
    // catches this and turns it into a user-facing error so we don't
    // silently start trusting client claims.
    throw new Error("CONFIG_MISSING_REVENUECAT_API_KEY");
  }

  const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RC_REST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Platform": "ios",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // Network / abort / DNS — propagate so the caller doesn't grant premium.
    throw new Error(`RC_VERIFY_NETWORK_FAILED: ${String((err as Error)?.message ?? err)}`);
  }
  clearTimeout(timer);

  // 404 on RC means "subscriber not found" — i.e. they've never had any RC
  // transaction. Treat as "not entitled" rather than network error so the
  // action can return a clean negative without erroring.
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`RC_VERIFY_HTTP_${res.status}`);
  }

  const body = (await res.json()) as RcSubscriberResponse;
  const entitlement = body?.subscriber?.entitlements?.[ENTITLEMENT_ID];
  if (!entitlement) return null;

  // Strict checks: purchase_date_ms and (lifetime || future-expiry).
  const purchaseDateMs =
    typeof entitlement.purchase_date_ms === "number"
      ? entitlement.purchase_date_ms
      : typeof entitlement.purchase_date === "string"
        ? Date.parse(entitlement.purchase_date)
        : NaN;
  if (!Number.isFinite(purchaseDateMs)) return null;

  const productId =
    typeof entitlement.product_identifier === "string" ? entitlement.product_identifier : "";
  const tier = tierFromProductId(productId);
  const isLifetime = tier === "premium_lifetime";

  let expiresAtMs: number | undefined;
  if (entitlement.expires_date_ms != null || entitlement.expires_date != null) {
    const ms =
      typeof entitlement.expires_date_ms === "number"
        ? entitlement.expires_date_ms
        : Date.parse(entitlement.expires_date as string);
    if (!Number.isFinite(ms)) {
      // Unparseable expiry. Lifetime may legitimately have no expiry, but a
      // garbage value is never trustworthy → not entitled.
      return null;
    }
    if (ms <= Date.now()) return null; // expired
    expiresAtMs = ms;
  }

  // Bounded-expiry guard (F1): a NON-lifetime entitlement MUST carry a
  // finite, future expiry. If RC returned no parseable `expires_date` for a
  // monthly/annual product, treat the user as NOT entitled rather than
  // minting an entitlement with an undefined (=unbounded) expiry.
  if (!isLifetime && expiresAtMs === undefined) return null;

  return {
    tier,
    expiresAtMs,
    productId,
    purchaseDateMs,
  };
}
