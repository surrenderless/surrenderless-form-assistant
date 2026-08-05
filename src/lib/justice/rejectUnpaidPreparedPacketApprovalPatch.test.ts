import { describe, expect, it } from "vitest";
import {
  isFirstPreparedPacketApprovalTransition,
  rejectUnpaidPreparedPacketApprovalPatch,
  REJECT_UNPAID_PREPARED_PACKET_APPROVAL_MESSAGE,
} from "@/lib/justice/rejectUnpaidPreparedPacketApprovalPatch";

function stateWithApproval(approved: boolean): unknown {
  return { prepared_packet_approved: approved };
}

describe("isFirstPreparedPacketApprovalTransition", () => {
  it("is true when approval goes from missing to true", () => {
    expect(isFirstPreparedPacketApprovalTransition(undefined, stateWithApproval(true))).toBe(true);
  });

  it("is true when approval goes from false to true", () => {
    expect(
      isFirstPreparedPacketApprovalTransition(stateWithApproval(false), stateWithApproval(true))
    ).toBe(true);
  });

  it("is false when approval was already true (preserves already-approved/in-progress cases)", () => {
    expect(
      isFirstPreparedPacketApprovalTransition(stateWithApproval(true), stateWithApproval(true))
    ).toBe(false);
  });

  it("is false when the incoming patch does not set approval", () => {
    expect(
      isFirstPreparedPacketApprovalTransition(stateWithApproval(false), stateWithApproval(false))
    ).toBe(false);
  });

  it("is false when going from true back to false (never re-triggers on a downgrade)", () => {
    expect(
      isFirstPreparedPacketApprovalTransition(stateWithApproval(true), stateWithApproval(false))
    ).toBe(false);
  });
});

describe("rejectUnpaidPreparedPacketApprovalPatch", () => {
  it("rejects the first approval transition when the case has never been paid", () => {
    const result = rejectUnpaidPreparedPacketApprovalPatch({
      existingClientState: stateWithApproval(false),
      incomingClientState: stateWithApproval(true),
      paidAt: null,
    });
    expect(result).toBe(REJECT_UNPAID_PREPARED_PACKET_APPROVAL_MESSAGE);
  });

  it("allows the first approval transition once paid_at is set", () => {
    const result = rejectUnpaidPreparedPacketApprovalPatch({
      existingClientState: stateWithApproval(false),
      incomingClientState: stateWithApproval(true),
      paidAt: "2026-08-01T12:00:00.000Z",
    });
    expect(result).toBeNull();
  });

  it("treats a blank/whitespace paid_at the same as unpaid", () => {
    const result = rejectUnpaidPreparedPacketApprovalPatch({
      existingClientState: stateWithApproval(false),
      incomingClientState: stateWithApproval(true),
      paidAt: "   ",
    });
    expect(result).toBe(REJECT_UNPAID_PREPARED_PACKET_APPROVAL_MESSAGE);
  });

  it("never blocks a case that is already approved/in progress, even when unpaid", () => {
    const result = rejectUnpaidPreparedPacketApprovalPatch({
      existingClientState: stateWithApproval(true),
      incomingClientState: stateWithApproval(true),
      paidAt: null,
    });
    expect(result).toBeNull();
  });

  it("never blocks unrelated client_state patches that don't touch approval", () => {
    const result = rejectUnpaidPreparedPacketApprovalPatch({
      existingClientState: { prepared_packet_approved: false, approved_next_action: { href: "/x" } },
      incomingClientState: {
        prepared_packet_approved: false,
        approved_next_action: { href: "/x", outcome_note: "note" },
      },
      paidAt: null,
    });
    expect(result).toBeNull();
  });

  it("never blocks intake-only or evidence-only activity (no client_state approval field at all)", () => {
    const result = rejectUnpaidPreparedPacketApprovalPatch({
      existingClientState: null,
      incomingClientState: null,
      paidAt: null,
    });
    expect(result).toBeNull();
  });
});
