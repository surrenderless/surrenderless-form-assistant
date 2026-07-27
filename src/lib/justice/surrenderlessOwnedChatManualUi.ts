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

/**
 * Post-filing endgame: hide consumer DIY outcome / follow-up / clear when Surrenderless owns
 * the step (or resolution was auto-started after owned terminal filing).
 */
export function shouldShowChatConsumerEndgameDiyControls(
  suppressOwnedManualUi: boolean
): boolean {
  return !suppressOwnedManualUi;
}

/**
 * Consumer Archive case control — only for non-owned edges. Owned endgame closes via
 * operator response-review → operator archive.
 */
export function shouldShowChatConsumerArchiveControl(input: {
  suppressOwnedManualUi: boolean;
  hasOperatorTerminalResponseReviewOutcome: boolean;
}): boolean {
  if (input.suppressOwnedManualUi) return false;
  if (input.hasOperatorTerminalResponseReviewOutcome) return false;
  return true;
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

/** Chat endgame wait copy while Surrenderless tracks follow-up and closes the case. */
export const OWNED_ENDGAME_WAIT_COPY =
  "Stay in chat — Surrenderless is tracking follow-up and will close this case when resolved. You do not need to record outcome or mark follow-up handled.";

/** Handling-tracking line during owned post-filing follow-up / closure. */
export const OWNED_ENDGAME_HANDLING_TRACKING_STEP =
  "Surrenderless is tracking follow-up and will close this case when resolved.";

/** Prefer owned endgame / awaiting-operator copy over DIY handling-tracking steps in chat. */
export function resolveChatOwnedHandlingTrackingStep(input: {
  suppressOwnedManualUi: boolean;
  resolutionFlowExposed: boolean;
  manualDerivedStep: string | null;
}): string | null {
  if (!input.manualDerivedStep) return null;
  if (!input.suppressOwnedManualUi) return input.manualDerivedStep;
  if (input.resolutionFlowExposed) {
    return OWNED_ENDGAME_HANDLING_TRACKING_STEP;
  }
  return ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP;
}
