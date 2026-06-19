import { describe, expect, it } from "vitest";
import {
  buildLastAssistedSubmissionAttemptFromSubmissionAttempt,
  buildLastAssistedSubmissionAttemptSummaryDisplay,
  mergeClientStateWithLastAssistedSubmissionAttempt,
  parseLastAssistedSubmissionAttempt,
  readLastAssistedSubmissionAttemptFromClientState,
} from "@/lib/justice/submissionAttemptState";
import {
  FTC_PRACTICE_FILING_CONFIRMATION,
  FTC_PRACTICE_FILING_DESTINATION,
  type SubmissionAttemptOutcome,
} from "@/lib/justice/submissionAttempt";

describe("submissionAttemptState", () => {
  it("builds a snapshot from attempt outcome and filing payload refs", () => {
    const attempt: SubmissionAttemptOutcome = {
      kind: "ftc_practice",
      caseId: "00000000-0000-4000-8000-000000000001",
      status: "success",
      attemptedAt: "2026-06-16T12:00:00.000Z",
      filedAt: "2026-06-16T12:00:00.000Z",
      destination: FTC_PRACTICE_FILING_DESTINATION,
      confirmation: FTC_PRACTICE_FILING_CONFIRMATION,
      executionContext: "assisted_after_packet_approval",
      approvedAt: "2026-06-15T10:00:00.000Z",
      notes: "Mock FTC practice autofill completed (/mock/ftc-complaint).",
      artifactUrl: "https://example.com/fallback.png",
    };

    const snapshot = buildLastAssistedSubmissionAttemptFromSubmissionAttempt(attempt, {
      id: "fil-123",
      destination: FTC_PRACTICE_FILING_DESTINATION,
      confirmation_number: FTC_PRACTICE_FILING_CONFIRMATION,
      filing_url: "https://example.com/shot.png",
    });

    expect(snapshot).toEqual({
      kind: "ftc_practice",
      attemptedAt: "2026-06-16T12:00:00.000Z",
      approvedAt: "2026-06-15T10:00:00.000Z",
      executionContext: "assisted_after_packet_approval",
      filingDestination: FTC_PRACTICE_FILING_DESTINATION,
      filingId: "fil-123",
      confirmation: FTC_PRACTICE_FILING_CONFIRMATION,
      artifactUrl: "https://example.com/shot.png",
    });
  });

  it("merges snapshot into client_state without dropping approved next action", () => {
    const merged = mergeClientStateWithLastAssistedSubmissionAttempt(
      {
        prepared_packet_approved: true,
        approved_next_action: {
          label: "FTC review",
          href: "/justice/ftc-review",
          status: "approved",
          approved_at: "2026-06-15T10:00:00.000Z",
        },
      },
      {
        kind: "ftc_practice",
        attemptedAt: "2026-06-16T12:00:00.000Z",
        filingDestination: FTC_PRACTICE_FILING_DESTINATION,
        executionContext: "assisted_after_packet_approval",
      }
    );

    expect(merged.prepared_packet_approved).toBe(true);
    expect(merged.approved_next_action?.label).toBe("FTC review");
    expect(merged.last_assisted_submission_attempt.kind).toBe("ftc_practice");
  });

  it("reads and parses last assisted submission attempt from client_state", () => {
    const snapshot = readLastAssistedSubmissionAttemptFromClientState({
      last_assisted_submission_attempt: {
        kind: "ftc_practice",
        attemptedAt: "2026-06-16T12:00:00.000Z",
        filingDestination: FTC_PRACTICE_FILING_DESTINATION,
        filingId: "fil-123",
      },
    });

    expect(parseLastAssistedSubmissionAttempt(undefined)).toBeUndefined();
    expect(snapshot?.filingId).toBe("fil-123");
  });

  it("builds compact summary display for handling surfaces", () => {
    const display = buildLastAssistedSubmissionAttemptSummaryDisplay({
      kind: "ftc_practice",
      attemptedAt: "2026-06-16T12:00:00.000Z",
      filingDestination: FTC_PRACTICE_FILING_DESTINATION,
      confirmation: FTC_PRACTICE_FILING_CONFIRMATION,
      filingId: "fil-123",
      executionContext: "assisted_after_packet_approval",
    });

    expect(display.destination).toBe(FTC_PRACTICE_FILING_DESTINATION);
    expect(display.attemptedAtLabel).toContain("2026");
    expect(display.confirmation).toBe(FTC_PRACTICE_FILING_CONFIRMATION);
    expect(display.filingId).toBe("fil-123");
    expect(display.executionContextLabel).toBe("Assisted after packet approval");
  });
});
