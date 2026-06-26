"use node";

/**
 * Firebase Cloud Messaging HTTP v1 OAuth2 access-token minter.
 *
 * The legacy FCM "server key" HTTP API (`/fcm/send` with `Authorization: key=`)
 * was decommissioned by Google in 2024. The v1 API instead requires a
 * short-lived OAuth2 access token, obtained by signing a service-account JWT
 * (RS256) and exchanging it at Google's token endpoint. We cache the access
 * token in module-level state (refreshed ~5min before expiry), exactly like
 * the APNs JWT cache in `apnsJwt.ts`. Convex reuses the same Node container
 * across invocations within an instance, so the cache survives between calls.
 *
 * Required env vars (from the Firebase service-account JSON you download at
 * Firebase → Project Settings → Service accounts → Generate new private key):
 *   FCM_PROJECT_ID    -> the JSON's `project_id`
 *   FCM_CLIENT_EMAIL  -> the JSON's `client_email`
 *   FCM_PRIVATE_KEY   -> the JSON's `private_key` (PEM, BEGIN/END lines kept;
 *                        literal `\n` escapes are normalized to real newlines)
 */
import { webcrypto } from "node:crypto";

const subtle = webcrypto.subtle;
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let cached: { token: string; expires: number } | null = null;

function b64url(input: Uint8Array | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function importRsaKey(pem: string): Promise<CryptoKey> {
  // Service-account keys are often stored with literal `\n` escapes (e.g. when
  // pasted into an env var). Normalize those before stripping the PEM armor.
  const cleaned = pem
    .replace(/\\n/g, "\n")
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(Buffer.from(cleaned, "base64"));
  return subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** The FCM project id, or null if unconfigured. */
export function fcmProjectId(): string | null {
  return process.env.FCM_PROJECT_ID || null;
}

/**
 * Returns a valid FCM v1 OAuth2 access token, minting + caching as needed.
 * Returns null if any required env var is missing or the token exchange fails
 * (callers treat null as "fcm-not-configured" and skip the send).
 */
export async function getFcmAccessToken(): Promise<string | null> {
  const clientEmail = process.env.FCM_CLIENT_EMAIL;
  const privateKey = process.env.FCM_PRIVATE_KEY;
  const projectId = process.env.FCM_PROJECT_ID;
  if (!clientEmail || !privateKey || !projectId) return null;

  if (cached && Date.now() < cached.expires) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URI,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(
    JSON.stringify(payload),
  )}`;

  let assertion: string;
  try {
    const key = await importRsaKey(privateKey);
    const sigBuf = await subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      new TextEncoder().encode(signingInput),
    );
    assertion = `${signingInput}.${b64url(new Uint8Array(sigBuf))}`;
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(TOKEN_URI, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) return null;
    const ttlSec = (json.expires_in ?? 3600) - 300; // refresh 5min early
    cached = { token: json.access_token, expires: Date.now() + ttlSec * 1000 };
    return json.access_token;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
