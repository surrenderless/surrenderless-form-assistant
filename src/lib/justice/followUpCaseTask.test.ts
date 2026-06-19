import { describe, expect, it } from "vitest";
import {
  buildFollowUpTaskNotes,
  buildFollowUpTaskTitle,
  followUpTaskDueDateFromApprovedNext,
  followUpTaskNotesMarker,
  isFirstFollowUpNeededTransition,
  taskNotesMatchFollowUpMarker,
} from "@/lib/justice/followUpCaseTask";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("followUpTaskNotesMarker", () => {
  it("uses a stable follow-up marker per case", () => {
    expect(followUpTaskNotesMarker(CASE_ID)).toBe(`follow_up:${CASE_ID}`);
  });
});

describe("isFirstFollowUpNeededTransition", () => {
  it("returns true when follow_up_needed transitions from absent to true", () => {
    expect(
      isFirstFollowUpNeededTransition(
        { approved_next_action: { label: "File BBB complaint" } },
        { approved_next_action: { label: "File BBB complaint", follow_up_needed: true } }
      )
    ).toBe(true);
  });

  it("returns false when follow_up_needed was already true or remains false", () => {
    const withFollowUp = { approved_next_action: { follow_up_needed: true } };
    expect(isFirstFollowUpNeededTransition(withFollowUp, withFollowUp)).toBe(false);
    expect(
      isFirstFollowUpNeededTransition(
        { approved_next_action: { follow_up_needed: true } },
        { approved_next_action: {} }
      )
    ).toBe(false);
  });
});

describe("buildFollowUpTaskTitle", () => {
  it("uses the approved action label in the title", () => {
    expect(buildFollowUpTaskTitle({ label: "File BBB complaint" })).toBe(
      "Surrenderless follow-up: File BBB complaint"
    );
  });

  it("falls back when label is missing", () => {
    expect(buildFollowUpTaskTitle({})).toBe("Surrenderless follow-up: Approved next action");
  });
});

describe("buildFollowUpTaskNotes", () => {
  it("includes stable marker and optional outcome note", () => {
    expect(
      buildFollowUpTaskNotes(CASE_ID, { outcome_note: "Merchant promised refund by Friday." })
    ).toBe(`follow_up:${CASE_ID}\nMerchant promised refund by Friday.`);
  });

  it("uses marker only when outcome note is absent", () => {
    expect(buildFollowUpTaskNotes(CASE_ID, { label: "File BBB complaint" })).toBe(
      `follow_up:${CASE_ID}`
    );
  });
});

describe("taskNotesMatchFollowUpMarker", () => {
  it("matches marker-only and marker-plus-note notes", () => {
    expect(taskNotesMatchFollowUpMarker(`follow_up:${CASE_ID}`, CASE_ID)).toBe(true);
    expect(
      taskNotesMatchFollowUpMarker(`follow_up:${CASE_ID}\nMerchant promised refund.`, CASE_ID)
    ).toBe(true);
  });

  it("does not match unrelated notes", () => {
    expect(taskNotesMatchFollowUpMarker(`handling_request:${CASE_ID}`, CASE_ID)).toBe(false);
  });
});

describe("followUpTaskDueDateFromApprovedNext", () => {
  it("maps follow_up_at calendar values to YYYY-MM-DD", () => {
    expect(
      followUpTaskDueDateFromApprovedNext({
        follow_up_at: "2026-07-01",
      })
    ).toBe("2026-07-01");
  });

  it("returns null when follow_up_at is missing or invalid", () => {
    expect(followUpTaskDueDateFromApprovedNext({})).toBeNull();
    expect(followUpTaskDueDateFromApprovedNext({ follow_up_at: "   " })).toBeNull();
    expect(followUpTaskDueDateFromApprovedNext({ follow_up_at: "not-a-date" })).toBeNull();
  });
});
