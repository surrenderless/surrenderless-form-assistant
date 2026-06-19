import { describe, expect, it } from "vitest";
import {
  buildOutcomeRecordedTimelineDetail,
  buildOutcomeRecordedTimelineEntry,
  buildHandlingAcknowledgedTimelineEntry,
  handlingAcknowledgedTimelineEntryId,
  HANDLING_ACKNOWLEDGED_TIMELINE_LABEL,
  HANDLING_OUTCOME_RECORDED_TIMELINE_LABEL,
  isFirstHandlingAcknowledgedTransition,
  isFirstOutcomeNoteTransition,
  outcomeRecordedTimelineEntryId,
} from "@/lib/justice/handlingClosureTimeline";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const ACKNOWLEDGED_AT = "2026-06-16T13:00:00.000Z";

function clientStateWithApproved(input: Record<string, string>): {
  approved_next_action: Record<string, string>;
} {
  return { approved_next_action: input };
}

describe("isFirstOutcomeNoteTransition", () => {
  it("returns true when outcome_note transitions from missing to present", () => {
    expect(
      isFirstOutcomeNoteTransition(
        clientStateWithApproved({ label: "File BBB complaint" }),
        clientStateWithApproved({
          label: "File BBB complaint",
          outcome_note: "Merchant promised refund by Friday.",
        })
      )
    ).toBe(true);
  });

  it("returns false when outcome was already recorded or remains empty", () => {
    const withOutcome = clientStateWithApproved({
      label: "File BBB complaint",
      outcome_note: "Already recorded.",
    });
    expect(isFirstOutcomeNoteTransition(withOutcome, withOutcome)).toBe(false);
    expect(
      isFirstOutcomeNoteTransition(
        clientStateWithApproved({ label: "File BBB complaint" }),
        clientStateWithApproved({ label: "File BBB complaint", status: "completed" })
      )
    ).toBe(false);
  });
});

describe("isFirstHandlingAcknowledgedTransition", () => {
  it("returns true when handling_acknowledged_at transitions from missing to present", () => {
    expect(
      isFirstHandlingAcknowledgedTransition(
        clientStateWithApproved({
          label: "File BBB complaint",
          handling_requested_at: "2026-06-16T12:00:00.000Z",
        }),
        clientStateWithApproved({
          label: "File BBB complaint",
          handling_requested_at: "2026-06-16T12:00:00.000Z",
          handling_acknowledged_at: ACKNOWLEDGED_AT,
        })
      )
    ).toBe(true);
  });

  it("returns false when acknowledgement was already present or remains empty", () => {
    const acknowledged = clientStateWithApproved({
      label: "File BBB complaint",
      handling_requested_at: "2026-06-16T12:00:00.000Z",
      handling_acknowledged_at: ACKNOWLEDGED_AT,
    });
    expect(isFirstHandlingAcknowledgedTransition(acknowledged, acknowledged)).toBe(false);
    expect(
      isFirstHandlingAcknowledgedTransition(
        clientStateWithApproved({ label: "File BBB complaint" }),
        clientStateWithApproved({ label: "File BBB complaint" })
      )
    ).toBe(false);
  });
});

describe("buildOutcomeRecordedTimelineEntry", () => {
  it("uses a stable idempotent id and includes outcome note detail", () => {
    const entry = buildOutcomeRecordedTimelineEntry(CASE_ID, {
      label: "File BBB complaint",
      outcome_note: "Merchant promised refund by Friday.",
    });

    expect(entry.id).toBe(outcomeRecordedTimelineEntryId(CASE_ID));
    expect(entry.id).toBe(`outcome_recorded:${CASE_ID}`);
    expect(entry.type).toBe("outcome_recorded");
    expect(entry.label).toBe(HANDLING_OUTCOME_RECORDED_TIMELINE_LABEL);
    expect(entry.detail).toBe("Merchant promised refund by Friday.");
  });

  it("builds detail from outcome note only", () => {
    expect(
      buildOutcomeRecordedTimelineDetail({
        outcome_note: "Resolved for now.",
      })
    ).toBe("Resolved for now.");
  });
});

describe("buildHandlingAcknowledgedTimelineEntry", () => {
  it("uses a stable idempotent id and acknowledgement timestamp", () => {
    const entry = buildHandlingAcknowledgedTimelineEntry(CASE_ID, {
      label: "File BBB complaint",
      handling_acknowledged_at: ACKNOWLEDGED_AT,
    });

    expect(entry.id).toBe(handlingAcknowledgedTimelineEntryId(CASE_ID));
    expect(entry.id).toBe(`handling_acknowledged:${CASE_ID}`);
    expect(entry.type).toBe("handling_acknowledged");
    expect(entry.label).toBe(HANDLING_ACKNOWLEDGED_TIMELINE_LABEL);
    expect(entry.ts).toBe(ACKNOWLEDGED_AT);
  });
});
