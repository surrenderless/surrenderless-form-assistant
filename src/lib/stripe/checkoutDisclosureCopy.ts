import { formatStripeAmount } from "@/lib/stripe/formatStripeAmount";

/**
 * Result of the pre-checkout price lookup (GET /api/justice/cases/[id]/checkout). "not_needed"
 * means the case is already paid — no payment disclosure or price is relevant, and checkout must
 * never be blocked on pricing for an already-paid case (there is nothing left to price).
 *
 * "confirming"/"confirm_timeout" are the post-payment states: the consumer has completed Stripe
 * Checkout and returned, but paid_at is only ever written by the signature-verified webhook, so the
 * UI waits (bounded backoff) for that authoritative confirmation. Both must block approval so a
 * consumer who already paid is never sent to start a second checkout while confirmation is pending.
 */
export type CheckoutPriceState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "not_needed" }
  | { status: "confirming" }
  | { status: "confirm_timeout" }
  | { status: "ready"; unitAmount: number; currency: string };

export const CHECKOUT_PRICE_LOADING_MESSAGE = "Loading pricing…";

export const CHECKOUT_PRICE_UNAVAILABLE_MESSAGE =
  "Pricing is currently unavailable, so approval is disabled. Try again shortly.";

export const CHECKOUT_CONFIRMING_PAYMENT_MESSAGE =
  "Confirming your payment… This can take a few moments. Keep this chat open — you don't need to pay again.";

export const CHECKOUT_CONFIRMATION_TIMEOUT_MESSAGE =
  "Your payment went through, but confirmation is taking longer than usual. You haven't been charged twice and don't need to pay again — keep checking, or come back shortly and it will resume automatically.";

/** Exact, non-negotiable disclosure required before checkout can ever be triggered — payment
 * opens Stripe Checkout, is per case, does not guarantee an outcome, is final once completed,
 * and the definite refund policy (duplicate charges, an uncorrectable verified Surrenderless
 * technical failure, or as required by law — nothing else). */
export const CHECKOUT_DISCLOSURE_PARAGRAPHS = [
  "Clicking Approve opens Stripe Checkout to pay this fee for this case. Payment does not guarantee a successful outcome and is final once completed.",
  "Changing your mind, withdrawing, or asking to stop after payment does not qualify for a refund. You may stop future actions, but actions already submitted or queued may not be reversible.",
  "Refunds are limited to: duplicate charges, a verified Surrenderless technical failure that prevents completion and can't be fixed or completed through a supported alternative, or as required by law.",
] as const;

/** Builds the exact headline shown before checkout — the real amount/currency from the
 * server-side price lookup, never a hardcoded or estimated figure. */
export function buildCheckoutPriceHeadline(unitAmount: number, currency: string): string {
  return `One-time fee: ${formatStripeAmount(unitAmount, currency)}`;
}

/**
 * True when approval must be blocked from starting checkout: pricing hasn't loaded/failed to load,
 * OR a payment is being confirmed (or its confirmation timed out) — in the latter two the consumer
 * has already paid, so approval must never re-open Stripe. Never blocks an already-paid, fully
 * confirmed case ("not_needed") or a case whose price is confirmed and unpaid ("ready").
 */
export function isCheckoutApprovalBlockedByPricing(state: CheckoutPriceState): boolean {
  return (
    state.status === "loading" ||
    state.status === "unavailable" ||
    state.status === "confirming" ||
    state.status === "confirm_timeout"
  );
}

/** True while a completed payment is awaiting webhook confirmation (or that wait timed out). Used to
 * show truthful "confirming" copy and to keep Approve from initiating a second checkout. */
export function isCheckoutAwaitingPaymentConfirmation(state: CheckoutPriceState): boolean {
  return state.status === "confirming" || state.status === "confirm_timeout";
}
