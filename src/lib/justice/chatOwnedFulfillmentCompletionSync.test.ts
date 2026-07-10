import { describe, expect, it } from "vitest";
import {
  CHAT_OWNED_FULFILLMENT_STATE_AG_APPROVED_HREF,
  observeChatOwnedFulfillmentCompletionSync,
  shouldRehydrateCaseAfterOwnedFulfillmentSync,
} from "@/lib/justice/chatOwnedFulfillmentCompletionSync";
import { MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
import { stateAgFilingTaskNotesMarker } from "@/lib/justice/stateAgFilingTask";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const openStateAgTask = {
  id: "task-state-ag-open",
  user_id: "user",
  case_id: CASE_ID,
  title: "State AG filing",
  due_date: null,
  notes: `${stateAgFilingTaskNotesMarker(CASE_ID)}\ncase_id: ${CASE_ID}`,
  completed_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const completedStateAgTask = {
  ...openStateAgTask,
  id: "task-state-ag-done",
  completed_at: "2026-06-22T12:00:00.000Z",
  updated_at: "2026-06-22T12:00:00.000Z",
};

describe("observeChatOwnedFulfillmentCompletionSync", () => {
  it("detects State AG owned-step completion transition and requests rehydrate", () => {
    const pendingObservation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "State Attorney General (consumer)",
        href: CHAT_OWNED_FULFILLMENT_STATE_AG_APPROVED_HREF,
        status: "approved" as const,
      },
      tasks: [openStateAgTask],
      filings: [],
    };

    const pendingSync = observeChatOwnedFulfillmentCompletionSync({
      observation: pendingObservation,
      previousSnapshot: null,
      wasPending: false,
    });

    expect(pendingSync.isPending).toBe(true);
    expect(pendingSync.ownedStepsNewlyCompleted).toEqual([]);
    expect(pendingSync.shouldRehydrateCase).toBe(false);

    const completedObservation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "Small claims / demand letter",
        href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
        status: "approved" as const,
      },
      tasks: [completedStateAgTask],
      filings: [
        {
          destination: "State Attorney General (consumer)",
          confirmation_number: "ag-confirmed-456",
        },
      ],
    };

    const completedSync = observeChatOwnedFulfillmentCompletionSync({
      observation: completedObservation,
      previousSnapshot: pendingSync.currentSnapshot,
      wasPending: true,
    });

    expect(completedSync.isPending).toBe(true);
    expect(completedSync.ownedStepsNewlyCompleted).toEqual(["state_ag"]);
    expect(completedSync.approvedActionAdvanced).toBe(true);
    expect(completedSync.shouldRehydrateCase).toBe(true);
    expect(shouldRehydrateCaseAfterOwnedFulfillmentSync(completedSync)).toBe(true);
  });

  it("does not treat cold-load owned-step completion as a live transition", () => {
    const observation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "Small claims / demand letter",
        href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
        status: "approved" as const,
      },
      tasks: [completedStateAgTask],
      filings: [
        {
          destination: "State Attorney General (consumer)",
          confirmation_number: "ag-confirmed-456",
        },
      ],
    };

    const result = observeChatOwnedFulfillmentCompletionSync({
      observation,
      previousSnapshot: null,
      wasPending: false,
    });

    expect(result.ownedStepsNewlyCompleted).toEqual([]);
    expect(result.approvedActionAdvanced).toBe(false);
    expect(result.shouldRehydrateCase).toBe(false);
    expect(result.currentSnapshot.completedStepIds).toEqual(["state_ag"]);
  });

  it("delegates terminal escalation transitions to resolution sync flags", () => {
    const observation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "Small claims / demand letter",
        href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
        status: "completed" as const,
        completed_at: "2026-06-23T12:00:00.000Z",
      },
      tasks: [],
      filings: [
        {
          destination: "Small claims / demand letter",
          confirmation_number: "dl-confirmed-123",
        },
      ],
    };

    const result = observeChatOwnedFulfillmentCompletionSync({
      observation,
      previousSnapshot: {
        completedStepIds: ["state_ag"],
        approvedActionHref: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
      },
      wasPending: true,
    });

    expect(result.isPending).toBe(false);
    expect(result.terminalTransitioned).toBe(true);
    expect(result.shouldInitiateResolution).toBe(true);
    expect(result.shouldRehydrateCase).toBe(true);
  });
});
