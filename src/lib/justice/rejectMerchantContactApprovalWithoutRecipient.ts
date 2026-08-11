import { shouldQueueMerchantContactFilingTask } from "@/lib/justice/merchantContactFilingTask";
import {
  hasValidMerchantContactRecipient,
  isMerchantContactOperatorFallbackChosen,
  MERCHANT_CONTACT_RECIPIENT_REQUIRED_MESSAGE,
} from "@/lib/justice/merchantContactRecipient";
import { isFirstPreparedPacketApprovalTransition } from "@/lib/justice/rejectUnpaidPreparedPacketApprovalPatch";
import type { JusticeIntake } from "@/lib/justice/types";

export { MERCHANT_CONTACT_RECIPIENT_REQUIRED_MESSAGE as REJECT_MERCHANT_CONTACT_APPROVAL_NO_RECIPIENT_MESSAGE };

/**
 * Authoritative server gate: reject the FIRST prepared-packet-approval transition when the approved
 * action is Surrenderless-owned merchant contact but the case has no valid recipient email.
 *
 * Without this gate an approved merchant-contact packet with no `company_contact_email` is created
 * and then sits forever showing "queued": `attemptAutomatedMerchantContactEmailDelivery` skips (no
 * recipient) and returns `skipped`, which the PATCH route neither surfaces nor records, so the task
 * stays open with no delivery state. Requiring the recipient at the exact approval transition closes
 * that dead end.
 *
 * Uses `hasValidMerchantContactRecipient` — the same normalized `company_contact_email` validation the
 * chat approval UI and the delivery path resolve against — so the gate and the send can never disagree
 * about whether an email can be sent. Mirrors `rejectUnpaidPreparedPacketApprovalPatch`: fires only on
 * the exact labor-committing transition, so an already-approved/in-progress case is never re-blocked —
 * a later "add the email and retry" PATCH (not a first transition) is allowed straight through.
 *
 * Explicit operator fallback: when the consumer has recorded that they have no merchant email
 * (client_state.merchant_contact_operator_fallback), approval is allowed WITHOUT a recipient — the
 * outreach is handed to operators instead of auto-sent. This preserves the automated-send path for
 * cases that do have a valid email while never dead-ending consumers who don't.
 */
export function rejectMerchantContactApprovalWithoutRecipient(params: {
  existingClientState: unknown;
  incomingClientState: unknown;
  intake: JusticeIntake | null | undefined;
}): string | null {
  if (
    !isFirstPreparedPacketApprovalTransition(params.existingClientState, params.incomingClientState)
  ) {
    return null;
  }
  if (!shouldQueueMerchantContactFilingTask(params.incomingClientState)) return null;
  if (isMerchantContactOperatorFallbackChosen(params.incomingClientState)) return null;
  if (hasValidMerchantContactRecipient(params.intake)) return null;
  return MERCHANT_CONTACT_RECIPIENT_REQUIRED_MESSAGE;
}
