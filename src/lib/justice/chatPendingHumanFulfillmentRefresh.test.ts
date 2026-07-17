import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildChatCaseProgressNarrationMessage,
  collectNewChatCaseProgressNarrationMessages,
} from "@/lib/justice/chatCaseProgressNarration";
import {
  CHAT_PENDING_HUMAN_FULFILLMENT_POLL_MS,
  isChatOperatorOwnedClosurePollPending,
  isChatPendingHumanFulfillmentEscalation,
  shouldRefreshChatAfterEscalationTerminalTransition,
} from "@/lib/justice/chatPendingHumanFulfillmentRefresh";
import { OPERATOR_RESOLVED_OUTCOME_MARKER } from "@/lib/justice/completeFollowUpResponseReview";
import { stateAgFilingTaskNotesMarker } from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function terminalClosureAction(): JusticeApprovedNextAction {
  return {
    label: "Small claims / demand letter",
    href: "/justice/demand-letter",
    status: "completed",
    completed_at: "2026-06-01T00:00:00.000Z",
    follow_up_needed: false,
    outcome_note: `${OPERATOR_RESOLVED_OUTCOME_MARKER}. Consumer refunded.`,
  };
}

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

  it("keeps polling active during operator-owned closure pending", () => {
    expect(
      isChatOperatorOwnedClosurePollPending({
        approvedAction: terminalClosureAction(),
        archivedAt: null,
      })
    ).toBe(true);
    expect(
      isChatOperatorOwnedClosurePollPending({
        approvedAction: terminalClosureAction(),
        archivedAt: undefined,
      })
    ).toBe(true);
    expect(
      isChatOperatorOwnedClosurePollPending({
        approvedAction: terminalClosureAction(),
        archivedAt: "   ",
      })
    ).toBe(true);
  });

  it("stops polling once archived_at is observed or there is no terminal outcome", () => {
    expect(
      isChatOperatorOwnedClosurePollPending({
        approvedAction: terminalClosureAction(),
        archivedAt: "2026-07-17T12:00:00.000Z",
      })
    ).toBe(false);
    expect(
      isChatOperatorOwnedClosurePollPending({
        approvedAction: {
          label: "State Attorney General (consumer)",
          href: "/justice/state-ag",
          status: "approved",
        },
        archivedAt: null,
      })
    ).toBe(false);
    expect(
      isChatOperatorOwnedClosurePollPending({ approvedAction: undefined, archivedAt: null })
    ).toBe(false);
  });
});

describe("operator-owned closure poll lifecycle", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
  });

  it("emits exactly one closed-case narration across the pending -> archived poll transition", () => {
    const action = terminalClosureAction();

    // While closure is pending (no archived_at), polling stays active and narrates pending.
    expect(
      isChatOperatorOwnedClosurePollPending({ approvedAction: action, archivedAt: null })
    ).toBe(true);
    const pendingNarration = collectNewChatCaseProgressNarrationMessages({
      caseId: CASE_ID,
      approvedAction: action,
      tasks: [],
      filings: [],
      archivedAt: null,
    });
    expect(pendingNarration).toContain(
      buildChatCaseProgressNarrationMessage("operator_closure_pending")
    );

    // archived_at appears on a later tick: polling should stop and narrate closed exactly once.
    expect(
      isChatOperatorOwnedClosurePollPending({
        approvedAction: action,
        archivedAt: "2026-07-17T12:00:00.000Z",
      })
    ).toBe(false);

    const firstClosed = collectNewChatCaseProgressNarrationMessages({
      caseId: CASE_ID,
      approvedAction: action,
      tasks: [],
      filings: [],
      archivedAt: "2026-07-17T12:00:00.000Z",
    });
    expect(firstClosed).toEqual([
      buildChatCaseProgressNarrationMessage("operator_case_closed"),
    ]);

    // Any subsequent refresh must not re-emit the closed-case handoff.
    const secondClosed = collectNewChatCaseProgressNarrationMessages({
      caseId: CASE_ID,
      approvedAction: action,
      tasks: [],
      filings: [],
      archivedAt: "2026-07-17T12:00:00.000Z",
    });
    expect(secondClosed).toEqual([]);
  });
});
