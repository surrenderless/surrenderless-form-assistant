import { parseApprovedNextActionFromClientState } from "@/lib/justice/approvedNextActionState";
import {
  MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
  MERCHANT_RESOLVED_TERMINAL_HREF,
  type ManualActionTrackingFiling,
} from "@/lib/justice/handlingTrackingProgress";
import { isAllowedOperatorEvidenceTerminalResolutionClientStatePatch } from "@/lib/justice/escalationLadderResolution";
import { isMerchantResolved } from "@/lib/justice/rules";
import { shouldSuppressChatManualActionForSurrenderlessOwnedStep } from "@/lib/justice/surrenderlessOwnedStep";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

const OWNED_HUMAN_FULFILLMENT_HREFS = new Set([
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
]);

export const REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE =
  "This step is owned by Surrenderless operator fulfillment and cannot be started or advanced manually.";

function normalizedHref(action: JusticeApprovedNextAction | undefined): string {
  return action?.href?.trim() ?? "";
}

function normalizedStatus(action: JusticeApprovedNextAction | undefined): string {
  return action?.status?.trim() ?? "";
}

export function isManualOwnedHumanFulfillmentStepProgression(
  existingAction: JusticeApprovedNextAction | undefined,
  incomingAction: JusticeApprovedNextAction | undefined
): boolean {
  if (!existingAction || !incomingAction) return false;

  const existingHref = normalizedHref(existingAction);
  const incomingHref = normalizedHref(incomingAction);
  if (!existingHref || !OWNED_HUMAN_FULFILLMENT_HREFS.has(existingHref)) {
    return false;
  }

  const existingStatus = normalizedStatus(existingAction);
  const incomingStatus = normalizedStatus(incomingAction);

  if (incomingHref !== existingHref) {
    return true;
  }

  if (incomingStatus !== existingStatus) {
    return true;
  }

  return false;
}

/**
 * Narrow exception: permits the verified consumer-owned transition directly from the
 * Surrenderless-owned merchant-contact step to the merchant-resolved terminal action — the
 * reachable path where a consumer approves while already_contacted is "no" (queuing owned
 * merchant contact), then later documents contact with merchant_response_type "resolved" via
 * the merchant-contact documentation form, whose visibility gate does not require any
 * particular approved-action href.
 *
 * Scoped tightly so no other owned step can borrow it:
 * - existingAction.href must be exactly the merchant-contact href (not CFPB, BBB, state AG, etc.)
 * - incomingAction must be exactly the merchant-resolved terminal href with status "completed"
 * - the SERVER's own authoritative intake (never the client's claim) must independently confirm
 *   isMerchantResolved — the same predicate recomputeApprovedNextActionAfterIntake uses to reach
 *   this terminal action in the first place, so this exception can never fire for a spoofed
 *   client_state that a real intake wouldn't itself produce.
 */
export function isAllowedMerchantResolvedTerminalClientStatePatch(
  existingAction: JusticeApprovedNextAction | undefined,
  incomingAction: JusticeApprovedNextAction | undefined,
  intake: JusticeIntake | null | undefined
): boolean {
  if (normalizedHref(existingAction) !== MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF) {
    return false;
  }
  if (normalizedHref(incomingAction) !== MERCHANT_RESOLVED_TERMINAL_HREF) {
    return false;
  }
  if (normalizedStatus(incomingAction) !== "completed") {
    return false;
  }
  if (!intake) return false;
  return isMerchantResolved(intake);
}

export type RejectManualOwnedStepClientStatePatchParams = {
  caseId: string;
  existingClientState: unknown;
  incomingClientState: unknown;
  tasks: readonly JusticeCaseTaskRow[];
  filings: readonly ManualActionTrackingFiling[];
  /** Authoritative intake for this case, used only by isAllowedMerchantResolvedTerminalClientStatePatch. */
  intake?: JusticeIntake | null;
};

export function rejectManualOwnedStepClientStatePatch(
  params: RejectManualOwnedStepClientStatePatchParams
): string | null {
  const existingAction = parseApprovedNextActionFromClientState(params.existingClientState);
  const incomingAction = parseApprovedNextActionFromClientState(params.incomingClientState);

  if (!existingAction) return null;

  if (
    isAllowedOperatorEvidenceTerminalResolutionClientStatePatch({
      caseId: params.caseId,
      existingClientState: params.existingClientState,
      incomingClientState: params.incomingClientState,
      tasks: params.tasks,
      filings: params.filings,
    })
  ) {
    return null;
  }

  if (isAllowedMerchantResolvedTerminalClientStatePatch(existingAction, incomingAction, params.intake)) {
    return null;
  }

  const owned = shouldSuppressChatManualActionForSurrenderlessOwnedStep({
    approvedAction: existingAction,
    caseId: params.caseId,
    tasks: params.tasks,
    filings: params.filings,
  });
  if (!owned) return null;

  if (!isManualOwnedHumanFulfillmentStepProgression(existingAction, incomingAction)) {
    return null;
  }

  return REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE;
}
