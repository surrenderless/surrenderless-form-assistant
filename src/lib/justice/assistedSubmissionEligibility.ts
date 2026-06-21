import { validate as isUuid } from "uuid";
import {
  isRunnableAssistedSubmissionLane,
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE,
  resolveAssistedSubmissionLaneForApprovedHref,
} from "@/lib/justice/assistedSubmissionLane";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

export type AssistedMockSubmissionEligibilityInput = {
  isLoaded: boolean;
  isSignedIn: boolean;
  caseId: string;
  preparedPacketApproved: boolean;
  approvedNextAction: JusticeApprovedNextAction;
};

/** Same gates as handling/chat assisted mock submission trigger. */
export function isAssistedMockSubmissionEligible(
  input: AssistedMockSubmissionEligibilityInput
): boolean {
  const lane = resolveAssistedSubmissionLaneForApprovedHref(input.approvedNextAction.href);
  return (
    input.isLoaded &&
    input.isSignedIn &&
    isUuid(input.caseId) &&
    input.preparedPacketApproved &&
    lane !== undefined &&
    isRunnableAssistedSubmissionLane(lane) &&
    (input.approvedNextAction.status === "approved" ||
      input.approvedNextAction.status === "started")
  );
}

/** Handling workbench: FTC mock practice lane only — BBB practice runs in chat-ai. */
export function isHandlingWorkbenchAssistedMockSubmissionEligible(
  input: AssistedMockSubmissionEligibilityInput
): boolean {
  const lane = resolveAssistedSubmissionLaneForApprovedHref(input.approvedNextAction.href);
  if (lane?.id !== MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.id) {
    return false;
  }
  return isAssistedMockSubmissionEligible(input);
}
