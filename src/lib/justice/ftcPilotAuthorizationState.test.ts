import { describe, expect, it } from "vitest";
import {
  isFtcPilotAuthorized,
  parseFtcPilotAuthorizationRecord,
  upsertFtcPilotAuthorizationNotes,
} from "@/lib/justice/ftcPilotAuthorizationState";
import { upsertFtcOwnedFilingDeliveryNotes } from "@/lib/justice/ftcOwnedFilingDeliveryState";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "case-1";

function taskWithNotes(notes: string): JusticeCaseTaskRow {
  return {
    id: "task-1",
    user_id: "user_1",
    case_id: CASE_ID,
    title: "FTC",
    due_date: null,
    notes,
    completed_at: null,
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
  };
}

describe("ftcPilotAuthorizationState", () => {
  it("round-trips an authorization record", () => {
    const notes = upsertFtcPilotAuthorizationNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`, {
      authorized_by: "operator_1",
      authorized_at: "2026-07-13T00:00:00.000Z",
    });
    expect(parseFtcPilotAuthorizationRecord(notes)).toEqual({
      authorized_by: "operator_1",
      authorized_at: "2026-07-13T00:00:00.000Z",
    });
    expect(notes).toContain("draft:\nx");
  });

  it("returns null when no authorization block is present", () => {
    expect(parseFtcPilotAuthorizationRecord(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`)).toBeNull();
    expect(parseFtcPilotAuthorizationRecord(null)).toBeNull();
    expect(parseFtcPilotAuthorizationRecord(undefined)).toBeNull();
  });

  it("isFtcPilotAuthorized reflects presence/absence and handles a null task", () => {
    const authorized = taskWithNotes(
      upsertFtcPilotAuthorizationNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`, {
        authorized_by: "operator_1",
        authorized_at: "2026-07-13T00:00:00.000Z",
      })
    );
    expect(isFtcPilotAuthorized(authorized)).toBe(true);

    const unauthorized = taskWithNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`);
    expect(isFtcPilotAuthorized(unauthorized)).toBe(false);

    expect(isFtcPilotAuthorized(undefined)).toBe(false);
    expect(isFtcPilotAuthorized(null)).toBe(false);
  });

  // The composability property the delivery-boundary gate depends on: the auth block must never
  // be positioned after the delivery block, because upsertFtcOwnedFilingDeliveryNotes truncates
  // and rewrites everything from ITS OWN marker onward — anything after it would be silently lost.
  describe("composability with the delivery-state block (order-safety)", () => {
    it("a delivery-state write made AFTER authorization preserves the authorization block", () => {
      let notes = `ftc_filing_queue:${CASE_ID}\ndraft:\nx`;
      notes = upsertFtcPilotAuthorizationNotes(notes, {
        authorized_by: "operator_1",
        authorized_at: "2026-07-13T00:00:00.000Z",
      });
      notes = upsertFtcOwnedFilingDeliveryNotes(notes, {
        delivery_state: "queued",
        provider: "real_ftc_bounded_submit",
        started_at: "2026-07-14T00:00:00.000Z",
      });
      expect(parseFtcPilotAuthorizationRecord(notes)).toEqual({
        authorized_by: "operator_1",
        authorized_at: "2026-07-13T00:00:00.000Z",
      });
      // Delivery parsing is unaffected by what precedes its own marker.
      expect(notes).toContain("delivery_state: queued");

      // A SECOND delivery-state write (e.g. queued -> submitting -> failed) must still preserve it.
      notes = upsertFtcOwnedFilingDeliveryNotes(notes, {
        delivery_state: "failed",
        provider: "real_ftc_bounded_submit",
        started_at: "2026-07-14T00:00:00.000Z",
        failure_detail: "step cap",
      });
      expect(parseFtcPilotAuthorizationRecord(notes)).toEqual({
        authorized_by: "operator_1",
        authorized_at: "2026-07-13T00:00:00.000Z",
      });
      expect(notes).toContain("delivery_state: failed");
    });

    it("authorizing AFTER an existing delivery-state block still positions auth before it, not after", () => {
      let notes = upsertFtcOwnedFilingDeliveryNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`, {
        delivery_state: "failed",
        provider: "real_ftc_bounded_submit",
        started_at: "2026-07-14T00:00:00.000Z",
        failure_detail: "prior attempt failed",
      });
      notes = upsertFtcPilotAuthorizationNotes(notes, {
        authorized_by: "operator_2",
        authorized_at: "2026-07-15T00:00:00.000Z",
      });

      expect(parseFtcPilotAuthorizationRecord(notes)).toEqual({
        authorized_by: "operator_2",
        authorized_at: "2026-07-15T00:00:00.000Z",
      });
      // Re-authorizing must not clobber the existing delivery record either.
      expect(notes).toContain("delivery_state: failed");
      expect(notes).toContain("prior attempt failed");

      // A THIRD write (delivery re-queued after re-authorization) must still preserve auth.
      notes = upsertFtcOwnedFilingDeliveryNotes(notes, {
        delivery_state: "queued",
        provider: "real_ftc_bounded_submit",
        started_at: "2026-07-15T01:00:00.000Z",
      });
      expect(parseFtcPilotAuthorizationRecord(notes)).toEqual({
        authorized_by: "operator_2",
        authorized_at: "2026-07-15T00:00:00.000Z",
      });
    });

    it("re-authorizing (upsert called twice) replaces the auth block in place without duplicating it", () => {
      let notes = upsertFtcPilotAuthorizationNotes(`ftc_filing_queue:${CASE_ID}\ndraft:\nx`, {
        authorized_by: "operator_1",
        authorized_at: "2026-07-13T00:00:00.000Z",
      });
      notes = upsertFtcPilotAuthorizationNotes(notes, {
        authorized_by: "operator_1",
        authorized_at: "2026-07-14T00:00:00.000Z",
      });
      expect(parseFtcPilotAuthorizationRecord(notes)).toEqual({
        authorized_by: "operator_1",
        authorized_at: "2026-07-14T00:00:00.000Z",
      });
      expect(notes.match(/---ftc_pilot_authorization---/g)?.length).toBe(1);
    });
  });
});
