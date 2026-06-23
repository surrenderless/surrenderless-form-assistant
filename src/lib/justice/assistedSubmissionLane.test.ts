import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_INLINE_BBB_PREP_HREF,
  CHAT_INLINE_CFPB_PREP_HREF,
  CHAT_INLINE_FTC_REVIEW_PREP_HREF,
  CHAT_INLINE_PAYMENT_DISPUTE_PREP_HREF,
  shouldShowChatInlineFtcPracticePrep,
} from "@/lib/justice/chatInlineApprovedPrep";
import { isAssistedMockSubmissionEligible } from "@/lib/justice/assistedSubmissionEligibility";
import {
  MANUAL_ACTION_TRACKING_REAL_BBB_FILING_DESTINATIONS,
  MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import {
  ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
  ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF,
  ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
  buildMockBbbPracticeSubmissionUrl,
  buildMockFtcPracticeSubmissionUrl,
  buildRealBbbComplaintSubmissionUrl,
  isExternalAssistedSubmissionLane,
  isMockAssistedSubmissionLane,
  isRunnableAssistedSubmissionLane,
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE,
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE,
  REAL_BBB_ASSISTED_SUBMISSION_LANE,
  REAL_BBB_COMPLAINT_SUBMISSION_URL,
  resolveAssistedSubmissionFillUrl,
  resolveAssistedSubmissionLaneForApprovedHref,
} from "@/lib/justice/assistedSubmissionLane";
import { isRealBbbComplaintAutofillEnabled } from "@/lib/justice/realBbbAutofillEnabled";
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

  it("defines stable real BBB complaint lane constants", () => {
    expect(REAL_BBB_ASSISTED_SUBMISSION_LANE).toEqual({
      id: "bbb_complaint",
      name: "BBB complaint",
      prepHref: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
      submissionUrl: REAL_BBB_COMPLAINT_SUBMISSION_URL,
      filingDestination: "Better Business Bureau",
      filingConfirmation: "BBB complaint complete",
    });
    expect(ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF).toBe("/justice/bbb");
    expect(ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF).toBe(MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF);
    expect(REAL_BBB_ASSISTED_SUBMISSION_LANE.filingDestination).toBe(
      MANUAL_ACTION_TRACKING_REAL_BBB_FILING_DESTINATIONS[0]
    );
    expect(buildRealBbbComplaintSubmissionUrl()).toBe("https://www.bbb.org/complain/");
  });

  it("builds mock practice submission URL from origin", () => {
    expect(buildMockFtcPracticeSubmissionUrl("https://example.com")).toBe(
      "https://example.com/mock/ftc-complaint"
    );
    expect(buildMockBbbPracticeSubmissionUrl("https://example.com")).toBe(
      "https://example.com/mock/bbb-complaint"
    );
  });

  it("classifies mock vs external assisted submission lanes", () => {
    expect(isMockAssistedSubmissionLane(MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE)).toBe(true);
    expect(isMockAssistedSubmissionLane(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE)).toBe(true);
    expect(isMockAssistedSubmissionLane(REAL_BBB_ASSISTED_SUBMISSION_LANE)).toBe(false);
    expect(isExternalAssistedSubmissionLane(REAL_BBB_ASSISTED_SUBMISSION_LANE)).toBe(true);
    expect(isExternalAssistedSubmissionLane(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE)).toBe(false);
  });

  it("resolves assisted submission fill URLs from lane config", () => {
    expect(resolveAssistedSubmissionFillUrl(MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE, "https://example.com")).toBe(
      "https://example.com/mock/ftc-complaint"
    );
    expect(resolveAssistedSubmissionFillUrl(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE, "https://example.com")).toBe(
      "https://example.com/mock/bbb-complaint"
    );
    expect(resolveAssistedSubmissionFillUrl(REAL_BBB_ASSISTED_SUBMISSION_LANE, "https://example.com")).toBe(
      REAL_BBB_COMPLAINT_SUBMISSION_URL
    );
    expect(buildRealBbbComplaintSubmissionUrl()).toBe(REAL_BBB_COMPLAINT_SUBMISSION_URL);
  });

  it("marks mock FTC and BBB practice lanes always runnable", () => {
    expect(isRunnableAssistedSubmissionLane(MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE)).toBe(true);
    expect(isRunnableAssistedSubmissionLane(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE)).toBe(true);
  });

  it("marks real BBB complaint lane runnable only when autofill env is enabled", () => {
    expect(isRunnableAssistedSubmissionLane(REAL_BBB_ASSISTED_SUBMISSION_LANE)).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "true");
    expect(isRunnableAssistedSubmissionLane(REAL_BBB_ASSISTED_SUBMISSION_LANE)).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "false");
    expect(isRunnableAssistedSubmissionLane(REAL_BBB_ASSISTED_SUBMISSION_LANE)).toBe(false);
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

  it("resolves real BBB prep href to real BBB lane", () => {
    expect(resolveAssistedSubmissionLaneForApprovedHref(ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF)).toBe(
      REAL_BBB_ASSISTED_SUBMISSION_LANE
    );
    expect(
      resolveAssistedSubmissionLaneForApprovedHref(` ${ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF} `)
    ).toBe(REAL_BBB_ASSISTED_SUBMISSION_LANE);
    expect(resolveAssistedSubmissionLaneForApprovedHref(CHAT_INLINE_BBB_PREP_HREF)).toBe(
      REAL_BBB_ASSISTED_SUBMISSION_LANE
    );
  });

  it("keeps real BBB prep ineligible when autofill is disabled", () => {
    expect(isRealBbbComplaintAutofillEnabled()).toBe(false);
    expect(
      isAssistedMockSubmissionEligible({
        isLoaded: true,
        isSignedIn: true,
        caseId: CASE_ID,
        preparedPacketApproved: true,
        approvedNextAction: {
          label: "Better Business Bureau",
          href: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
          status: "approved",
        },
      })
    ).toBe(false);
  });

  it("keeps real BBB prep eligible when autofill is enabled and gates pass", () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "true");
    expect(
      isAssistedMockSubmissionEligible({
        isLoaded: true,
        isSignedIn: true,
        caseId: CASE_ID,
        preparedPacketApproved: true,
        approvedNextAction: {
          label: "Better Business Bureau",
          href: ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
          status: "approved",
        },
      })
    ).toBe(true);
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});
