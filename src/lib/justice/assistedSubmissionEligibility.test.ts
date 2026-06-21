import { describe, expect, it } from "vitest";
import { isAssistedMockSubmissionEligible } from "@/lib/justice/assistedSubmissionEligibility";
import { CHAT_INLINE_FTC_REVIEW_PREP_HREF } from "@/lib/justice/chatInlineApprovedPrep";
import {
  ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
  isRunnableAssistedSubmissionLane,
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE,
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE,
  resolveAssistedSubmissionLaneForApprovedHref,
} from "@/lib/justice/assistedSubmissionLane";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const approvedNextAction: JusticeApprovedNextAction = {
  label: "FTC review",
  href: CHAT_INLINE_FTC_REVIEW_PREP_HREF,
  status: "approved",
};

function eligibleInput(
  overrides: Partial<{
    isLoaded: boolean;
    isSignedIn: boolean;
    caseId: string;
    preparedPacketApproved: boolean;
    approvedNextAction: JusticeApprovedNextAction;
  }> = {}
) {
  return {
    isLoaded: true,
    isSignedIn: true,
    caseId: CASE_ID,
    preparedPacketApproved: true,
    approvedNextAction,
    ...overrides,
  };
}

describe("isAssistedMockSubmissionEligible", () => {
  it("returns true when all gates pass for approved status", () => {
    expect(isAssistedMockSubmissionEligible(eligibleInput())).toBe(true);
  });

  it("returns true for started status", () => {
    expect(
      isAssistedMockSubmissionEligible(
        eligibleInput({
          approvedNextAction: { ...approvedNextAction, status: "started" },
        })
      )
    ).toBe(true);
  });

  it("returns false when not signed in or not loaded", () => {
    expect(isAssistedMockSubmissionEligible(eligibleInput({ isSignedIn: false }))).toBe(false);
    expect(isAssistedMockSubmissionEligible(eligibleInput({ isLoaded: false }))).toBe(false);
  });

  it("returns false for non-UUID case id", () => {
    expect(isAssistedMockSubmissionEligible(eligibleInput({ caseId: "case_local_123" }))).toBe(false);
  });

  it("returns false when packet is not approved", () => {
    expect(isAssistedMockSubmissionEligible(eligibleInput({ preparedPacketApproved: false }))).toBe(
      false
    );
  });

  it("returns false for non-FTC href or completed status", () => {
    expect(
      isAssistedMockSubmissionEligible(
        eligibleInput({
          approvedNextAction: { ...approvedNextAction, href: "/justice/cfpb" },
        })
      )
    ).toBe(false);
    expect(
      isAssistedMockSubmissionEligible(
        eligibleInput({
          approvedNextAction: { ...approvedNextAction, status: "completed" },
        })
      )
    ).toBe(false);
  });

  it("returns true for BBB mock practice lane href when all gates pass", () => {
    expect(
      resolveAssistedSubmissionLaneForApprovedHref(ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF)
    ).toBe(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE);
    expect(isRunnableAssistedSubmissionLane(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE)).toBe(true);
    expect(
      isAssistedMockSubmissionEligible(
        eligibleInput({
          approvedNextAction: {
            label: "BBB practice",
            href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(true);
  });

  it("returns false for BBB mock practice lane when gates fail", () => {
    expect(
      isAssistedMockSubmissionEligible(
        eligibleInput({
          isSignedIn: false,
          approvedNextAction: {
            label: "BBB practice",
            href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(false);
  });
});
