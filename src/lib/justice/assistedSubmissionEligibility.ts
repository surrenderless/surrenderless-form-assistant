import { validate as isUuid } from "uuid";
import { resolveAssistedSubmissionLaneForApprovedHref } from "@/lib/justice/assistedSubmissionLane";
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
  return (
    input.isLoaded &&
    input.isSignedIn &&
    isUuid(input.caseId) &&
    input.preparedPacketApproved &&
    resolveAssistedSubmissionLaneForApprovedHref(input.approvedNextAction.href) !== undefined &&
    (input.approvedNextAction.status === "approved" ||
      input.approvedNextAction.status === "started")
  );
}
