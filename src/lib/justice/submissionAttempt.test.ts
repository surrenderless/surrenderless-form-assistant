import { describe, expect, it } from "vitest";
import {
  BBB_PRACTICE_FILING_CONFIRMATION,
  BBB_PRACTICE_FILING_DESTINATION,
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

  it("prepends assisted approval context to filing notes when present", () => {
    const outcome: SubmissionAttemptOutcome = {
      kind: "ftc_practice",
      caseId: "00000000-0000-4000-8000-000000000001",
      status: "success",
      attemptedAt: "2026-06-16T12:00:00.000Z",
      filedAt: "2026-06-16T12:00:00.000Z",
      destination: FTC_PRACTICE_FILING_DESTINATION,
      executionContext: "assisted_after_packet_approval",
      approvedAt: "2026-06-15T10:00:00.000Z",
      notes: "Mock FTC practice autofill completed (/mock/ftc-complaint).",
    };

    expect(buildFilingBodyFromAttempt(outcome)?.notes).toBe(
      "Assisted submission after packet approval (approved 2026-06-15T10:00:00.000Z). Mock FTC practice autofill completed (/mock/ftc-complaint)."
    );
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

  it("maps a successful BBB practice attempt to a filings POST body", () => {
    const outcome: SubmissionAttemptOutcome = {
      kind: "bbb_practice",
      caseId: "00000000-0000-4000-8000-000000000001",
      status: "success",
      attemptedAt: "2026-06-16T12:00:00.000Z",
      filedAt: "2026-06-16T12:00:00.000Z",
      destination: BBB_PRACTICE_FILING_DESTINATION,
      confirmation: BBB_PRACTICE_FILING_CONFIRMATION,
      notes: "Mock BBB practice autofill completed (/mock/bbb-complaint).",
      artifactUrl: "https://example.com/bbb-shot.png",
    };

    expect(buildFilingBodyFromAttempt(outcome)).toEqual({
      destination: BBB_PRACTICE_FILING_DESTINATION,
      filed_at: "2026-06-16T12:00:00.000Z",
      confirmation_number: BBB_PRACTICE_FILING_CONFIRMATION,
      notes: "Mock BBB practice autofill completed (/mock/bbb-complaint).",
      filing_url: "https://example.com/bbb-shot.png",
    });
  });
});
