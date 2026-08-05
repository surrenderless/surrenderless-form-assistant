/**
 * Validated Stripe environment. Never hardcodes a price or amount — the Price ID is entirely
 * configured through STRIPE_PRICE_ID; this module only reads and validates presence.
 */

function trimEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export type StripeCheckoutEnv =
  | { enabled: true; secretKey: string; priceId: string }
  | { enabled: false; reason: string };

/** Checkout-session creation requires the secret key (to call Stripe) and a configured Price ID. */
export function resolveStripeCheckoutEnv(): StripeCheckoutEnv {
  const secretKey = trimEnv("STRIPE_SECRET_KEY");
  if (!secretKey) {
    return { enabled: false, reason: "STRIPE_SECRET_KEY is not configured" };
  }
  const priceId = trimEnv("STRIPE_PRICE_ID");
  if (!priceId) {
    return { enabled: false, reason: "STRIPE_PRICE_ID is not configured" };
  }
  return { enabled: true, secretKey, priceId };
}

export type StripeWebhookEnv =
  | { enabled: true; secretKey: string; webhookSecret: string }
  | { enabled: false; reason: string };

/** Webhook verification requires the secret key (to construct the Stripe client) and the
 * endpoint's signing secret. */
export function resolveStripeWebhookEnv(): StripeWebhookEnv {
  const secretKey = trimEnv("STRIPE_SECRET_KEY");
  if (!secretKey) {
    return { enabled: false, reason: "STRIPE_SECRET_KEY is not configured" };
  }
  const webhookSecret = trimEnv("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return { enabled: false, reason: "STRIPE_WEBHOOK_SECRET is not configured" };
  }
  return { enabled: true, secretKey, webhookSecret };
}
