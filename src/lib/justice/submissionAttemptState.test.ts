import { describe, expect, it } from "vitest";
import {
  MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE,
  MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE,
} from "@/lib/justice/assistedSubmissionLane";
import {
  ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
  ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF,
  ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF,
  REAL_BBB_COMPLAINT_FILING_DESTINATION,
} from "@/lib/justice/assistedSubmissionLane";
import {
  buildFailedLastAssistedSubmissionAttemptSnapshot,
  buildLastAssistedSubmissionAttemptFromSubmissionAttempt,
  buildLastAssistedSubmissionAttemptSummaryDisplay,
  isLastAssistedSubmissionAttemptVisibleForApprovedHref,
  mergeClientStateWithLastAssistedSubmissionAttempt,
  parseLastAssistedSubmissionAttempt,
  readLastAssistedSubmissionAttemptFromClientState,
} from "@/lib/justice/submissionAttemptState";
import {
  BBB_PRACTICE_FILING_CONFIRMATION,
  BBB_PRACTICE_FILING_DESTINATION,
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
    expect(display.isFailed).toBe(false);
    expect(display.outcomeLabel).toBeUndefined();
  });

  it("builds failed summary display with retry-needed label", () => {
    const display = buildLastAssistedSubmissionAttemptSummaryDisplay({
      kind: "ftc_practice",
      attemptedAt: "2026-06-16T12:00:00.000Z",
      filingDestination: FTC_PRACTICE_FILING_DESTINATION,
      outcome: "failed",
      error: "Request failed",
      executionContext: "assisted_after_packet_approval",
    });

    expect(display.isFailed).toBe(true);
    expect(display.outcomeLabel).toBe("Failed — retry needed");
    expect(display.error).toBe("Request failed");
  });

  it("parses failed attempt outcome and error from client_state", () => {
    const snapshot = readLastAssistedSubmissionAttemptFromClientState({
      last_assisted_submission_attempt: {
        kind: "ftc_practice",
        attemptedAt: "2026-06-16T12:00:00.000Z",
        filingDestination: FTC_PRACTICE_FILING_DESTINATION,
        outcome: "failed",
        error: "Request failed",
      },
    });

    expect(snapshot?.outcome).toBe("failed");
    expect(snapshot?.error).toBe("Request failed");
  });

  it("builds failed snapshot with lane id and filing destination", () => {
    const snapshot = buildFailedLastAssistedSubmissionAttemptSnapshot({
      attemptedAt: "2026-06-16T12:00:00.000Z",
      error: "Request failed",
      approvedAt: "2026-06-15T10:00:00.000Z",
      executionContext: "assisted_after_packet_approval",
    });

    expect(snapshot.kind).toBe(MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.id);
    expect(snapshot.filingDestination).toBe(
      MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.filingDestination
    );
    expect(snapshot.outcome).toBe("failed");
    expect(snapshot.error).toBe("Request failed");
  });

  it("parses failed snapshot built from lane config", () => {
    const built = buildFailedLastAssistedSubmissionAttemptSnapshot({
      attemptedAt: "2026-06-16T12:00:00.000Z",
      error: "Request failed",
    });

    const parsed = parseLastAssistedSubmissionAttempt(built);

    expect(parsed).toEqual(built);
  });

  it("rejects snapshots with a non-lane kind", () => {
    expect(
      parseLastAssistedSubmissionAttempt({
        kind: "other_lane",
        attemptedAt: "2026-06-16T12:00:00.000Z",
        filingDestination: MOCK_FTC_PRACTICE_ASSISTED_SUBMISSION_LANE.filingDestination,
        outcome: "failed",
        error: "Request failed",
      })
    ).toBeUndefined();
  });

  it("parses a valid BBB practice snapshot from client_state", () => {
    const snapshot = readLastAssistedSubmissionAttemptFromClientState({
      last_assisted_submission_attempt: {
        kind: "bbb_practice",
        attemptedAt: "2026-06-16T12:00:00.000Z",
        filingDestination: BBB_PRACTICE_FILING_DESTINATION,
        filingId: "fil-bbb-123",
        confirmation: BBB_PRACTICE_FILING_CONFIRMATION,
        executionContext: "assisted_after_packet_approval",
        approvedAt: "2026-06-15T10:00:00.000Z",
      },
    });

    expect(snapshot).toEqual({
      kind: "bbb_practice",
      attemptedAt: "2026-06-16T12:00:00.000Z",
      filingDestination: BBB_PRACTICE_FILING_DESTINATION,
      filingId: "fil-bbb-123",
      confirmation: BBB_PRACTICE_FILING_CONFIRMATION,
      executionContext: "assisted_after_packet_approval",
      approvedAt: "2026-06-15T10:00:00.000Z",
    });
    expect(snapshot?.kind).toBe(MOCK_BBB_PRACTICE_ASSISTED_SUBMISSION_LANE.id);
  });

  it("rejects malformed BBB practice snapshots", () => {
    expect(
      parseLastAssistedSubmissionAttempt({
        kind: "bbb_practice",
        attemptedAt: "",
        filingDestination: BBB_PRACTICE_FILING_DESTINATION,
      })
    ).toBeUndefined();
    expect(
      parseLastAssistedSubmissionAttempt({
        kind: "bbb_practice",
        attemptedAt: "2026-06-16T12:00:00.000Z",
        filingDestination: "",
      })
    ).toBeUndefined();
    expect(parseLastAssistedSubmissionAttempt(null)).toBeUndefined();
  });

  it("rejects unsupported assisted submission attempt kinds", () => {
    expect(
      parseLastAssistedSubmissionAttempt({
        kind: "cfpb_practice",
        attemptedAt: "2026-06-16T12:00:00.000Z",
        filingDestination: "CFPB (practice)",
      })
    ).toBeUndefined();
  });

  describe("isLastAssistedSubmissionAttemptVisibleForApprovedHref", () => {
    const ftcSnapshot = {
      kind: "ftc_practice" as const,
      attemptedAt: "2026-06-16T12:00:00.000Z",
      filingDestination: FTC_PRACTICE_FILING_DESTINATION,
    };
    const bbbSnapshot = {
      kind: "bbb_practice" as const,
      attemptedAt: "2026-06-16T12:00:00.000Z",
      filingDestination: BBB_PRACTICE_FILING_DESTINATION,
    };
    const realBbbSnapshot = {
      kind: "bbb_complaint" as const,
      attemptedAt: "2026-06-16T12:00:00.000Z",
      filingDestination: REAL_BBB_COMPLAINT_FILING_DESTINATION,
    };

    it("shows FTC snapshot on FTC practice href", () => {
      expect(
        isLastAssistedSubmissionAttemptVisibleForApprovedHref(
          ftcSnapshot,
          ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF
        )
      ).toBe(true);
    });

    it("shows BBB snapshot on BBB practice href", () => {
      expect(
        isLastAssistedSubmissionAttemptVisibleForApprovedHref(
          bbbSnapshot,
          ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF
        )
      ).toBe(true);
    });

    it("hides FTC snapshot on BBB practice href", () => {
      expect(
        isLastAssistedSubmissionAttemptVisibleForApprovedHref(
          ftcSnapshot,
          ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF
        )
      ).toBe(false);
    });

    it("hides BBB snapshot on FTC practice href", () => {
      expect(
        isLastAssistedSubmissionAttemptVisibleForApprovedHref(
          bbbSnapshot,
          ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF
        )
      ).toBe(false);
    });

    it("hides mock BBB practice snapshot on real BBB complaint href", () => {
      expect(
        isLastAssistedSubmissionAttemptVisibleForApprovedHref(
          bbbSnapshot,
          ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF
        )
      ).toBe(false);
      expect(
        isLastAssistedSubmissionAttemptVisibleForApprovedHref(
          ftcSnapshot,
          ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF
        )
      ).toBe(false);
    });

    it("shows real BBB complaint snapshot on real BBB complaint href", () => {
      expect(
        isLastAssistedSubmissionAttemptVisibleForApprovedHref(
          realBbbSnapshot,
          ASSISTED_SUBMISSION_REAL_BBB_PREP_HREF
        )
      ).toBe(true);
      expect(
        isLastAssistedSubmissionAttemptVisibleForApprovedHref(
          realBbbSnapshot,
          ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF
        )
      ).toBe(false);
    });

    it("parses real BBB complaint assisted submission snapshots", () => {
      expect(
        parseLastAssistedSubmissionAttempt({
          kind: "bbb_complaint",
          attemptedAt: "2026-06-16T12:00:00.000Z",
          filingDestination: REAL_BBB_COMPLAINT_FILING_DESTINATION,
        })
      ).toEqual({
        kind: "bbb_complaint",
        attemptedAt: "2026-06-16T12:00:00.000Z",
        filingDestination: REAL_BBB_COMPLAINT_FILING_DESTINATION,
      });
    });

    it("hides when snapshot or active assisted lane is missing", () => {
      expect(
        isLastAssistedSubmissionAttemptVisibleForApprovedHref(
          null,
          ASSISTED_SUBMISSION_FTC_MOCK_PRACTICE_PREP_HREF
        )
      ).toBe(false);
      expect(
        isLastAssistedSubmissionAttemptVisibleForApprovedHref(
          undefined,
          ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF
        )
      ).toBe(false);
      expect(isLastAssistedSubmissionAttemptVisibleForApprovedHref(ftcSnapshot, undefined)).toBe(
        false
      );
      expect(isLastAssistedSubmissionAttemptVisibleForApprovedHref(bbbSnapshot, "")).toBe(false);
    });
  });
});
