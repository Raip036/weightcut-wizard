/**
 * Auth error mapping.
 *
 * Convex Auth's Password / OAuth providers reject with raw, machine-shaped
 * error names ("InvalidAccountId", "InvalidSecret", etc) that we do NOT want
 * to surface to end users — they're cryptic AND they leak whether an email
 * exists (a low-grade enumeration vector). This module centralises the
 * mapping from raw error → friendly UI string per flow.
 *
 * The function is defensive: `err` can be an `Error`, a plain object with a
 * `.message`, a string, or genuinely `unknown`. We probe `err?.data?.message`
 * (Convex sometimes wraps), `err?.message`, and `String(err)` and lowercase
 * the union before pattern-matching.
 */

export type AuthFlow =
  | "signIn"
  | "signUp"
  | "reset"
  | "reset-verification"
  | "oauth";

function extractRaw(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  const anyErr = err as { data?: { message?: unknown }; message?: unknown };
  const fromData =
    typeof anyErr?.data?.message === "string" ? anyErr.data.message : "";
  const fromMessage =
    typeof anyErr?.message === "string" ? anyErr.message : "";
  const fromString = (() => {
    try { return String(err); } catch { return ""; }
  })();
  return `${fromData} ${fromMessage} ${fromString}`.trim();
}

export function mapAuthError(err: unknown, flow: AuthFlow): string {
  const raw = extractRaw(err);
  const lower = raw.toLowerCase();

  // Network failures should win regardless of flow.
  if (
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("networkerror") ||
    lower.includes("offline")
  ) {
    return "Network problem. Check your connection and try again.";
  }

  // Rate-limiting (server or proxy) — covers both verbal and HTTP forms.
  if (lower.includes("429") || lower.includes("rate") || lower.includes("too many")) {
    return "Too many attempts. Please wait a minute and try again.";
  }

  const hasInvalidAccount = lower.includes("invalidaccountid");
  const hasInvalidSecret = lower.includes("invalidsecret");
  const hasAccountExists = lower.includes("account already exists");
  // Convex Auth's default `validateDefaultPasswordRequirements` throws a
  // terse `Error("Invalid password")` when the new password is shorter than
  // 8 characters. Without mapping this we'd surface the raw string to users.
  const hasInvalidPassword = lower.includes("invalid password");

  switch (flow) {
    case "signIn":
      // Don't leak which half (email vs password) was wrong — both map to the
      // same friendly message.
      if (hasInvalidAccount || hasInvalidSecret) {
        return "Incorrect email or password.";
      }
      return "Couldn't sign you in. Please try again.";

    case "signUp":
      if (hasAccountExists) {
        return "An account with this email already exists. Try signing in.";
      }
      if (hasInvalidPassword) {
        return "Password must be at least 8 characters.";
      }
      return "Couldn't create your account. Please try again.";

    case "reset":
      // Always claim success-ish to avoid existence enumeration.
      if (hasInvalidAccount) {
        return "If an account with that email exists, we sent a code.";
      }
      return "Couldn't start password reset. Please try again.";

    case "reset-verification":
      if (hasInvalidSecret) {
        return "That code is incorrect or expired.";
      }
      if (hasInvalidAccount) {
        return "That code is incorrect or expired.";
      }
      if (hasInvalidPassword) {
        return "Password must be at least 8 characters.";
      }
      return "Couldn't update your password. Please try again.";

    case "oauth":
      return "Apple Sign-In didn't complete. Please try again.";
  }
}

/**
 * True when a sign-up rejection is Convex Auth's "Account <email> already
 * exists" (thrown by the Password provider when the (provider, email) slot is
 * occupied). Used by the sign-up flow to decide whether to attempt an
 * orphaned-account purge + retry before surfacing the duplicate error.
 */
export function isAccountExistsError(err: unknown): boolean {
  return extractRaw(err).toLowerCase().includes("already exists");
}

/**
 * True when an Apple Sign-In rejection represents the user dismissing the
 * native sheet (or closing the web popup) — not a real failure. The plugin,
 * Convex's wrapper, and the web fallback each surface cancels differently;
 * we accept any of them as "silent, no-op" so the UI never toasts an error
 * just because the user changed their mind.
 *
 * Recognises:
 *  - `code === 1001` or `"1001"` (Apple's ASAuthorizationError.canceled)
 *  - `code === "ERR_CANCELED"` (Capacitor plugin convention)
 *  - `code === "ASAUTHORIZATION_ERROR_CANCELED"` (verbose plugin variants)
 *  - `error === "popup_closed_by_user"` / `"user_cancelled_authorize"` (web)
 *  - iOS "The operation couldn't be completed … error 1001" string
 *  - Any message containing "cancel" / "cancelled" / "canceled"
 */
export function isAppleCancelError(err: unknown): boolean {
  if (!err) return false;
  const e = err as {
    code?: unknown;
    error?: unknown;
    message?: unknown;
    name?: unknown;
  };

  const code = e.code;
  if (
    code === 1001 ||
    code === "1001" ||
    code === "ERR_CANCELED" ||
    code === "ASAUTHORIZATION_ERROR_CANCELED"
  ) {
    return true;
  }

  if (typeof e.error === "string") {
    const errStr = e.error.toLowerCase();
    if (
      errStr === "popup_closed_by_user" ||
      errStr === "user_cancelled_authorize" ||
      errStr.includes("cancel")
    ) {
      return true;
    }
  }

  const raw = extractRaw(err).toLowerCase();
  if (raw.includes("cancel")) return true;
  // iOS surfaces the canceled sheet as "The operation couldn't be completed.
  // (com.apple.AuthenticationServices.AuthorizationError error 1001.)" — no
  // literal "cancel" word, so match on the error number embedded in the
  // message as a last-resort heuristic.
  if (/authorizationerror error 1001/.test(raw)) return true;

  if (typeof e.name === "string" && e.name.toLowerCase().includes("cancel")) {
    return true;
  }

  return false;
}

/**
 * Strict-enough email regex. Intentionally simple — the server is the
 * authority. We only block obvious garbage so the user gets immediate feedback
 * rather than a round-trip-late server error.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}
