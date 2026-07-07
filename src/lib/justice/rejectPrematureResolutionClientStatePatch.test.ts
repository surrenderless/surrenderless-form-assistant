import { describe, expect, it } from "vitest";
import {
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import { demandLetterFilingTaskNotesMarker } from "@/lib/justice/demandLetterFilingTask";
import {
  canArchiveCaseForEscalationLadder,
  isResolutionTrackingCompleteForArchive,
} from "@/lib/justice/escalationLadderResolution";
import {
  incomingAddsPrematureResolutionTracking,
  rejectCasePatchEscalationViolations,
  rejectPrematureCaseArchivePatch,
  rejectPrematureResolutionClientStatePatch,
  REJECT_PREMATURE_CASE_ARCHIVE_PATCH_MESSAGE,
  REJECT_PREMATURE_RESOLUTION_CLIENT_STATE_PATCH_MESSAGE,
} from "@/lib/justice/rejectPrematureResolutionClientStatePatch";
import { REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE } from "@/lib/justice/rejectManualOwnedStepClientStatePatch";
import { stateAgFilingTaskNotesMarker } from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const stateAgApproved = {
  label: "State Attorney General (consumer)",
  href: MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
  status: "approved" as const,
};

const demandLetterApproved = {
  label: "Small claims / demand letter",
  href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  status: "approved" as const,
};

const demandLetterCompleted = {
  ...demandLetterApproved,
  status: "completed" as const,
  completed_at: "2026-01-03T00:00:00.000Z",
};

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

function openDemandLetterTask(): JusticeCaseTaskRow {
  const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
  return {
    id: "task-demand-letter",
    user_id: "user",
    case_id: CASE_ID,
    title: "Demand letter filing: Acme",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}`,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("incomingAddsPrematureResolutionTracking", () => {
  it("detects outcome_note changes", () => {
    expect(
      incomingAddsPrematureResolutionTracking(
        { approved_next_action: stateAgApproved },
        {
          approved_next_action: {
            ...stateAgApproved,
            outcome_note: "Premature outcome",
          },
        }
      )
    ).toBe(true);
  });

  it("detects follow-up flag changes", () => {
    expect(
      incomingAddsPrematureResolutionTracking(
        { approved_next_action: demandLetterApproved },
        {
          approved_next_action: {
            ...demandLetterApproved,
            follow_up_needed: true,
          },
        }
      )
    ).toBe(true);
  });

  it("ignores unchanged resolution fields", () => {
    const existing = {
      approved_next_action: {
        ...stateAgApproved,
        outcome_note: "Same note",
      },
    };
    expect(
      incomingAddsPrematureResolutionTracking(existing, {
        approved_next_action: {
          ...stateAgApproved,
          outcome_note: "Same note",
        },
      })
    ).toBe(false);
  });
});

describe("rejectPrematureResolutionClientStatePatch", () => {
  it("rejects outcome_note while State AG escalation is pending", () => {
    expect(
      rejectPrematureResolutionClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: stateAgApproved },
        incomingClientState: {
          approved_next_action: {
            ...stateAgApproved,
            outcome_note: "Bypass attempt",
          },
        },
        tasks: [openStateAgTask()],
      })
    ).toBe(REJECT_PREMATURE_RESOLUTION_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("rejects follow-up clear while demand-letter escalation is pending", () => {
    expect(
      rejectPrematureResolutionClientStatePatch({
        caseId: CASE_ID,
        existingClientState: {
          approved_next_action: {
            ...demandLetterApproved,
            follow_up_needed: true,
          },
        },
        incomingClientState: {
          approved_next_action: {
            ...demandLetterApproved,
            follow_up_needed: false,
          },
        },
        tasks: [openDemandLetterTask()],
      })
    ).toBe(REJECT_PREMATURE_RESOLUTION_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("allows handling_requested_at while escalation is pending", () => {
    expect(
      rejectPrematureResolutionClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: stateAgApproved },
        incomingClientState: {
          approved_next_action: {
            ...stateAgApproved,
            handling_requested_at: "2026-01-02T00:00:00.000Z",
          },
        },
        tasks: [openStateAgTask()],
      })
    ).toBeNull();
  });

  it("allows resolution updates after escalation is terminal", () => {
    expect(
      rejectPrematureResolutionClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: demandLetterCompleted },
        incomingClientState: {
          approved_next_action: {
            ...demandLetterCompleted,
            outcome_note: "Resolved after operator completion",
          },
        },
        tasks: [],
      })
    ).toBeNull();
  });
});

describe("rejectPrematureCaseArchivePatch", () => {
  it("rejects archive while State AG escalation is pending", () => {
    expect(
      rejectPrematureCaseArchivePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: stateAgApproved },
        existingArchivedAt: null,
        incomingArchivedAt: "2026-01-04T00:00:00.000Z",
        tasks: [openStateAgTask()],
      })
    ).toBe(REJECT_PREMATURE_CASE_ARCHIVE_PATCH_MESSAGE);
  });

  it("rejects archive while follow-up is still needed", () => {
    expect(
      rejectPrematureCaseArchivePatch({
        caseId: CASE_ID,
        existingClientState: {
          approved_next_action: {
            ...demandLetterCompleted,
            handling_requested_at: "2026-01-01T00:00:00.000Z",
            outcome_note: "Outcome recorded",
            handling_acknowledged_at: "2026-01-02T00:00:00.000Z",
            follow_up_needed: true,
          },
        },
        existingArchivedAt: null,
        incomingArchivedAt: "2026-01-04T00:00:00.000Z",
        tasks: [],
      })
    ).toBe(REJECT_PREMATURE_CASE_ARCHIVE_PATCH_MESSAGE);
  });

  it("allows archive when escalation is terminal and follow-up is complete", () => {
    expect(
      rejectPrematureCaseArchivePatch({
        caseId: CASE_ID,
        existingClientState: {
          approved_next_action: {
            ...demandLetterCompleted,
            handling_requested_at: "2026-01-01T00:00:00.000Z",
            outcome_note: "Outcome recorded",
            handling_acknowledged_at: "2026-01-02T00:00:00.000Z",
            follow_up_needed: false,
          },
        },
        existingArchivedAt: null,
        incomingArchivedAt: "2026-01-04T00:00:00.000Z",
        tasks: [],
      })
    ).toBeNull();
  });
});

describe("rejectCasePatchEscalationViolations", () => {
  it("still rejects owned-step progression before premature resolution checks", () => {
    expect(
      rejectCasePatchEscalationViolations({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: stateAgApproved },
        existingArchivedAt: null,
        patch: {
          client_state: {
            approved_next_action: {
              ...stateAgApproved,
              status: "started",
              started_at: "2026-01-02T00:00:00.000Z",
            },
          },
        },
        tasks: [openStateAgTask()],
        filings: [],
      })
    ).toBe(REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("rejects resolution bypass through combined validator", () => {
    expect(
      rejectCasePatchEscalationViolations({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: demandLetterApproved },
        existingArchivedAt: null,
        patch: {
          client_state: {
            approved_next_action: {
              ...demandLetterApproved,
              handling_acknowledged_at: "2026-01-03T00:00:00.000Z",
            },
          },
        },
        tasks: [openDemandLetterTask()],
        filings: [],
      })
    ).toBe(REJECT_PREMATURE_RESOLUTION_CLIENT_STATE_PATCH_MESSAGE);
  });
});

describe("canArchiveCaseForEscalationLadder", () => {
  it("blocks archive while escalation is pending", () => {
    expect(
      canArchiveCaseForEscalationLadder({
        caseId: CASE_ID,
        tasks: [openStateAgTask()],
        approvedAction: stateAgApproved,
      })
    ).toBe(false);
  });

  it("blocks archive when handling resolution is incomplete", () => {
    expect(
      canArchiveCaseForEscalationLadder({
        caseId: CASE_ID,
        tasks: [],
        approvedAction: {
          ...demandLetterCompleted,
          handling_requested_at: "2026-01-01T00:00:00.000Z",
        },
      })
    ).toBe(false);
    expect(isResolutionTrackingCompleteForArchive({
      ...demandLetterCompleted,
      handling_requested_at: "2026-01-01T00:00:00.000Z",
    })).toBe(false);
  });
});
