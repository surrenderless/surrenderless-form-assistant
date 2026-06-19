import { describe, expect, it } from "vitest";
import {
  buildFilingBodyFromAttempt,
  FTC_PRACTICE_FILING_CONFIRMATION,
  FTC_PRACTICE_FILING_DESTINATION,
  type SubmissionAttemptOutcome,
} from "@/lib/justice/submissionAttempt";

describe("buildFilingBodyFromAttempt", () => {
  it("maps a successful attempt to a filings POST body", () => {
    const outcome: SubmissionAttemptOutcome = {
      kind: "ftc_practice",
      caseId: "00000000-0000-4000-8000-000000000001",
      status: "success",
      attemptedAt: "2026-06-16T12:00:00.000Z",
      filedAt: "2026-06-16T12:00:00.000Z",
      destination: FTC_PRACTICE_FILING_DESTINATION,
      confirmation: FTC_PRACTICE_FILING_CONFIRMATION,
      notes: "Mock FTC practice autofill completed (/mock/ftc-complaint).",
      artifactUrl: "https://example.com/shot.png",
    };

    expect(buildFilingBodyFromAttempt(outcome)).toEqual({
      destination: FTC_PRACTICE_FILING_DESTINATION,
      filed_at: "2026-06-16T12:00:00.000Z",
      confirmation_number: FTC_PRACTICE_FILING_CONFIRMATION,
      notes: "Mock FTC practice autofill completed (/mock/ftc-complaint).",
      filing_url: "https://example.com/shot.png",
    });
  });

  it("returns null for failed attempts", () => {
    const outcome: SubmissionAttemptOutcome = {
      kind: "ftc_practice",
      caseId: "00000000-0000-4000-8000-000000000001",
      status: "failed",
      attemptedAt: "2026-06-16T12:00:00.000Z",
      destination: FTC_PRACTICE_FILING_DESTINATION,
    };

    expect(buildFilingBodyFromAttempt(outcome)).toBeNull();
  });
});
