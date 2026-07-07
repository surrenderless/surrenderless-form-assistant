import { describe, expect, it } from "vitest";
import {
  CHAT_PENDING_HUMAN_FULFILLMENT_POLL_MS,
  isChatPendingHumanFulfillmentEscalation,
  shouldRefreshChatAfterEscalationTerminalTransition,
} from "@/lib/justice/chatPendingHumanFulfillmentRefresh";
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

describe("chatPendingHumanFulfillmentRefresh", () => {
  it("uses a sub-5s poll interval for responsive operator updates", () => {
    expect(CHAT_PENDING_HUMAN_FULFILLMENT_POLL_MS).toBeLessThan(5_000);
    expect(CHAT_PENDING_HUMAN_FULFILLMENT_POLL_MS).toBeGreaterThanOrEqual(1_000);
  });

  it("detects pending escalation from approved action href", () => {
    expect(
      isChatPendingHumanFulfillmentEscalation({
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

  it("detects pending escalation from open operator tasks", () => {
    expect(
      isChatPendingHumanFulfillmentEscalation({
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

  it("requests terminal refresh when pending escalation clears", () => {
    expect(
      shouldRefreshChatAfterEscalationTerminalTransition({
        wasPending: true,
        isPending: false,
      })
    ).toBe(true);
    expect(
      shouldRefreshChatAfterEscalationTerminalTransition({
        wasPending: false,
        isPending: false,
      })
    ).toBe(false);
    expect(
      shouldRefreshChatAfterEscalationTerminalTransition({
        wasPending: true,
        isPending: true,
      })
    ).toBe(false);
  });
});
