import { describe, expect, it } from "vitest";
import {
  deriveHandlingClosureStepAfterFilingConfirmation,
  isApprovedActionOpenedForHandlingTracking,
} from "@/lib/justice/handlingTrackingProgress";
import {
  HANDLING_TRACKING_STEP_MARK_ACKNOWLEDGED,
  HANDLING_TRACKING_STEP_RECORD_OUTCOME,
} from "@/lib/justice/approvedNextActionHandlingDisplay";

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
