/**
 * Vercel Web Analytics `beforeSend` URL policy: drop events for internal/auth
 * surfaces entirely, and strip every query parameter from anything still tracked
 * so no case/user/session identifiers or auth tokens ever reach analytics.
 */
const EXCLUDED_ANALYTICS_PATH_PREFIXES = [
  "/mock",
  "/debug",
  "/admin",
  "/operator",
  "/sign-in",
] as const;

const URL_PARSE_BASE = "https://analytics-url-policy.invalid";

export function isExcludedFromAnalytics(pathname: string): boolean {
  return EXCLUDED_ANALYTICS_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Returns the sanitized URL to send, or `null` to drop the event.
 * Accepts either an absolute URL or a path (as Vercel Analytics may pass either).
 */
export function applyAnalyticsUrlPolicy(rawUrl: string): string | null {
  const url = new URL(rawUrl, URL_PARSE_BASE);

  if (isExcludedFromAnalytics(url.pathname)) return null;

  url.search = "";
  url.hash = "";

  return url.origin === URL_PARSE_BASE ? url.pathname : url.toString();
}
