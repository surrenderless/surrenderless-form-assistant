import { describe, expect, it } from "vitest";
import {
  buildHandlingRequestTimelineDetail,
  buildHandlingRequestTimelineEntry,
  handlingRequestTimelineEntryId,
  isFirstHandlingRequestTransition,
} from "@/lib/justice/handlingRequestTimeline";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const REQUESTED_AT = "2026-06-16T12:00:00.000Z";

function clientStateWithHandling(input: {
  handling_requested_at?: string;
  label?: string;
  handling_request_note?: string;
}): { approved_next_action: Record<string, string> } {
  const approved_next_action: Record<string, string> = {};
  if (input.label) approved_next_action.label = input.label;
  if (input.handling_requested_at) {
    approved_next_action.handling_requested_at = input.handling_requested_at;
  }
  if (input.handling_request_note) {
    approved_next_action.handling_request_note = input.handling_request_note;
  }
  return { approved_next_action };
}

describe("isFirstHandlingRequestTransition", () => {
  it("returns true when handling_requested_at transitions from missing to present", () => {
    expect(
      isFirstHandlingRequestTransition(
        { approved_next_action: { label: "File BBB complaint" } },
        clientStateWithHandling({
          label: "File BBB complaint",
          handling_requested_at: REQUESTED_AT,
        })
      )
    ).toBe(true);
  });

  it("returns false when handling was already requested", () => {
    const existing = clientStateWithHandling({
      label: "File BBB complaint",
      handling_requested_at: "2026-06-15T10:00:00.000Z",
    });
    const incoming = clientStateWithHandling({
      label: "File BBB complaint",
      handling_requested_at: REQUESTED_AT,
      handling_request_note: "Please prioritize",
    });
    expect(isFirstHandlingRequestTransition(existing, incoming)).toBe(false);
  });

  it("returns false when incoming patch does not set handling_requested_at", () => {
    expect(
      isFirstHandlingRequestTransition(
        { approved_next_action: { label: "File BBB complaint" } },
        { approved_next_action: { label: "File BBB complaint", status: "started" } }
      )
    ).toBe(false);
  });
});

describe("buildHandlingRequestTimelineEntry", () => {
  it("uses a stable idempotent id and includes label and note in detail", () => {
    const entry = buildHandlingRequestTimelineEntry(CASE_ID, {
      label: "File BBB complaint",
      handling_requested_at: REQUESTED_AT,
      handling_request_note: "Please call merchant first",
    });

    expect(entry.id).toBe(handlingRequestTimelineEntryId(CASE_ID));
    expect(entry.id).toBe(`handling_request:${CASE_ID}`);
    expect(entry.type).toBe("handling_requested");
    expect(entry.label).toBe("Surrenderless handling requested");
    expect(entry.ts).toBe(REQUESTED_AT);
    expect(entry.detail).toBe("File BBB complaint — Please call merchant first");
  });

  it("builds detail from approved action label only when note is absent", () => {
    expect(
      buildHandlingRequestTimelineDetail({
        label: "Open payment dispute checklist",
      })
    ).toBe("Open payment dispute checklist");
  });
});
