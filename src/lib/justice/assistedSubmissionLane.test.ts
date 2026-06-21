import { describe, expect, it } from "vitest";
import {
  CHAT_INLINE_CFPB_PREP_HREF,
  CHAT_INLINE_FTC_REVIEW_PREP_HREF,
  CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF,
  shouldShowChatInlineFtcPracticePrep,
} from "@/lib/justice/chatInlineApprovedPrep";
import { isAssistedMockSubmissionEligible } from "@/lib/justice/assistedSubmissionEligibility";
import {
  ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
  ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF,
  buildMockBbbPracticeSubmissionUrl,
  buildMockFtcPracticeSubmissionUrl,
  isRunnableAssistedSubmissionLane,
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE,
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE,
  resolveAssistedSubmissionLaneForApprovedHref,
} from "@/lib/justice/assistedSubmissionLane";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const ftcApprovedNextAction: JusticeApprovedNextAction = {
  label: "FTC review",
  href: ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF,
  status: "approved",
};

describe("assistedSubmissionLane", () => {
  it("defines stable mock FTC practice lane constants", () => {
    expect(MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE).toEqual({
      id: "ftc_practice",
      name: "FTC mock practice",
      mockUrlPath: "/mock/ftc-complaint",
      filingDestination: "FTC (practice)",
      filingConfirmation: "FTC mock practice complete",
    });
  });

  it("defines stable mock BBB practice lane constants", () => {
    expect(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE).toEqual({
      id: "bbb_practice",
      name: "BBB mock practice",
      mockUrlPath: "/mock/bbb-complaint",
      filingDestination: "BBB (practice)",
      filingConfirmation: "BBB mock practice complete",
    });
  });

  it("builds mock practice submission URL from origin", () => {
    expect(buildMockFtcPracticeSubmissionUrl("https://example.com")).toBe(
      "https://example.com/mock/ftc-complaint"
    );
    expect(buildMockBbbPracticeSubmissionUrl("https://example.com")).toBe(
      "https://example.com/mock/bbb-complaint"
    );
  });

  it("marks mock FTC and BBB practice lanes runnable", () => {
    expect(isRunnableAssistedSubmissionLane(MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE)).toBe(true);
    expect(isRunnableAssistedSubmissionLane(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE)).toBe(true);
  });

  it("resolves FTC review href to mock FTC lane", () => {
    expect(
      resolveAssistedSubmissionLaneForApprovedHref(ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF)
    ).toBe(MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE);
    expect(
      resolveAssistedSubmissionLaneForApprovedHref(
        ` ${ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF} `
      )
    ).toBe(MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE);
    expect(resolveAssistedSubmissionLaneForApprovedHref(CHAT_INLINE_FTC_REVIEW_PREP_HREF)).toBe(
      MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE
    );
  });

  it("resolves reserved BBB mock practice href to mock BBB lane", () => {
    expect(
      resolveAssistedSubmissionLaneForApprovedHref(ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF)
    ).toBe(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE);
    expect(
      resolveAssistedSubmissionLaneForApprovedHref(
        ` ${ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF} `
      )
    ).toBe(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE);
  });

  it("returns undefined for unknown or empty href", () => {
    expect(resolveAssistedSubmissionLaneForApprovedHref("/justice/cfpb")).toBeUndefined();
    expect(resolveAssistedSubmissionLaneForApprovedHref(CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF)).toBeUndefined();
    expect(resolveAssistedSubmissionLaneForApprovedHref("")).toBeUndefined();
    expect(resolveAssistedSubmissionLaneForApprovedHref(undefined)).toBeUndefined();
  });

  it("keeps FTC assisted eligibility and chat practice prep unchanged", () => {
    expect(
      isAssistedMockSubmissionEligible({
        isLoaded: true,
        isSignedIn: true,
        caseId: CASE_ID,
        preparedPacketApproved: true,
        approvedNextAction: ftcApprovedNextAction,
      })
    ).toBe(true);
    expect(
      shouldShowChatInlineFtcPracticePrep({
        isUpdatingExistingCase: true,
        caseId: CASE_ID,
        isLoaded: true,
        isSignedIn: true,
        preparedPacketApproved: true,
        approvedNextAction: ftcApprovedNextAction,
      })
    ).toBe(true);
    expect(
      isAssistedMockSubmissionEligible({
        isLoaded: true,
        isSignedIn: true,
        caseId: CASE_ID,
        preparedPacketApproved: true,
        approvedNextAction: {
          label: "CFPB",
          href: CHAT_INLINE_CFPB_PREP_HREF,
          status: "approved",
        },
      })
    ).toBe(false);
    expect(
      shouldShowChatInlineFtcPracticePrep({
        isUpdatingExistingCase: true,
        caseId: CASE_ID,
        isLoaded: true,
        isSignedIn: true,
        preparedPacketApproved: true,
        approvedNextAction: {
          label: "CFPB",
          href: CHAT_INLINE_CFPB_PREP_HREF,
          status: "approved",
        },
      })
    ).toBe(false);
  });
});
