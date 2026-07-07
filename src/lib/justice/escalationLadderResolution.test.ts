import { describe, expect, it } from "vitest";
import {
  hasPendingHumanFulfillmentEscalation,
  isEscalationLadderTerminalForResolution,
  sanitizeClientStateForEscalationLadder,
  shouldExposeCaseResolutionFlow,
  stripResolutionTrackingFromApprovedAction,
} from "@/lib/justice/escalationLadderResolution";
import { stateAgFilingTaskNotesMarker } from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function openStateAgTask(): JusticeCaseTaskRow {
  const marker = stateAgFilingTaskNotesMarker(CASE_ID);
  return {
    id: "task-state-ag",
    user_id: "user",
    case_id: CASE_ID,
    title: "State AG filing: Acme",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}`,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("escalationLadderResolution", () => {
  it("detects pending State AG escalation from approved action href", () => {
    expect(
      hasPendingHumanFulfillmentEscalation({
        caseId: CASE_ID,
        tasks: [],
        approvedAction: {
          label: "State Attorney General (consumer)",
          href: "/justice/state-ag",
          status: "approved",
        },
      })
    ).toBe(true);
  });

  it("detects pending escalation from open operator task", () => {
    expect(
      hasPendingHumanFulfillmentEscalation({
        caseId: CASE_ID,
        tasks: [openStateAgTask()],
        approvedAction: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "approved",
        },
      })
    ).toBe(true);
  });

  it("treats completed demand letter as escalation terminal", () => {
    expect(
      isEscalationLadderTerminalForResolution({
        label: "Small claims / demand letter",
        href: "/justice/demand-letter",
        status: "completed",
        completed_at: "2026-01-03T00:00:00.000Z",
      })
    ).toBe(true);
  });

  it("blocks resolution flow while State AG escalation is pending", () => {
    expect(
      shouldExposeCaseResolutionFlow({
        caseId: CASE_ID,
        tasks: [openStateAgTask()],
        approvedAction: {
          label: "State Attorney General (consumer)",
          href: "/justice/state-ag",
          status: "approved",
          follow_up_needed: true,
          outcome_note: "Should not show yet",
        },
      })
    ).toBe(false);
  });

  it("exposes resolution flow after demand letter terminal completion", () => {
    expect(
      shouldExposeCaseResolutionFlow({
        caseId: CASE_ID,
        tasks: [],
        approvedAction: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "completed",
          completed_at: "2026-01-03T00:00:00.000Z",
        },
      })
    ).toBe(true);
  });

  it("strips premature BBB resolution from pending State AG client_state", () => {
    const sanitized = sanitizeClientStateForEscalationLadder({
      prepared_packet_approved: true,
      approved_next_action: {
        label: "State Attorney General (consumer)",
        href: "/justice/state-ag",
        status: "approved",
        handling_requested_at: "2026-06-21T00:00:00.000Z",
        handling_request_note: "BBB complaint filed for Acme.",
        handling_acknowledged_at: "2026-06-21T00:00:01.000Z",
        outcome_note: "BBB filing recorded for Acme.",
        follow_up_needed: true,
        follow_up_at: "2026-08-20T00:00:00.000Z",
      },
    });
    expect(sanitized.approved_next_action?.handling_requested_at?.trim()).toBeFalsy();
    expect(sanitized.approved_next_action?.outcome_note?.trim()).toBeFalsy();
    expect(sanitized.approved_next_action?.follow_up_needed).not.toBe(true);
    expect(stripResolutionTrackingFromApprovedAction(sanitized.approved_next_action!)).toEqual({
      label: "State Attorney General (consumer)",
      href: "/justice/state-ag",
      status: "approved",
    });
  });
});
