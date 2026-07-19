import { describe, expect, it } from "vitest";
import { bbbFilingTaskNotesMarker, taskNotesMatchBbbFilingMarker } from "@/lib/justice/bbbFilingTask";
import {
  parseBbbOwnedFilingDeliveryRecord,
  upsertBbbOwnedFilingDeliveryNotes,
} from "@/lib/justice/bbbOwnedFilingDeliveryState";
import {
  appendOperatorAlertSentMarker,
  hasOperatorAlertBeenSent,
  operatorFallbackAlertKey,
  parseOperatorAlertSentKeys,
} from "@/lib/justice/operatorFallbackAlertState";

describe("operatorFallbackAlertState", () => {
  it("builds a stable key from task id + idempotency key + stop_reason", () => {
    expect(operatorFallbackAlertKey("t1", "bbb-owned-autofill:c1", "invalid_decision")).toBe(
      "t1|bbb-owned-autofill:c1|invalid_decision"
    );
  });

  it("falls back to 'failed' when the stop_reason is missing", () => {
    expect(operatorFallbackAlertKey("t1", "k", null)).toBe("t1|k|failed");
    expect(operatorFallbackAlertKey("t1", "k", "")).toBe("t1|k|failed");
  });

  it("treats distinct stop_reasons as distinct alertable events", () => {
    const a = operatorFallbackAlertKey("t1", "k", "stale_queued_reclaimed");
    const b = operatorFallbackAlertKey("t1", "k", "stale_submitting_reclaimed");
    expect(a).not.toBe(b);
  });

  it("parses and detects recorded alert keys", () => {
    const key = operatorFallbackAlertKey("t1", "k", "invalid_decision");
    const notes = appendOperatorAlertSentMarker("draft", key, "2026-07-18T00:00:00.000Z");
    expect(parseOperatorAlertSentKeys(notes).has(key)).toBe(true);
    expect(hasOperatorAlertBeenSent(notes, key)).toBe(true);
    expect(hasOperatorAlertBeenSent(notes, operatorFallbackAlertKey("t1", "k", "other"))).toBe(false);
  });

  it("is idempotent — re-appending the same key does not duplicate the marker", () => {
    const key = operatorFallbackAlertKey("t1", "k", "invalid_decision");
    const once = appendOperatorAlertSentMarker("draft", key, "2026-07-18T00:00:00.000Z");
    const twice = appendOperatorAlertSentMarker(once, key, "2026-07-18T01:00:00.000Z");
    expect(twice).toBe(once);
    expect((twice.match(/operator_alert_sent:/g) ?? []).length).toBe(1);
  });

  it("does not disturb the leading queue marker or the trailing delivery block", () => {
    const caseId = "c1";
    const base = upsertBbbOwnedFilingDeliveryNotes(
      `${bbbFilingTaskNotesMarker(caseId)}\nBBB draft`,
      { delivery_state: "failed", provider: "bbb", stop_reason: "invalid_decision" }
    );
    const key = operatorFallbackAlertKey("t1", "bbb-owned-autofill:c1", "invalid_decision");
    const withMarker = appendOperatorAlertSentMarker(base, key, "2026-07-18T00:00:00.000Z");

    expect(taskNotesMatchBbbFilingMarker(withMarker, caseId)).toBe(true);
    expect(parseBbbOwnedFilingDeliveryRecord(withMarker)?.delivery_state).toBe("failed");
  });
});
