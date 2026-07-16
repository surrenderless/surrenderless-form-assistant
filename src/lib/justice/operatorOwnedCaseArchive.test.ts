import { describe, expect, it } from "vitest";
import {
  OPERATOR_FURTHER_ESCALATION_OUTCOME_MARKER,
  OPERATOR_NO_RESOLUTION_OUTCOME_MARKER,
  OPERATOR_RESOLVED_OUTCOME_MARKER,
} from "@/lib/justice/completeFollowUpResponseReview";
import { followUpResponseReviewTaskNotesMarker } from "@/lib/justice/followUpResponseReviewTask";
import {
  detectOperatorOwnedClosableCase,
  hasOperatorTerminalResponseReviewOutcome,
  shouldSuppressConsumerArchiveForOperatorOwnedClosure,
} from "@/lib/justice/operatorOwnedCaseArchive";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function terminalAction(
  outcomeNote: string,
  overrides: Partial<JusticeApprovedNextAction> = {}
): JusticeApprovedNextAction {
  return {
    label: "Small claims / demand letter",
    href: "/justice/demand-letter",
    status: "completed",
    completed_at: "2026-06-01T00:00:00.000Z",
    follow_up_needed: false,
    outcome_note: outcomeNote,
    handling_requested_at: "2026-06-01T00:00:00.000Z",
    handling_acknowledged_at: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}

function completedReviewTask(): JusticeCaseTaskRow {
  return {
    id: "task-review",
    user_id: "user",
    case_id: CASE_ID,
    title: "Follow-up response review",
    due_date: null,
    notes: followUpResponseReviewTaskNotesMarker(CASE_ID),
    completed_at: "2026-07-15T12:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-15T12:00:00.000Z",
  };
}

describe("operatorOwnedCaseArchive detection", () => {
  it("detects resolved and no_resolution markers", () => {
    expect(
      hasOperatorTerminalResponseReviewOutcome(
        terminalAction(OPERATOR_RESOLVED_OUTCOME_MARKER)
      )
    ).toBe(true);
    expect(
      hasOperatorTerminalResponseReviewOutcome(
        terminalAction(OPERATOR_NO_RESOLUTION_OUTCOME_MARKER)
      )
    ).toBe(true);
    expect(
      hasOperatorTerminalResponseReviewOutcome(
        terminalAction(OPERATOR_FURTHER_ESCALATION_OUTCOME_MARKER)
      )
    ).toBe(false);
  });

  it("allows closable detection only for terminal operator outcomes with ladder eligibility", () => {
    expect(
      detectOperatorOwnedClosableCase({
        caseId: CASE_ID,
        archivedAt: null,
        clientState: {
          prepared_packet_approved: true,
          approved_next_action: terminalAction(OPERATOR_RESOLVED_OUTCOME_MARKER),
        },
        tasks: [completedReviewTask()],
      })
    ).toBe(true);

    expect(
      detectOperatorOwnedClosableCase({
        caseId: CASE_ID,
        archivedAt: null,
        clientState: {
          prepared_packet_approved: true,
          approved_next_action: terminalAction(OPERATOR_NO_RESOLUTION_OUTCOME_MARKER),
        },
        tasks: [completedReviewTask()],
      })
    ).toBe(true);
  });

  it("never treats further escalation or open review as closable", () => {
    expect(
      detectOperatorOwnedClosableCase({
        caseId: CASE_ID,
        archivedAt: null,
        clientState: {
          prepared_packet_approved: true,
          approved_next_action: {
            label: "State AG",
            href: "/justice/state-ag",
            status: "approved",
            follow_up_needed: false,
          },
        },
        tasks: [completedReviewTask()],
      })
    ).toBe(false);

    const openReview: JusticeCaseTaskRow = {
      ...completedReviewTask(),
      completed_at: null,
    };
    expect(
      detectOperatorOwnedClosableCase({
        caseId: CASE_ID,
        archivedAt: null,
        clientState: {
          prepared_packet_approved: true,
          approved_next_action: terminalAction(OPERATOR_RESOLVED_OUTCOME_MARKER),
        },
        tasks: [openReview],
      })
    ).toBe(false);
  });

  it("suppresses consumer archive when operator owns closure", () => {
    expect(
      shouldSuppressConsumerArchiveForOperatorOwnedClosure({
        approved_next_action: terminalAction(OPERATOR_RESOLVED_OUTCOME_MARKER),
      })
    ).toBe(true);
    expect(
      shouldSuppressConsumerArchiveForOperatorOwnedClosure({
        approved_next_action: terminalAction("Awaiting responses."),
      })
    ).toBe(false);
  });
});
