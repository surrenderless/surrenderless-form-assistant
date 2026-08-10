/**
 * Paths that skip the site-wide DEPLOY_PASSWORD Basic Auth gate in middleware.
 * Cron routes still enforce CRON_SECRET in their own handlers.
 */
export function shouldBypassDeployPasswordGate(pathname: string): boolean {
  if (pathname.startsWith("/api/cron/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/api/healthz") return true;
  // Stripe webhook authenticates via its own signature (STRIPE_WEBHOOK_SECRET) in-route, like
  // cron uses CRON_SECRET — Stripe cannot supply DEPLOY_PASSWORD Basic credentials, so this
  // exact path must skip the gate or the middleware 401s the request before the route runs.
  if (pathname === "/api/webhooks/stripe") return true;
  return false;
}
