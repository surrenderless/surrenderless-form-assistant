export type CheckoutReturnStatus = "success" | "cancelled";

/** Parses `?checkout=success|cancelled` from a Stripe Checkout return URL. Never treated as proof
 * of payment by itself — callers must always re-verify against the server's own paid_at. */
export function parseCheckoutReturnStatus(search: string): CheckoutReturnStatus | null {
  const status = new URLSearchParams(search).get("checkout")?.trim();
  return status === "success" || status === "cancelled" ? status : null;
}
