import { describe, expect, it } from "vitest";
import {
  buildHandlingRequestTaskNotes,
  buildHandlingRequestTaskTitle,
  handlingRequestTaskCompletedTimelineId,
  handlingRequestTaskNotesMarker,
  isFirstFilingConfirmationTransition,
  taskNotesMatchHandlingRequestMarker,
} from "@/lib/justice/handlingRequestTask";
import { handlingRequestTimelineEntryId } from "@/lib/justice/handlingRequestTimeline";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("handlingRequestTaskNotesMarker", () => {
  it("matches the handling-request timeline entry id", () => {
    expect(handlingRequestTaskNotesMarker(CASE_ID)).toBe(handlingRequestTimelineEntryId(CASE_ID));
    expect(handlingRequestTaskNotesMarker(CASE_ID)).toBe(`handling_request:${CASE_ID}`);
  });
});

describe("buildHandlingRequestTaskTitle", () => {
  it("uses the approved action label in the title", () => {
    expect(buildHandlingRequestTaskTitle({ label: "File BBB complaint" })).toBe(
      "Surrenderless handling: File BBB complaint"
    );
  });

  it("falls back when label is missing", () => {
    expect(buildHandlingRequestTaskTitle({})).toBe("Surrenderless handling: Approved next action");
  });
});

describe("buildHandlingRequestTaskNotes", () => {
  it("includes stable marker and optional handling request note", () => {
    expect(buildHandlingRequestTaskNotes(CASE_ID, { handling_request_note: "Please prioritize" })).toBe(
      `handling_request:${CASE_ID}\nPlease prioritize`
    );
  });

  it("uses marker only when request note is absent", () => {
    expect(buildHandlingRequestTaskNotes(CASE_ID, { label: "File BBB complaint" })).toBe(
      `handling_request:${CASE_ID}`
    );
  });
});

describe("taskNotesMatchHandlingRequestMarker", () => {
  it("matches marker-only and marker-plus-note notes", () => {
    expect(taskNotesMatchHandlingRequestMarker(`handling_request:${CASE_ID}`, CASE_ID)).toBe(true);
    expect(
      taskNotesMatchHandlingRequestMarker(`handling_request:${CASE_ID}\nPlease prioritize`, CASE_ID)
    ).toBe(true);
  });

  it("does not match unrelated notes", () => {
    expect(taskNotesMatchHandlingRequestMarker("Follow up with merchant", CASE_ID)).toBe(false);
  });
});

describe("isFirstFilingConfirmationTransition", () => {
  it("returns true when confirmation_number transitions from empty to present", () => {
    expect(isFirstFilingConfirmationTransition(null, "BBB-123")).toBe(true);
    expect(isFirstFilingConfirmationTransition("", "BBB-123")).toBe(true);
    expect(isFirstFilingConfirmationTransition("   ", "BBB-123")).toBe(true);
  });

  it("returns false when confirmation was already present or remains empty", () => {
    expect(isFirstFilingConfirmationTransition("BBB-123", "BBB-456")).toBe(false);
    expect(isFirstFilingConfirmationTransition(null, null)).toBe(false);
    expect(isFirstFilingConfirmationTransition("BBB-123", "")).toBe(false);
  });
});

describe("handlingRequestTaskCompletedTimelineId", () => {
  it("uses a stable idempotent id per task", () => {
    const taskId = "660e8400-e29b-41d4-a716-446655440001";
    expect(handlingRequestTaskCompletedTimelineId(taskId)).toBe(
      `handling_request_task_done:${taskId}`
    );
  });
});
