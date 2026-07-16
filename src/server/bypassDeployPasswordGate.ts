/**
 * Paths that skip the site-wide DEPLOY_PASSWORD Basic Auth gate in middleware.
 * Cron routes still enforce CRON_SECRET in their own handlers.
 */
export function shouldBypassDeployPasswordGate(pathname: string): boolean {
  if (pathname.startsWith("/api/cron/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/api/healthz") return true;
  return false;
}
