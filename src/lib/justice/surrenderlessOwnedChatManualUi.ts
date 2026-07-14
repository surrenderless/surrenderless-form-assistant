/**
 * Chat UI gates for Surrenderless-owned steps.
 * Owned flows must never expose consumer DIY submit/contact/file/confirm/request-handling.
 */

export function shouldShowChatMerchantContactConfirmationControls(input: {
  suppressOwnedManualUi: boolean;
  needsMerchantContactDocumentation: boolean;
  hasChatCapturedMerchantContactInput: boolean;
}): boolean {
  return (
    !input.suppressOwnedManualUi &&
    input.needsMerchantContactDocumentation &&
    input.hasChatCapturedMerchantContactInput
  );
}

/** Request handling / mark-opened / DIY prep stay hidden while owned suppress is active. */
export function shouldShowChatConsumerManualHandlingControls(
  suppressOwnedManualUi: boolean
): boolean {
  return !suppressOwnedManualUi;
}

export const OWNED_STEP_CHAT_STATUS_COPY =
  "Surrenderless is carrying this action through operator fulfillment. Stay in chat for queued, completed, and next-step updates.";

export const OWNED_STEP_HANDLING_TRACKING_COPY =
  "Surrenderless owns this step — queued/in-progress/completed status updates here; no consumer submit or file controls.";
