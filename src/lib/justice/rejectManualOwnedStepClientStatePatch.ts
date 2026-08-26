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
import {
  buildMerchantContactDocumentationInputFromIntake,
  validateMerchantContactDocumentation,
} from "@/lib/justice/documentMerchantContact";
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
 * Narrow exception: permits the transition directly from the Surrenderless-owned
 * merchant-contact step to the merchant-resolved terminal action — the reachable path where a
 * consumer approves while already_contacted is "no" (queuing owned merchant contact), then later
 * documents contact with merchant_response_type "resolved" via the merchant-contact
 * documentation form, whose visibility gate does not require any particular approved-action href.
 *
 * A consumer's documented resolution is, and can only ever be, a consumer report — this
 * function does not independently verify it against reality, and neither `intake` nor a
 * previously persisted intake should be described as doing so. What this function DOES enforce,
 * server-side, is that the report is *complete and well-formed* to the same standard the
 * documentation UI itself requires: a valid contact date and proof content appropriate to the
 * declared proof type, via the shared validateMerchantContactDocumentation validator — not just
 * the bare isMerchantResolved(already_contacted/merchant_response_type) check. This closes the
 * gap where an empty/garbage claim (no contact date, no proof) could reach the terminal action
 * merely by setting two enum fields. It applies identically regardless of whether the intake
 * carrying the claim arrived in this same PATCH body or was persisted by an earlier request —
 * the validation re-runs against whatever intake is effective at the moment of THIS transition.
 *
 * Scoped tightly so no other owned step can borrow it:
 * - existingAction.href must be exactly the merchant-contact href (not CFPB, BBB, state AG, etc.)
 * - incomingAction must be exactly the merchant-resolved terminal href with status "completed"
 * - the intake must independently satisfy isMerchantResolved AND pass full documentation
 *   validation (contact date, proof-type-appropriate proof content, and a real uploaded evidence
 *   file when the declared proof type requires one)
 */
export function isAllowedMerchantResolvedTerminalClientStatePatch(
  existingAction: JusticeApprovedNextAction | undefined,
  incomingAction: JusticeApprovedNextAction | undefined,
  intake: JusticeIntake | null | undefined,
  hasUploadedEvidenceFile: boolean
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
  if (!isMerchantResolved(intake)) return false;
  const documentation = buildMerchantContactDocumentationInputFromIntake(intake);
  if (!documentation) return false;
  return validateMerchantContactDocumentation(documentation, hasUploadedEvidenceFile).ok;
}

export type RejectManualOwnedStepClientStatePatchParams = {
  caseId: string;
  existingClientState: unknown;
  incomingClientState: unknown;
  tasks: readonly JusticeCaseTaskRow[];
  filings: readonly ManualActionTrackingFiling[];
  /** Intake for this case, used only by isAllowedMerchantResolvedTerminalClientStatePatch — a
   * consumer-authored report, not independent verification (see that function's docstring). */
  intake?: JusticeIntake | null;
  /** Real uploaded evidence file present on the case, used only by
   * isAllowedMerchantResolvedTerminalClientStatePatch when the declared proof type requires one. */
  hasUploadedEvidenceFile?: boolean;
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

  if (
    isAllowedMerchantResolvedTerminalClientStatePatch(
      existingAction,
      incomingAction,
      params.intake,
      params.hasUploadedEvidenceFile ?? false
    )
  ) {
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
