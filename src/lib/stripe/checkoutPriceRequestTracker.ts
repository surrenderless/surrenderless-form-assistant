export type CheckoutPriceRequestRef = { caseId: string; requestId: number } | null;

/**
 * True only when a NEW price fetch/request must be skipped because the case is already known
 * paid (from the server's own hydrated paid_at, never from a redirect param or other client
 * signal) — the core guarantee behind "an already-paid case makes zero pricing requests." Pricing
 * is irrelevant once paid, and re-confirming it would be a pointless real network call (and, for
 * the Playwright mock pipeline, one the read-only price endpoint has no mock awareness for).
 */
export function shouldSkipCheckoutPriceFetchForPaidCase(isPaid: boolean): boolean {
  return isPaid;
}

/** Computes the next per-case request id — a fresh, incrementing id every time a fetch starts
 * for the given case, whether the very first attempt or an explicit retry after failure, so a
 * later-resolving response tied to an older/superseded request can be identified as stale. */
export function nextCheckoutPriceRequestId(current: CheckoutPriceRequestRef, caseId: string): number {
  return (current?.caseId === caseId ? current.requestId : 0) + 1;
}

/**
 * True when a resolved price response is stale and must never be applied to state: either a
 * different case is now active (the consumer switched cases), or a newer request for the SAME
 * case has since superseded it (an explicit retry, or the checkout-return flow independently
 * confirming payment). This is what prevents a cancelled/superseded request from ever altering
 * another case's — or a newer attempt's — state.
 */
export function isCheckoutPriceResponseStale(
  current: CheckoutPriceRequestRef,
  caseId: string,
  requestId: number
): boolean {
  return current?.caseId !== caseId || current?.requestId !== requestId;
}

/**
 * True when the per-case "already fetched" guard must be cleared after a failure, so a future
 * attempt — the consumer re-entering the approval step, or the explicit Retry pricing action —
 * is never permanently blocked by "a fetch was already attempted for this case." This is the
 * guarantee behind "a failed request can be retried successfully in the same session," without
 * requiring a page reload.
 */
export function shouldClearFetchedGuardOnFailure(
  fetchedForCaseId: string | null,
  caseId: string
): boolean {
  return fetchedForCaseId === caseId;
}
