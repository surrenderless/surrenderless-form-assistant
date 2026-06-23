import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAssistedMockSubmissionEligible,
  isHandlingWorkbenchAssistedMockSubmissionEligible,
} from "@/lib/justice/assistedSubmissionEligibility";
import { CHAT_INLINE_FTC_REVIEW_PREP_HREF } from "@/lib/justice/chatInlineApprovedPrep";
import {
  ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
  ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
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

  it("returns true for real BBB complaint lane href when autofill is enabled and all gates pass", () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "true");
    expect(
      isAssistedMockSubmissionEligible(
        eligibleInput({
          approvedNextAction: {
            label: "Better Business Bureau",
            href: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(true);
  });

  it("returns false for real BBB complaint lane when autofill is disabled", () => {
    expect(
      isAssistedMockSubmissionEligible(
        eligibleInput({
          approvedNextAction: {
            label: "Better Business Bureau",
            href: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(false);
  });

  it("returns false for real BBB complaint lane when gates fail", () => {
    expect(
      isAssistedMockSubmissionEligible(
        eligibleInput({
          isSignedIn: false,
          approvedNextAction: {
            label: "Better Business Bureau",
            href: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
            status: "approved",
          },
        })
      )
    ).toBe(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});

describe("isHandlingWorkbenchAssistedMockSubmissionEligible", () => {
  it("returns true for FTC mock practice lane when all gates pass", () => {
    expect(
      resolveAssistedSubmissionLaneForApprovedHref(approvedNextAction.href)
    ).toBe(MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE);
    expect(isHandlingWorkbenchAssistedMockSubmissionEligible(eligibleInput())).toBe(true);
  });

  it("returns false for BBB mock practice lane even when chat eligibility passes", () => {
    const bbbInput = eligibleInput({
      approvedNextAction: {
        label: "BBB practice",
        href: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
        status: "approved",
      },
    });
    expect(isAssistedMockSubmissionEligible(bbbInput)).toBe(true);
    expect(isHandlingWorkbenchAssistedMockSubmissionEligible(bbbInput)).toBe(false);
  });

  it("returns false when shared gates fail", () => {
    expect(
      isHandlingWorkbenchAssistedMockSubmissionEligible(eligibleInput({ isSignedIn: false }))
    ).toBe(false);
    expect(
      isHandlingWorkbenchAssistedMockSubmissionEligible(
        eligibleInput({ approvedNextAction: { ...approvedNextAction, href: "/justice/cfpb" } })
      )
    ).toBe(false);
    expect(
      isHandlingWorkbenchAssistedMockSubmissionEligible(
        eligibleInput({
          approvedNextAction: { ...approvedNextAction, status: "completed" },
        })
      )
    ).toBe(false);
  });
});
