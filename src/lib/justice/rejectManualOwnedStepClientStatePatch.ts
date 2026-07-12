import { parseApprovedNextActionFromClientState } from "@/lib/justice/approvedNextActionState";
import {
  MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
  type ManualActionTrackingFiling,
} from "@/lib/justice/handlingTrackingProgress";
import { isAllowedOperatorEvidenceTerminalResolutionClientStatePatch } from "@/lib/justice/escalationLadderResolution";
import { shouldSuppressChatManualActionForSurrenderlessOwnedStep } from "@/lib/justice/surrenderlessOwnedStep";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

const OWNED_HUMAN_FULFILLMENT_HREFS = new Set([
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
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

export type RejectManualOwnedStepClientStatePatchParams = {
  caseId: string;
  existingClientState: unknown;
  incomingClientState: unknown;
  tasks: readonly JusticeCaseTaskRow[];
  filings: readonly ManualActionTrackingFiling[];
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
