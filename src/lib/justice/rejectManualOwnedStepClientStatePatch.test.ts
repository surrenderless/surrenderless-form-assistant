import { describe, expect, it } from "vitest";
import {
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import { demandLetterFilingTaskNotesMarker } from "@/lib/justice/demandLetterFilingTask";
import { merchantContactFilingTaskNotesMarker } from "@/lib/justice/merchantContactFilingTask";
import {
  isManualOwnedHumanFulfillmentStepProgression,
  rejectManualOwnedStepClientStatePatch,
  REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE,
} from "@/lib/justice/rejectManualOwnedStepClientStatePatch";
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

const merchantContactApproved = {
  label: "Merchant contact",
  href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  status: "approved" as const,
};

function openStateAgTask(): JusticeCaseTaskRow {
  const marker = stateAgFilingTaskNotesMarker(CASE_ID);
  return {
    id: "task-state-ag",
    user_id: "user",
    case_id: CASE_ID,
    title: "State AG filing: Acme Retail",
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
    title: "Demand letter filing: Acme Retail",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}`,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function openMerchantContactTask(): JusticeCaseTaskRow {
  const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
  return {
    id: "task-merchant-contact",
    user_id: "user",
    case_id: CASE_ID,
    title: "Merchant contact: Acme Retail",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}`,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("isManualOwnedHumanFulfillmentStepProgression", () => {
  it("detects mark-step-opened progression", () => {
    expect(
      isManualOwnedHumanFulfillmentStepProgression(stateAgApproved, {
        ...stateAgApproved,
        status: "started",
        started_at: "2026-01-02T00:00:00.000Z",
      })
    ).toBe(true);
  });

  it("detects mark-handled progression", () => {
    expect(
      isManualOwnedHumanFulfillmentStepProgression(
        { ...stateAgApproved, status: "started", started_at: "2026-01-02T00:00:00.000Z" },
        {
          ...stateAgApproved,
          status: "completed",
          completed_at: "2026-01-03T00:00:00.000Z",
        }
      )
    ).toBe(true);
  });

  it("detects href advance away from owned step", () => {
    expect(
      isManualOwnedHumanFulfillmentStepProgression(stateAgApproved, demandLetterApproved)
    ).toBe(true);
  });

  it("allows tracking-only updates with unchanged href and status", () => {
    expect(
      isManualOwnedHumanFulfillmentStepProgression(stateAgApproved, {
        ...stateAgApproved,
        outcome_note: "Awaiting operator filing.",
      })
    ).toBe(false);
  });
});

describe("rejectManualOwnedStepClientStatePatch", () => {
  it("rejects manual start when an open State AG task owns the step", () => {
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: stateAgApproved },
        incomingClientState: {
          approved_next_action: {
            ...stateAgApproved,
            status: "started",
            started_at: "2026-01-02T00:00:00.000Z",
          },
        },
        tasks: [openStateAgTask()],
        filings: [],
      })
    ).toBe(REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("allows manual progression for non-owned FTC practice steps", () => {
    const ftcPracticeApproved = {
      label: "FTC practice",
      href: "/justice/ftc-review",
      status: "approved" as const,
    };
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: ftcPracticeApproved },
        incomingClientState: {
          approved_next_action: {
            ...ftcPracticeApproved,
            status: "started",
            started_at: "2026-01-02T00:00:00.000Z",
          },
        },
        tasks: [openStateAgTask()],
        filings: [],
      })
    ).toBeNull();
  });

  it("rejects manual start when FTC escalation is owned", () => {
    const ftcApproved = {
      label: "FTC (consumer complaint)",
      href: "/justice/ftc",
      status: "approved" as const,
    };
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: ftcApproved },
        incomingClientState: {
          approved_next_action: {
            ...ftcApproved,
            status: "started",
            started_at: "2026-01-02T00:00:00.000Z",
          },
        },
        tasks: [],
        filings: [],
      })
    ).toBe(REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("rejects manual start when BBB escalation is owned", () => {
    const bbbApproved = {
      label: "Better Business Bureau",
      href: "/justice/bbb",
      status: "approved" as const,
    };
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: bbbApproved },
        incomingClientState: {
          approved_next_action: {
            ...bbbApproved,
            status: "started",
            started_at: "2026-01-02T00:00:00.000Z",
          },
        },
        tasks: [],
        filings: [],
      })
    ).toBe(REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("rejects manual completion when a confirmed demand-letter filing owns the step", () => {
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: demandLetterApproved },
        incomingClientState: {
          approved_next_action: {
            ...demandLetterApproved,
            status: "completed",
            completed_at: "2026-01-03T00:00:00.000Z",
          },
        },
        tasks: [],
        filings: [
          {
            destination: "Small claims / demand letter",
            confirmation_number: "cm-12345",
          },
        ],
      })
    ).toBe(REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("allows outcome tracking updates on an owned step without href/status change", () => {
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: stateAgApproved },
        incomingClientState: {
          approved_next_action: {
            ...stateAgApproved,
            outcome_note: "Operator queue pending.",
          },
        },
        tasks: [openStateAgTask()],
        filings: [],
      })
    ).toBeNull();
  });

  it("rejects manual start when an open demand-letter task owns the step", () => {
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: demandLetterApproved },
        incomingClientState: {
          approved_next_action: {
            ...demandLetterApproved,
            status: "started",
            started_at: "2026-01-02T00:00:00.000Z",
          },
        },
        tasks: [openDemandLetterTask()],
        filings: [],
      })
    ).toBe(REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("rejects manual start when a confirmed State AG filing owns the step", () => {
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: stateAgApproved },
        incomingClientState: {
          approved_next_action: {
            ...stateAgApproved,
            status: "started",
            started_at: "2026-01-02T00:00:00.000Z",
          },
        },
        tasks: [],
        filings: [
          {
            destination: "State Attorney General (consumer)",
            confirmation_number: "ag-12345",
          },
        ],
      })
    ).toBe(REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("rejects manual href advance away from an owned demand-letter step", () => {
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: {
          approved_next_action: {
            ...demandLetterApproved,
            status: "started",
            started_at: "2026-01-02T00:00:00.000Z",
          },
        },
        incomingClientState: { approved_next_action: stateAgApproved },
        tasks: [openDemandLetterTask()],
        filings: [],
      })
    ).toBe(REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("rejects manual start when merchant contact escalation is owned", () => {
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: merchantContactApproved },
        incomingClientState: {
          approved_next_action: {
            ...merchantContactApproved,
            status: "started",
            started_at: "2026-01-02T00:00:00.000Z",
          },
        },
        tasks: [openMerchantContactTask()],
        filings: [],
      })
    ).toBe(REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("rejects manual completion when a confirmed merchant-contact filing owns the step", () => {
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: merchantContactApproved },
        incomingClientState: {
          approved_next_action: {
            ...merchantContactApproved,
            status: "completed",
            completed_at: "2026-01-03T00:00:00.000Z",
          },
        },
        tasks: [],
        filings: [
          {
            destination: "Merchant contact",
            confirmation_number: "merchant-12345",
          },
        ],
      })
    ).toBe(REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("detects merchant contact as owned step progression", () => {
    expect(
      isManualOwnedHumanFulfillmentStepProgression(merchantContactApproved, {
        ...merchantContactApproved,
        status: "started",
        started_at: "2026-01-02T00:00:00.000Z",
      })
    ).toBe(true);
  });
});
