/**
 * Bounded backoff schedule (milliseconds) for polling the server's `paid_at` after a consumer
 * returns from a successful Stripe Checkout. `paid_at` is written ONLY by the signature-verified
 * `checkout.session.completed` webhook, which is asynchronous and can lag the redirect (serverless
 * cold starts, Stripe delivery/backoff). The client polls with this backoff until confirmation
 * lands, then stops — the total budget is bounded so a genuinely stuck confirmation surfaces a
 * truthful, recoverable timeout instead of spinning forever.
 *
 * ~35.5s total across 10 polls: fast early checks catch the common case within a few seconds, then
 * it settles to 5s intervals to keep loading while still bounding the wait.
 */
export const CHECKOUT_CONFIRMATION_BACKOFF_MS: readonly number[] = [
  1000, 1500, 2000, 3000, 4000, 5000, 5000, 5000, 5000, 5000,
] as const;

/**
 * Delay before the (attempt+1)-th poll, or null when the bounded budget is exhausted (caller must
 * then show the recoverable timeout rather than polling again). Attempt is 0-indexed.
 */
export function checkoutConfirmationDelayForAttempt(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0) return null;
  if (attempt >= CHECKOUT_CONFIRMATION_BACKOFF_MS.length) return null;
  return CHECKOUT_CONFIRMATION_BACKOFF_MS[attempt];
}

/** Total bounded polling budget in milliseconds (sum of the backoff schedule). */
export function checkoutConfirmationTotalBudgetMs(): number {
  return CHECKOUT_CONFIRMATION_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0);
}
