import { describe, expect, it } from "vitest";
import { CHAT_INLINE_FTC_REVIEW_PREP_HREF } from "@/lib/justice/chatInlineApprovedPrep";
import {
  buildMockFtcPracticeSubmissionUrl,
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE,
  resolveAssistedSubmissionLaneForApprovedHref,
} from "@/lib/justice/assistedSubmissionLane";

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

  it("builds mock practice submission URL from origin", () => {
    expect(buildMockFtcPracticeSubmissionUrl("https://example.com")).toBe(
      "https://example.com/mock/ftc-complaint"
    );
  });

  it("resolves FTC review href to mock lane", () => {
    expect(resolveAssistedSubmissionLaneForApprovedHref(CHAT_INLINE_FTC_REVIEW_PREP_HREF)).toBe(
      MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE
    );
    expect(resolveAssistedSubmissionLaneForApprovedHref(` ${CHAT_INLINE_FTC_REVIEW_PREP_HREF} `)).toBe(
      MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE
    );
  });

  it("returns undefined for unknown or empty href", () => {
    expect(resolveAssistedSubmissionLaneForApprovedHref("/justice/cfpb")).toBeUndefined();
    expect(resolveAssistedSubmissionLaneForApprovedHref("")).toBeUndefined();
    expect(resolveAssistedSubmissionLaneForApprovedHref(undefined)).toBeUndefined();
  });
});
