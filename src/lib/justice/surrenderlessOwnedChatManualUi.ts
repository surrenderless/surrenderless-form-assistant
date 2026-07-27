/**
 * Chat / hub / cases UI gates for Surrenderless-owned steps.
 *
 * Chat consumer DIY fulfillment is fail-closed: consumers never advance a real case by
 * recording manual filing, request-handling, mark-handled, DIY outcome, or archive substitutes.
 * Hub / Saved Cases keep opt-out suppress for this PR (copy scrub is a follow-up).
 */

import { ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP } from "@/lib/justice/escalationLadderResolution";

/**
 * Merchant-contact confirm is intake documentation, not DIY external filing.
 * Still hidden while owned suppress is active.
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

/**
 * Chat: never expose Request handling / mark-opened / Record handled as consumer progress.
 * `suppressOwnedManualUi` is ignored (fail-closed).
 */
export function shouldShowChatConsumerManualHandlingControls(
  _suppressOwnedManualUi?: boolean
): boolean {
  return false;
}

/**
 * Hub and Saved Cases: hide Request handling / Record handled DIY while Surrenderless owns
 * the approved step. Kept opt-out (separate from chat fail-closed).
 */
export function shouldShowHubOrCasesConsumerManualHandlingControls(
  suppressOwnedManualUi: boolean
): boolean {
  return !suppressOwnedManualUi;
}

/**
 * Chat post-filing endgame: never expose consumer DIY outcome / follow-up / clear.
 * `suppressOwnedManualUi` is ignored (fail-closed).
 */
export function shouldShowChatConsumerEndgameDiyControls(
  _suppressOwnedManualUi?: boolean
): boolean {
  return false;
}

/**
 * Chat consumer Archive case — never a substitute for operator closure.
 * `suppressOwnedManualUi` / operator terminal flags are ignored (fail-closed).
 */
export function shouldShowChatConsumerArchiveControl(_input: {
  suppressOwnedManualUi: boolean;
  hasOperatorTerminalResponseReviewOutcome: boolean;
}): boolean {
  return false;
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

/**
 * Chat handling-tracking: always owned/awaiting copy — never DIY "prepare the manual action".
 * `suppressOwnedManualUi` is ignored (fail-closed).
 */
export function resolveChatOwnedHandlingTrackingStep(input: {
  suppressOwnedManualUi?: boolean;
  resolutionFlowExposed: boolean;
  manualDerivedStep: string | null;
}): string | null {
  if (!input.manualDerivedStep) return null;
  if (input.resolutionFlowExposed) {
    return OWNED_ENDGAME_HANDLING_TRACKING_STEP;
  }
  return ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP;
}
