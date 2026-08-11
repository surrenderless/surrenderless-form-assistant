import { normalizeCompanyContactEmail } from "@/lib/justice/normalizeCompanyContactEmail";
import type { JusticeIntake } from "@/lib/justice/types";

/**
 * Payment-dispute automated outreach targets the bank/card issuer's dispute email
 * (`card_issuer_contact_email`), which consumers almost never have — chargebacks are normally filed
 * through their own bank. So automated delivery skips for essentially every case and the dispute is
 * handled by operators instead. This is the single client-safe check the chat status uses to tell an
 * honest "operators are handling it" state apart from a genuine automated send, mirroring the
 * validation the delivery path applies to `card_issuer_contact_email`.
 */
export function resolvePaymentDisputeRecipientEmail(
  rawEmail: string | null | undefined
): string | null {
  const normalized = normalizeCompanyContactEmail((rawEmail ?? "").toString());
  return normalized || null;
}

/** True when the intake carries a valid card-issuer dispute email Surrenderless can auto-send to. */
export function hasValidPaymentDisputeRecipient(
  intake: Pick<JusticeIntake, "card_issuer_contact_email"> | null | undefined
): boolean {
  return resolvePaymentDisputeRecipientEmail(intake?.card_issuer_contact_email) !== null;
}
