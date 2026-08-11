import { normalizeCompanyContactEmail } from "@/lib/justice/normalizeCompanyContactEmail";
import type { JusticeIntake } from "@/lib/justice/types";

/**
 * Surrenderless sends the merchant/company first-contact email itself, so a merchant-contact packet
 * can only be approved once the case has a real recipient address. This is the single client-safe
 * source of truth for "do we have a valid merchant recipient?" — it mirrors the server-side
 * `resolveMerchantOutreachRecipientEmail` used by the actual delivery path, so the approval gate and
 * the delivery attempt can never disagree about whether an email can be sent.
 */
export const MERCHANT_CONTACT_RECIPIENT_REQUIRED_MESSAGE =
  "Add the company's contact email so Surrenderless can send your first message to them. We can't start merchant outreach without a valid recipient address.";

/** The normalized, valid merchant-outreach recipient email, or null when missing/invalid. */
export function resolveMerchantContactRecipientEmail(
  rawEmail: string | null | undefined
): string | null {
  const normalized = normalizeCompanyContactEmail((rawEmail ?? "").toString());
  return normalized || null;
}

/** True when the intake carries a valid company_contact_email Surrenderless can send outreach to. */
export function hasValidMerchantContactRecipient(
  intake: Pick<JusticeIntake, "company_contact_email"> | null | undefined
): boolean {
  return resolveMerchantContactRecipientEmail(intake?.company_contact_email) !== null;
}

/**
 * True when the case's client_state records the consumer's explicit "I have no merchant email —
 * operators will handle it" choice. This is the sanctioned way to approve/pay for a merchant-contact
 * packet without a recipient: it unblocks approval AND tells the UI to show operator handling rather
 * than falsely implying an automated email is queued.
 */
export function isMerchantContactOperatorFallbackChosen(clientState: unknown): boolean {
  if (!clientState || typeof clientState !== "object" || Array.isArray(clientState)) return false;
  return (clientState as Record<string, unknown>).merchant_contact_operator_fallback === true;
}
