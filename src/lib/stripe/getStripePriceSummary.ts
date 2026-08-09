import type Stripe from "stripe";

export type StripePriceSummary = { unitAmount: number; currency: string };

/** Only the single read-only call this module needs — deliberately narrower than the full
 * Stripe client type so a test double never has to implement create/update/list/search. */
export type StripePriceRetrievalClient = {
  prices: { retrieve: (priceId: string) => Promise<Stripe.Price> };
};

/**
 * Read-only lookup of the configured Price's exact amount/currency — never creates a Checkout
 * Session or any other side-effecting Stripe object. Callers use this to disclose the real cost
 * BEFORE checkout is ever triggered, never to merely justify a session already created.
 * Returns null on any failure (missing amount, invalid price id, network/API error) so the
 * caller can fail closed (disable checkout) rather than show a wrong or fabricated price.
 */
export async function fetchStripePriceSummary(
  stripe: StripePriceRetrievalClient,
  priceId: string
): Promise<StripePriceSummary | null> {
  try {
    const price = await stripe.prices.retrieve(priceId);
    if (typeof price.unit_amount !== "number" || !price.currency) {
      return null;
    }
    return { unitAmount: price.unit_amount, currency: price.currency };
  } catch {
    return null;
  }
}
