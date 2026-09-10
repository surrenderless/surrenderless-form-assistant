/**
 * Removes only the `checkout` query parameter from a URL's search string, preserving every other
 * parameter (e.g. `case`) and the hash — used after handling a Stripe Checkout return so reloading
 * the page never replays the one-time cancellation notice.
 */
export function stripCheckoutQueryParam(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search);
  params.delete("checkout");
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}
