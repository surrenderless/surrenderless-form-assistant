import Stripe from "stripe";

let cachedClient: Stripe | null = null;
let cachedKey: string | null = null;

/** Cached per secret key so repeated calls within a request/runtime don't re-construct the SDK. */
export function getStripeClient(secretKey: string): Stripe {
  if (cachedClient && cachedKey === secretKey) return cachedClient;
  cachedClient = new Stripe(secretKey, { apiVersion: "2025-08-27.basil" });
  cachedKey = secretKey;
  return cachedClient;
}
