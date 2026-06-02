import type { NavigateFunction } from "react-router-dom";

type ExpectedRole = "fighter" | "coach";

interface ToastFn {
  (props: { title?: string; description?: string; variant?: "default" | "destructive" }): unknown;
}

const COACH_PREFIXES = ["/coach"];
const NEUTRAL_PREFIXES = ["/join", "/legal", "/share"];
const FIGHTER_PREFIXES = [
  "/dashboard",
  "/nutrition",
  "/weight",
  "/weight-cut",
  "/weight-plan",
  "/weight-protocol",
  "/training",
  "/training-calendar",
  "/recovery",
  "/sleep",
  "/fight-camps",
  "/fight-week",
  "/hydration",
  "/gym",
  "/my-gym",
  "/goals",
  "/wizard",
  "/cut-plan",
  "/onboarding",
];

function startsWithPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`) || path.startsWith(`${p}#`));
}

/**
 * Return true when `path` is a sensible destination for `role`.
 *
 *  - Role-neutral paths (`/join`, `/legal`, `/share`) are compatible with both
 *  - Coach paths (`/coach`...) are coach-only
 *  - All known fighter paths are fighter-only
 *  - Unknown paths default to fighter-only (matches legacy behaviour)
 *  - Garbage / unsafe inputs (empty, "null", protocol-relative, javascript:, etc.) → false
 */
export function isRouteCompatibleWithRole(
  path: string | null | undefined,
  role: ExpectedRole,
): boolean {
  if (typeof path !== "string") return false;
  const trimmed = path.trim();
  if (!trimmed) return false;
  if (trimmed === "null" || trimmed === "undefined") return false;
  if (!trimmed.startsWith("/")) return false;
  if (trimmed.startsWith("//")) return false;
  if (/^[a-z]+:/i.test(trimmed)) return false;

  if (startsWithPrefix(trimmed, NEUTRAL_PREFIXES)) return true;
  if (startsWithPrefix(trimmed, COACH_PREFIXES)) return role === "coach";
  if (startsWithPrefix(trimmed, FIGHTER_PREFIXES)) return role === "fighter";
  return role === "fighter";
}

/**
 * Branch a freshly-signed-in user to the correct dashboard.
 *
 * Post-Convex migration: the user's role lives on the `profiles` row that the
 * `UserContext.profile` Convex query keeps live. Callers should pass the
 * already-resolved `actualRole` (read from `useUser().profile?.role`) instead
 * of re-fetching it. When `actualRole` is unknown (e.g. on the very first
 * post-auth render), we fall back to the `expected` value the door encodes.
 *
 * When `isRoleResolved === false`, this function returns without navigating —
 * callers should re-invoke once the profile (and therefore role) has loaded.
 *
 * When `pendingRedirect` is supplied (e.g. a `/join?code=...` deep link the
 * user came in via), it is honoured *only if* it is role-compatible. Otherwise
 * the user is bounced to their role's home.
 */
export async function routeAfterAuth(
  _userId: string,
  expected: ExpectedRole,
  navigate: NavigateFunction,
  toast: ToastFn,
  actualRole?: ExpectedRole | null,
  isRoleResolved: boolean = true,
  pendingRedirect?: string | null,
): Promise<void> {
  void _userId;

  // Wait for role to resolve before navigating; avoids the cross-door flash.
  if (!isRoleResolved && actualRole == null) return;

  const role = actualRole ?? expected;

  if (pendingRedirect && isRouteCompatibleWithRole(pendingRedirect, role)) {
    navigate(pendingRedirect, { replace: true });
    return;
  }

  if (role === expected) {
    navigate(expected === "coach" ? "/coach" : "/dashboard", { replace: true });
    return;
  }

  // Cross-door — warn but don't block
  if (role === "coach") {
    toast({ title: "This account is a coach", description: "Opening your coach dashboard." });
    try { localStorage.setItem("wcw_intended_role", "coach"); } catch { /* noop */ }
    navigate("/coach", { replace: true });
  } else {
    toast({ title: "This account is a fighter", description: "Opening your athlete dashboard." });
    try { localStorage.setItem("wcw_intended_role", "fighter"); } catch { /* noop */ }
    navigate("/dashboard", { replace: true });
  }
}
