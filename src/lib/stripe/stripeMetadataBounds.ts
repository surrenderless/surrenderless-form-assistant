// Stripe's own documented limit for a single metadata value. Every real prepared-action href/
// label in this codebase is a short static string (well under 100 chars) — this exists as a
// fail-closed backstop, never a truncation path: a value that would need truncating is refused
// outright rather than silently corrupted into an unmatchable href the webhook could never bind
// back to a real fulfillment task (see finalizePaidPreparedPacketApproval.ts).
export const STRIPE_METADATA_MAX_VALUE_LENGTH = 500;

export function fitsStripeMetadataValue(s: string): boolean {
  return s.length <= STRIPE_METADATA_MAX_VALUE_LENGTH;
}
