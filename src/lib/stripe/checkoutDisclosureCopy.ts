import { formatStripeAmount } from "@/lib/stripe/formatStripeAmount";

/**
 * Result of the pre-checkout price lookup (GET /api/justice/cases/[id]/checkout). "not_needed"
 * means the case is already paid — no payment disclosure or price is relevant, and checkout must
 * never be blocked on pricing for an already-paid case (there is nothing left to price).
 */
export type CheckoutPriceState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "not_needed" }
  | { status: "ready"; unitAmount: number; currency: string };

export const CHECKOUT_PRICE_LOADING_MESSAGE = "Loading pricing…";

export const CHECKOUT_PRICE_UNAVAILABLE_MESSAGE =
  "Pricing is currently unavailable, so approval is disabled. Try again shortly.";

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
 * True only when checkout must be blocked because pricing hasn't loaded or failed to load.
 * Never blocks an already-paid case ("not_needed" — no checkout is triggered for it at all) or a
 * case whose price is confirmed ("ready").
 */
export function isCheckoutApprovalBlockedByPricing(state: CheckoutPriceState): boolean {
  return state.status === "loading" || state.status === "unavailable";
}
