import { shouldQueueDemandLetterFilingTask } from "@/lib/justice/demandLetterFilingTask";
import {
  hasValidMerchantContactRecipient,
  isMerchantContactOperatorFallbackChosen,
  MERCHANT_CONTACT_RECIPIENT_REQUIRED_MESSAGE,
} from "@/lib/justice/merchantContactRecipient";
import { isFirstPreparedPacketApprovalTransition } from "@/lib/justice/rejectUnpaidPreparedPacketApprovalPatch";
import type { JusticeIntake } from "@/lib/justice/types";

export { MERCHANT_CONTACT_RECIPIENT_REQUIRED_MESSAGE as REJECT_DEMAND_LETTER_APPROVAL_NO_RECIPIENT_MESSAGE };

/**
 * Authoritative server gate for the demand-letter lane, mirroring
 * `rejectMerchantContactApprovalWithoutRecipient`. Demand letters are sent to the SAME
 * `company_contact_email` as merchant contact, so this reuses the shared recipient validation and the
 * shared `merchant_contact_operator_fallback` choice (both lanes reach the company at that one
 * address — a consumer who has it lets both auto-send, one who doesn't hands both to operators).
 *
 * Rejects only the first prepared-packet-approval transition when the approved action is the
 * Surrenderless-owned demand letter, there is no valid recipient, and the consumer has NOT chosen
 * operator fallback — otherwise the demand-letter email silently skips and the action sits "queued".
 * Fires only on that exact transition, so an already-approved case is never re-blocked.
 */
export function rejectDemandLetterApprovalWithoutRecipient(params: {
  existingClientState: unknown;
  incomingClientState: unknown;
  intake: JusticeIntake | null | undefined;
}): string | null {
  if (
    !isFirstPreparedPacketApprovalTransition(params.existingClientState, params.incomingClientState)
  ) {
    return null;
  }
  if (!shouldQueueDemandLetterFilingTask(params.incomingClientState)) return null;
  if (isMerchantContactOperatorFallbackChosen(params.incomingClientState)) return null;
  if (hasValidMerchantContactRecipient(params.intake)) return null;
  return MERCHANT_CONTACT_RECIPIENT_REQUIRED_MESSAGE;
}
