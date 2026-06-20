import { validate as isUuid } from "uuid";
import {
  isRunnableAssistedSubmissionLane,
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
