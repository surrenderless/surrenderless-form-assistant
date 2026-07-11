import { describe, expect, it } from "vitest";
import {
  parseApprovedNextAction,
  readSessionApprovedNextAction,
  resolveApprovedNextAction,
  STORAGE_APPROVED_NEXT_ACTION_V1,
  writeSessionApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import { MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const clearedFollowUpAction = {
  label: "Small claims / demand letter",
  href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  status: "completed" as const,
  follow_up_needed: false as const,
  outcome_note: "Escalation complete.",
  handling_requested_at: "2026-06-23T12:00:00.000Z",
  handling_acknowledged_at: "2026-06-23T12:05:00.000Z",
};

const staleServerClientState = {
  approved_next_action: {
    label: "Small claims / demand letter",
    href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
    status: "completed",
    follow_up_needed: true,
    outcome_note: "Escalation complete.",
    handling_requested_at: "2026-06-23T12:00:00.000Z",
    handling_acknowledged_at: "2026-06-23T12:05:00.000Z",
  },
};

describe("parseApprovedNextAction follow-up round-trip", () => {
  it("preserves explicit follow_up_needed false", () => {
    expect(parseApprovedNextAction(clearedFollowUpAction)?.follow_up_needed).toBe(false);
  });

  it("omits follow_up_needed when absent", () => {
    const { follow_up_needed: _cleared, ...withoutFollowUp } = clearedFollowUpAction;
    expect(parseApprovedNextAction(withoutFollowUp)?.follow_up_needed).toBeUndefined();
  });
});

describe("resolveApprovedNextAction follow-up merge", () => {
  it("prefers cleared follow-up when session is false and server is still flagged", () => {
    if (typeof sessionStorage === "undefined") return;

    writeSessionApprovedNextAction(CASE_ID, clearedFollowUpAction);
    expect(readSessionApprovedNextAction(CASE_ID)?.follow_up_needed).toBe(false);

    const resolved = resolveApprovedNextAction(CASE_ID, staleServerClientState);

    expect(resolved?.follow_up_needed).toBe(false);
    sessionStorage.removeItem(STORAGE_APPROVED_NEXT_ACTION_V1);
  });
});
