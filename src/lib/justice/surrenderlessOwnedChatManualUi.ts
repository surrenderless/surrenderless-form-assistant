/**
 * Chat / hub / cases UI gates for Surrenderless-owned steps.
 *
 * Consumer DIY fulfillment is fail-closed on chat, Hub, and Saved Cases: consumers never
 * advance a real case by recording manual filing, request-handling, mark-handled, DIY
 * outcome, or archive substitutes.
 */

import { ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP } from "@/lib/justice/escalationLadderResolution";
import {
  HANDLING_TRACKING_STEP_COMPLETE,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import { isMerchantResolvedTerminalAction } from "@/lib/justice/handlingTrackingProgress";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

/**
 * Merchant-contact confirm is intake documentation, not DIY external filing.
 * Still hidden while owned suppress is active (chat only).
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
 * Hub and Saved Cases: never expose Request handling / Record handled DIY as consumer progress.
 * `suppressOwnedManualUi` is ignored (fail-closed; matches chat).
 */
export function shouldShowHubOrCasesConsumerManualHandlingControls(
  _suppressOwnedManualUi?: boolean
): boolean {
  return false;
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

/**
 * Hub / Saved Cases handling-tracking: always owned/awaiting copy — never DIY
 * "prepare the manual action" / "after external submission".
 * `suppressOwnedManualUi` is ignored (fail-closed).
 *
 * The one exception is the consumer-owned merchant-resolved terminal state: there is no
 * operator step to await — nothing was ever queued, and none ever will be — so defaulting to
 * "awaiting Surrenderless operator fulfillment" here would be actively wrong, not just
 * DIY-permissive. Checked via the same isMerchantResolvedTerminalAction predicate chat-ai uses,
 * so Hub, Saved Cases, and chat can never drift on what counts as this terminal state.
 */
export function resolveHubOrCasesHandlingTrackingStep(input: {
  suppressOwnedManualUi?: boolean;
  manualDerivedStep: string;
  next?: Pick<JusticeApprovedNextAction, "href" | "status">;
}): string {
  if (input.next && isMerchantResolvedTerminalAction(input.next)) {
    return HANDLING_TRACKING_STEP_COMPLETE;
  }
  void input.suppressOwnedManualUi;
  void input.manualDerivedStep;
  return ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP;
}

export const OWNED_STEP_CHAT_STATUS_COPY =
  "Surrenderless is carrying this action through operator fulfillment. Stay in chat for queued, completed, and next-step updates.";

export const OWNED_STEP_HANDLING_TRACKING_COPY =
  "Surrenderless owns this step — queued/in-progress/completed status updates here; no consumer submit or file controls.";

/** Hub / Saved Cases status when the approved step is Surrenderless-owned (or DIY retired). */
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
 *
 * The one exception is the consumer-owned merchant-resolved terminal state: there is no
 * Surrenderless follow-up being tracked and nothing left for Surrenderless to close — the
 * consumer's own report already is the resolution — so OWNED_ENDGAME_HANDLING_TRACKING_STEP's
 * "tracking follow-up and will close this case when resolved" would be actively wrong here, not
 * just DIY-permissive. Checked via the same isMerchantResolvedTerminalAction predicate Hub/
 * Saved Cases use, so no surface can drift on what counts as this terminal state.
 */
export function resolveChatOwnedHandlingTrackingStep(input: {
  suppressOwnedManualUi?: boolean;
  resolutionFlowExposed: boolean;
  manualDerivedStep: string | null;
  next?: Pick<JusticeApprovedNextAction, "href" | "status">;
}): string | null {
  if (!input.manualDerivedStep) return null;
  if (input.next && isMerchantResolvedTerminalAction(input.next)) {
    return HANDLING_TRACKING_STEP_COMPLETE;
  }
  if (input.resolutionFlowExposed) {
    return OWNED_ENDGAME_HANDLING_TRACKING_STEP;
  }
  return ESCALATION_AWAITING_OPERATOR_FULFILLMENT_STEP;
}
