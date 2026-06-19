import { validate as isUuid } from "uuid";
import { CHAT_INLINE_FTC_REVIEW_PREP_HREF } from "@/lib/justice/chatInlineApprovedPrep";
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
    input.approvedNextAction.href?.trim() === CHAT_INLINE_FTC_REVIEW_PREP_HREF &&
    (input.approvedNextAction.status === "approved" ||
      input.approvedNextAction.status === "started")
  );
}
