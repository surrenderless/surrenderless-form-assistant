import { describe, expect, it } from "vitest";
import {
  openTasksGrantOperatorEvidenceAccess,
  taskNotesMatchAnyOperatorFulfillmentMarker,
} from "@/lib/justice/operatorEvidenceFileAccess";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_CASE = "550e8400-e29b-41d4-a716-446655440001";

describe("operatorEvidenceFileAccess", () => {
  it("matches any known operator fulfillment lane marker for the case", () => {
    const notes = `cfpb_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}\ndraft:\nBody`;
    expect(taskNotesMatchAnyOperatorFulfillmentMarker(notes, CASE_ID)).toBe(true);
    expect(taskNotesMatchAnyOperatorFulfillmentMarker(notes, OTHER_CASE)).toBe(false);
    expect(taskNotesMatchAnyOperatorFulfillmentMarker("unrelated notes", CASE_ID)).toBe(false);
  });

  it("grants evidence access only for open matching tasks on the same case", () => {
    const openNotes = `cfpb_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}\ndraft:\nBody`;

    expect(
      openTasksGrantOperatorEvidenceAccess(CASE_ID, [
        { case_id: CASE_ID, notes: openNotes, completed_at: null },
      ])
    ).toBe(true);

    expect(
      openTasksGrantOperatorEvidenceAccess(CASE_ID, [
        {
          case_id: CASE_ID,
          notes: openNotes,
          completed_at: "2026-07-01T00:00:00.000Z",
        },
      ])
    ).toBe(false);

    expect(
      openTasksGrantOperatorEvidenceAccess(CASE_ID, [
        { case_id: OTHER_CASE, notes: openNotes, completed_at: null },
      ])
    ).toBe(false);

    const otherLane = `bbb_filing_queue:${OTHER_CASE}\ncase_id: ${OTHER_CASE}\ndraft:\nBody`;
    expect(
      openTasksGrantOperatorEvidenceAccess(CASE_ID, [
        { case_id: OTHER_CASE, notes: otherLane, completed_at: null },
      ])
    ).toBe(false);
  });
});
