import { describe, expect, it } from "vitest";
import {
  appendRecipientRequiredReminderSentMarker,
  hasRecipientRequiredReminderBeenSent,
  parseRecipientRequiredReminderSentKeys,
  recipientRequiredReminderKey,
} from "./recipientRequiredReminderState";

describe("recipientRequiredReminderState", () => {
  it("has not been sent when notes carry no marker", () => {
    expect(hasRecipientRequiredReminderBeenSent(null, "task-1")).toBe(false);
    expect(hasRecipientRequiredReminderBeenSent("merchant_contact_queue:case-1", "task-1")).toBe(false);
  });

  it("appends a marker that is then detected as sent", () => {
    const withMarker = appendRecipientRequiredReminderSentMarker(
      "merchant_contact_queue:case-1\ncase_id: case-1",
      "task-1",
      "2026-01-02T00:00:00.000Z"
    );
    expect(withMarker).toContain("merchant_contact_queue:case-1");
    expect(withMarker).toContain("recipient_required_reminder_sent: task-1");
    expect(withMarker).toContain("recipient_required_reminder_sent_at: 2026-01-02T00:00:00.000Z");
    expect(hasRecipientRequiredReminderBeenSent(withMarker, "task-1")).toBe(true);
  });

  it("is idempotent — re-appending the same key does not duplicate the marker", () => {
    const first = appendRecipientRequiredReminderSentMarker("base notes", "task-1", "2026-01-02T00:00:00.000Z");
    const second = appendRecipientRequiredReminderSentMarker(first, "task-1", "2026-01-03T00:00:00.000Z");
    expect(second).toBe(first);
    expect(parseRecipientRequiredReminderSentKeys(second).size).toBe(1);
  });

  it("does not confuse one task's marker for another's", () => {
    const notes = appendRecipientRequiredReminderSentMarker("base", "task-1", "2026-01-02T00:00:00.000Z");
    expect(hasRecipientRequiredReminderBeenSent(notes, "task-2")).toBe(false);
  });

  it("trims the task id used as the key", () => {
    expect(recipientRequiredReminderKey("  task-1  ")).toBe("task-1");
  });
});
