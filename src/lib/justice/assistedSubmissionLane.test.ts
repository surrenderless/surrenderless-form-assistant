import { describe, expect, it } from "vitest";
import {
  buildMockFtcPracticeSubmissionUrl,
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE,
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
});
