/**
 * Shared `?date=YYYY-MM-DD` deep-link convention for the logging pages
 * (Nutrition, Training Calendar, Wellness check-in, …).
 *
 * Callers that want a logging page to open on a PAST date append
 * `?date=<targetDate>` so the page opens on that day rather than today.
 * Centralised here so every page parses + validates the param identically.
 *
 * Dates are local-calendar `YYYY-MM-DD` strings (matching the app's logging
 * convention everywhere else). Future dates are rejected: this only ever
 * targets the past or today, and there is no point logging the future.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today as a local-calendar `YYYY-MM-DD` string. */
export function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Read and validate a `date` search param. Returns the param when it is a
 * well-formed `YYYY-MM-DD` that is not in the future; otherwise returns
 * `fallback` (defaults to today). Safe to call with a `null` params object.
 */
export function readDateParam(
  params: URLSearchParams | null | undefined,
  fallback: string = todayIsoLocal(),
): string {
  const raw = params?.get("date");
  if (!raw || !ISO_DATE_RE.test(raw)) return fallback;
  // String compare is valid for zero-padded ISO dates; reject the future.
  if (raw > todayIsoLocal()) return fallback;
  return raw;
}
