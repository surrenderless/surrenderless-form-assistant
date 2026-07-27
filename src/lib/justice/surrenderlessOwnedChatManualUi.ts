/**
 * Chat / hub / cases UI gates for Surrenderless-owned steps.
 * Owned flows must never expose consumer DIY submit/contact/file/confirm/request-handling.
 */

import { ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP } from "@/lib/justice/escalationLadderResolution";

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

/**
 * Hub and Saved Cases: same gate as chat — hide Request handling / Record handled DIY
 * while Surrenderless owns the approved step.
 */
export function shouldShowHubOrCasesConsumerManualHandlingControls(
  suppressOwnedManualUi: boolean
): boolean {
  return shouldShowChatConsumerManualHandlingControls(suppressOwnedManualUi);
}

/** Prefer owned awaiting-operator copy over DIY manual-action next steps on hub/cases. */
export function resolveHubOrCasesHandlingTrackingStep(input: {
  suppressOwnedManualUi: boolean;
  manualDerivedStep: string;
}): string {
  if (input.suppressOwnedManualUi) {
    return ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP;
  }
  return input.manualDerivedStep;
}

export const OWNED_STEP_CHAT_STATUS_COPY =
  "Surrenderless is carrying this action through operator fulfillment. Stay in chat for queued, completed, and next-step updates.";

export const OWNED_STEP_HANDLING_TRACKING_COPY =
  "Surrenderless owns this step — queued/in-progress/completed status updates here; no consumer submit or file controls.";

/** Hub / Saved Cases status when the approved step is Surrenderless-owned. */
export const OWNED_STEP_HUB_CASES_STATUS_COPY =
  "Surrenderless is carrying this approved step. Continue in chat for queued, in-progress, and completed updates.";
