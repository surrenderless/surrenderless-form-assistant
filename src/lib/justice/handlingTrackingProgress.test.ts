import { describe, expect, it } from "vitest";
import {
  chatOutcomeTrackingFormOpen,
  chatOutcomeTrackingSaveAllowed,
  deriveHandlingClosureStepAfterFilingConfirmation,
  deriveManualActionTrackingFilingsState,
  filingsForManualActionTracking,
  isApprovedActionOpenedForHandlingTracking,
  isAssistedMockPracticeFilingDestination,
} from "@/lib/justice/handlingTrackingProgress";
import {
  HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED,
  HANDLING_TRACKING_STEP_RECORD_OUTCOME,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  BBB_PRACTICE_FILING_CONFIRMATION,
  BBB_PRACTICE_FILING_DESTINATION,
  FTC_PRACTICE_FILING_CONFIRMATION,
  FTC_PRACTICE_FILING_DESTINATION,
} from "@/lib/justice/submissionAttempt";

describe("isApprovedActionOpenedForHandlingTracking", () => {
  it("returns true when status is started or completed", () => {
    expect(isApprovedActionOpenedForHandlingTracking({ status: "started" })).toBe(true);
    expect(isApprovedActionOpenedForHandlingTracking({ status: "completed" })).toBe(true);
  });

  it("returns true when handling was requested even if status is still approved", () => {
    expect(
      isApprovedActionOpenedForHandlingTracking({
        status: "approved",
        handling_requested_at: "2026-06-16T12:00:00.000Z",
      })
    ).toBe(true);
  });

  it("returns false when status is approved and handling was not requested", () => {
    expect(isApprovedActionOpenedForHandlingTracking({ status: "approved" })).toBe(false);
    expect(
      isApprovedActionOpenedForHandlingTracking({
        status: "approved",
        handling_requested_at: "   ",
      })
    ).toBe(false);
  });
});

describe("deriveHandlingClosureStepAfterFilingConfirmation", () => {
  it("requires outcome for handling-requested cases even when status is approved", () => {
    expect(
      deriveHandlingClosureStepAfterFilingConfirmation({
        status: "approved",
        handlingRequestedAt: "2026-06-16T12:00:00.000Z",
      })
    ).toBe(HANDLING_TRACKING_STEP_RECORD_OUTCOME);
  });

  it("requires acknowledgement after outcome for handling-requested cases", () => {
    expect(
      deriveHandlingClosureStepAfterFilingConfirmation({
        status: "approved",
        handlingRequestedAt: "2026-06-16T12:00:00.000Z",
        outcomeNote: "Filed with BBB confirmation on file.",
      })
    ).toBe(HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED);
  });

  it("returns null when handling-requested closure fields are satisfied", () => {
    expect(
      deriveHandlingClosureStepAfterFilingConfirmation({
        status: "approved",
        handlingRequestedAt: "2026-06-16T12:00:00.000Z",
        outcomeNote: "Filed with BBB confirmation on file.",
        handlingAcknowledgedAt: "2026-06-16T13:00:00.000Z",
      })
    ).toBeNull();
  });

  it("preserves completed-status outcome requirement without handling request", () => {
    expect(
      deriveHandlingClosureStepAfterFilingConfirmation({
        status: "completed",
      })
    ).toBe(HANDLING_TRACKING_STEP_RECORD_OUTCOME);
    expect(
      deriveHandlingClosureStepAfterFilingConfirmation({
        status: "completed",
        outcomeNote: "Resolved for now.",
      })
    ).toBeNull();
  });

  it("preserves completed plus handling-request acknowledgement requirement", () => {
    expect(
      deriveHandlingClosureStepAfterFilingConfirmation({
        status: "completed",
        handlingRequestedAt: "2026-06-16T12:00:00.000Z",
        outcomeNote: "Resolved for now.",
      })
    ).toBe(HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED);
  });
});

describe("chatOutcomeTrackingFormOpen", () => {
  it("opens when outcome is missing or follow-up is still needed", () => {
    expect(chatOutcomeTrackingFormOpen({})).toBe(true);
    expect(chatOutcomeTrackingFormOpen({ outcome_note: "Resolved." })).toBe(false);
    expect(
      chatOutcomeTrackingFormOpen({ outcome_note: "Resolved.", follow_up_needed: true })
    ).toBe(true);
  });
});

describe("deriveManualActionTrackingFilingsState", () => {
  const ftcPracticeFiling = {
    destination: FTC_PRACTICE_FILING_DESTINATION,
    confirmation_number: FTC_PRACTICE_FILING_CONFIRMATION,
  };
  const bbbPracticeFiling = {
    destination: BBB_PRACTICE_FILING_DESTINATION,
    confirmation_number: BBB_PRACTICE_FILING_CONFIRMATION,
  };
  const realBbbFiling = {
    destination: "Better Business Bureau",
    confirmation_number: null,
  };
  const realBbbFilingConfirmed = {
    destination: "Better Business Bureau",
    confirmation_number: "BBB-REAL-123",
  };

  it("does not treat FTC practice filing alone as manual filing or confirmation", () => {
    expect(deriveManualActionTrackingFilingsState([ftcPracticeFiling])).toEqual({
      hasFilingRecord: false,
      hasConfirmationOnFile: false,
    });
  });

  it("does not treat BBB practice filing alone as manual filing or confirmation", () => {
    expect(deriveManualActionTrackingFilingsState([bbbPracticeFiling])).toEqual({
      hasFilingRecord: false,
      hasConfirmationOnFile: false,
    });
  });

  it("does not treat both practice filings together as manual filing or confirmation", () => {
    expect(deriveManualActionTrackingFilingsState([ftcPracticeFiling, bbbPracticeFiling])).toEqual(
      {
        hasFilingRecord: false,
        hasConfirmationOnFile: false,
      }
    );
  });

  it("treats a real BBB filing as satisfying the filing gate", () => {
    expect(deriveManualActionTrackingFilingsState([realBbbFiling])).toEqual({
      hasFilingRecord: true,
      hasConfirmationOnFile: false,
    });
  });

  it("treats a real BBB confirmation as satisfying the confirmation gate", () => {
    expect(deriveManualActionTrackingFilingsState([realBbbFilingConfirmed])).toEqual({
      hasFilingRecord: true,
      hasConfirmationOnFile: true,
    });
  });

  it("uses the real filing when practice and real filings are mixed", () => {
    expect(
      deriveManualActionTrackingFilingsState([
        ftcPracticeFiling,
        bbbPracticeFiling,
        realBbbFiling,
      ])
    ).toEqual({
      hasFilingRecord: true,
      hasConfirmationOnFile: false,
    });
    expect(
      deriveManualActionTrackingFilingsState([
        ftcPracticeFiling,
        bbbPracticeFiling,
        realBbbFilingConfirmed,
      ])
    ).toEqual({
      hasFilingRecord: true,
      hasConfirmationOnFile: true,
    });
  });

  it("preserves all filings in history while filtering only tracking gates", () => {
    const mixed = [ftcPracticeFiling, bbbPracticeFiling, realBbbFilingConfirmed];
    expect(filingsForManualActionTracking(mixed)).toEqual([realBbbFilingConfirmed]);
    expect(mixed).toHaveLength(3);
  });
});

describe("isAssistedMockPracticeFilingDestination", () => {
  it("matches only assisted mock-practice filing destinations", () => {
    expect(isAssistedMockPracticeFilingDestination(FTC_PRACTICE_FILING_DESTINATION)).toBe(true);
    expect(isAssistedMockPracticeFilingDestination(BBB_PRACTICE_FILING_DESTINATION)).toBe(true);
    expect(isAssistedMockPracticeFilingDestination("Better Business Bureau")).toBe(false);
    expect(isAssistedMockPracticeFilingDestination("CFPB")).toBe(false);
  });
});

describe("chatOutcomeTrackingSaveAllowed", () => {
  it("allows save for completed actions", () => {
    expect(chatOutcomeTrackingSaveAllowed({ status: "completed" })).toBe(true);
  });

  it("allows save for handling-requested approved actions", () => {
    expect(
      chatOutcomeTrackingSaveAllowed({
        status: "approved",
        handling_requested_at: "2026-06-16T12:00:00.000Z",
      })
    ).toBe(true);
  });

  it("blocks save for approved actions without handling request", () => {
    expect(chatOutcomeTrackingSaveAllowed({ status: "approved" })).toBe(false);
    expect(chatOutcomeTrackingSaveAllowed({ status: "started" })).toBe(false);
  });
});
