import { describe, expect, it } from "vitest";
import {
  CHAT_OWNED_FULFILLMENT_BBB_APPROVED_HREF,
  CHAT_OWNED_FULFILLMENT_CFPB_APPROVED_HREF,
  CHAT_OWNED_FULFILLMENT_DEMAND_LETTER_APPROVED_HREF,
  CHAT_OWNED_FULFILLMENT_DOT_APPROVED_HREF,
  CHAT_OWNED_FULFILLMENT_FCC_APPROVED_HREF,
  CHAT_OWNED_FULFILLMENT_PAYMENT_DISPUTE_APPROVED_HREF,
  CHAT_OWNED_FULFILLMENT_STATE_AG_APPROVED_HREF,
  observeChatOwnedFulfillmentCompletionSync,
  shouldRehydrateCaseAfterOwnedFulfillmentSync,
} from "@/lib/justice/chatOwnedFulfillmentCompletionSync";
import { MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
import { demandLetterFilingTaskNotesMarker } from "@/lib/justice/demandLetterFilingTask";
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

const openDemandLetterTask = {
  id: "task-demand-letter-open",
  user_id: "user",
  case_id: CASE_ID,
  title: "Demand letter",
  due_date: null,
  notes: `${demandLetterFilingTaskNotesMarker(CASE_ID)}\ncase_id: ${CASE_ID}`,
  completed_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const completedDemandLetterTask = {
  ...openDemandLetterTask,
  id: "task-demand-letter-done",
  completed_at: "2026-06-23T12:00:00.000Z",
  updated_at: "2026-06-23T12:00:00.000Z",
};

const stateAgConfirmedFilings = [
  {
    destination: "State Attorney General (consumer)",
    confirmation_number: "ag-confirmed-456",
  },
];

const demandLetterConfirmedFilings = [
  ...stateAgConfirmedFilings,
  {
    destination: "Small claims / demand letter",
    confirmation_number: "dl-confirmed-123",
  },
];

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

  it("detects demand-letter owned-step completion transition and requests rehydrate", () => {
    const pendingObservation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "Small claims / demand letter",
        href: CHAT_OWNED_FULFILLMENT_DEMAND_LETTER_APPROVED_HREF,
        status: "approved" as const,
      },
      tasks: [completedStateAgTask, openDemandLetterTask],
      filings: stateAgConfirmedFilings,
    };

    const pendingSync = observeChatOwnedFulfillmentCompletionSync({
      observation: pendingObservation,
      previousSnapshot: {
        completedStepIds: ["state_ag"],
        approvedActionHref: CHAT_OWNED_FULFILLMENT_DEMAND_LETTER_APPROVED_HREF,
      },
      wasPending: true,
    });

    expect(pendingSync.isPending).toBe(true);
    expect(pendingSync.ownedStepsNewlyCompleted).toEqual([]);
    expect(pendingSync.shouldRehydrateCase).toBe(false);

    const completedObservation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "Small claims / demand letter",
        href: CHAT_OWNED_FULFILLMENT_DEMAND_LETTER_APPROVED_HREF,
        status: "completed" as const,
        completed_at: "2026-06-23T12:00:00.000Z",
        handling_requested_at: "2026-06-23T12:05:00.000Z",
        outcome_note: "Escalation complete. Awaiting responses.",
      },
      tasks: [completedStateAgTask, completedDemandLetterTask],
      filings: demandLetterConfirmedFilings,
    };

    const completedSync = observeChatOwnedFulfillmentCompletionSync({
      observation: completedObservation,
      previousSnapshot: pendingSync.currentSnapshot,
      wasPending: true,
    });

    expect(completedSync.isPending).toBe(false);
    expect(completedSync.ownedStepsNewlyCompleted).toEqual(["demand_letter"]);
    expect(completedSync.terminalTransitioned).toBe(true);
    expect(completedSync.shouldInitiateResolution).toBe(false);
    expect(completedSync.shouldRehydrateCase).toBe(true);
    expect(shouldRehydrateCaseAfterOwnedFulfillmentSync(completedSync)).toBe(true);
    expect(completedSync.currentSnapshot.completedStepIds).toEqual(["state_ag", "demand_letter"]);
  });

  it("does not treat cold-load demand-letter completion as a live transition", () => {
    const observation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "Small claims / demand letter",
        href: CHAT_OWNED_FULFILLMENT_DEMAND_LETTER_APPROVED_HREF,
        status: "completed" as const,
        completed_at: "2026-06-23T12:00:00.000Z",
        handling_requested_at: "2026-06-23T12:05:00.000Z",
        outcome_note: "Escalation complete. Awaiting responses.",
      },
      tasks: [completedStateAgTask, completedDemandLetterTask],
      filings: demandLetterConfirmedFilings,
    };

    const result = observeChatOwnedFulfillmentCompletionSync({
      observation,
      previousSnapshot: null,
      wasPending: false,
    });

    expect(result.ownedStepsNewlyCompleted).toEqual([]);
    expect(result.approvedActionAdvanced).toBe(false);
    expect(result.shouldRehydrateCase).toBe(false);
    expect(result.currentSnapshot.completedStepIds).toEqual(["state_ag", "demand_letter"]);
  });

  it("detects CFPB owned-step completion transition and requests rehydrate", () => {
    const openCfpbTask = {
      id: "task-cfpb-open",
      user_id: "user",
      case_id: CASE_ID,
      title: "CFPB filing",
      due_date: null,
      notes: `cfpb_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
      completed_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const completedCfpbTask = {
      ...openCfpbTask,
      id: "task-cfpb-done",
      completed_at: "2026-06-22T12:00:00.000Z",
      updated_at: "2026-06-22T12:00:00.000Z",
    };
    const cfpbConfirmedFilings = [
      {
        destination: "CFPB",
        confirmation_number: "cfpb-confirmed-789",
      },
    ];

    const pendingObservation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "CFPB",
        href: CHAT_OWNED_FULFILLMENT_CFPB_APPROVED_HREF,
        status: "approved" as const,
      },
      tasks: [openCfpbTask],
      filings: [],
    };

    const pendingSync = observeChatOwnedFulfillmentCompletionSync({
      observation: pendingObservation,
      previousSnapshot: null,
      wasPending: false,
    });
    expect(pendingSync.isPending).toBe(true);
    expect(pendingSync.currentSnapshot.completedStepIds).toEqual([]);

    const completedSync = observeChatOwnedFulfillmentCompletionSync({
      observation: {
        caseId: CASE_ID,
        approvedAction: {
          label: "CFPB",
          href: CHAT_OWNED_FULFILLMENT_CFPB_APPROVED_HREF,
          status: "completed" as const,
          completed_at: "2026-06-22T12:00:00.000Z",
        },
        tasks: [completedCfpbTask],
        filings: cfpbConfirmedFilings,
      },
      previousSnapshot: pendingSync.currentSnapshot,
      wasPending: true,
    });

    expect(completedSync.ownedStepsNewlyCompleted).toEqual(["cfpb"]);
    expect(completedSync.terminalTransitioned).toBe(true);
    expect(completedSync.shouldRehydrateCase).toBe(true);
    expect(shouldRehydrateCaseAfterOwnedFulfillmentSync(completedSync)).toBe(true);
    expect(completedSync.currentSnapshot.completedStepIds).toEqual(["cfpb"]);
  });

  it("detects payment dispute owned-step completion transition and requests rehydrate", () => {
    const openPdTask = {
      id: "task-pd-open",
      user_id: "user",
      case_id: CASE_ID,
      title: "Payment dispute",
      due_date: null,
      notes: `payment_dispute_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
      completed_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const completedPdTask = {
      ...openPdTask,
      id: "task-pd-done",
      completed_at: "2026-06-22T12:00:00.000Z",
      updated_at: "2026-06-22T12:00:00.000Z",
    };
    const pdConfirmedFilings = [
      {
        destination: "Payment dispute (bank/card)",
        confirmation_number: "pd-confirmed-789",
      },
    ];

    const pendingObservation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "Payment dispute (bank/card)",
        href: CHAT_OWNED_FULFILLMENT_PAYMENT_DISPUTE_APPROVED_HREF,
        status: "approved" as const,
      },
      tasks: [openPdTask],
      filings: [],
    };

    const pendingSync = observeChatOwnedFulfillmentCompletionSync({
      observation: pendingObservation,
      previousSnapshot: null,
      wasPending: false,
    });
    expect(pendingSync.isPending).toBe(true);
    expect(pendingSync.currentSnapshot.completedStepIds).toEqual([]);

    const completedSync = observeChatOwnedFulfillmentCompletionSync({
      observation: {
        caseId: CASE_ID,
        approvedAction: {
          label: "CFPB",
          href: CHAT_OWNED_FULFILLMENT_CFPB_APPROVED_HREF,
          status: "approved" as const,
        },
        tasks: [completedPdTask],
        filings: pdConfirmedFilings,
      },
      previousSnapshot: pendingSync.currentSnapshot,
      wasPending: true,
    });

    expect(completedSync.ownedStepsNewlyCompleted).toEqual(["payment_dispute"]);
    expect(completedSync.approvedActionAdvanced).toBe(true);
    expect(completedSync.shouldRehydrateCase).toBe(true);
    expect(shouldRehydrateCaseAfterOwnedFulfillmentSync(completedSync)).toBe(true);
    expect(completedSync.currentSnapshot.completedStepIds).toEqual(["payment_dispute"]);
  });

  it("detects FCC owned-step completion transition and requests rehydrate", () => {
    const openFccTask = {
      id: "task-fcc-open",
      user_id: "user",
      case_id: CASE_ID,
      title: "FCC filing",
      due_date: null,
      notes: `fcc_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
      completed_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const completedFccTask = {
      ...openFccTask,
      id: "task-fcc-done",
      completed_at: "2026-06-22T12:00:00.000Z",
      updated_at: "2026-06-22T12:00:00.000Z",
    };
    const fccConfirmedFilings = [
      {
        destination: "FCC",
        confirmation_number: "fcc-confirmed-789",
      },
    ];

    const pendingObservation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "FCC",
        href: CHAT_OWNED_FULFILLMENT_FCC_APPROVED_HREF,
        status: "approved" as const,
      },
      tasks: [openFccTask],
      filings: [],
    };

    const pendingSync = observeChatOwnedFulfillmentCompletionSync({
      observation: pendingObservation,
      previousSnapshot: null,
      wasPending: false,
    });
    expect(pendingSync.isPending).toBe(true);
    expect(pendingSync.currentSnapshot.completedStepIds).toEqual([]);

    const completedSync = observeChatOwnedFulfillmentCompletionSync({
      observation: {
        caseId: CASE_ID,
        approvedAction: {
          label: "CFPB",
          href: CHAT_OWNED_FULFILLMENT_CFPB_APPROVED_HREF,
          status: "approved" as const,
        },
        tasks: [completedFccTask],
        filings: fccConfirmedFilings,
      },
      previousSnapshot: pendingSync.currentSnapshot,
      wasPending: true,
    });

    expect(completedSync.ownedStepsNewlyCompleted).toEqual(["fcc"]);
    expect(completedSync.approvedActionAdvanced).toBe(true);
    expect(completedSync.shouldRehydrateCase).toBe(true);
    expect(shouldRehydrateCaseAfterOwnedFulfillmentSync(completedSync)).toBe(true);
    expect(completedSync.currentSnapshot.completedStepIds).toEqual(["fcc"]);
  });

  it("detects DOT owned-step completion transition and requests rehydrate", () => {
    const openDotTask = {
      id: "task-dot-open",
      user_id: "user",
      case_id: CASE_ID,
      title: "DOT filing",
      due_date: null,
      notes: `dot_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
      completed_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const completedDotTask = {
      ...openDotTask,
      id: "task-dot-done",
      completed_at: "2026-06-22T12:00:00.000Z",
      updated_at: "2026-06-22T12:00:00.000Z",
    };
    const dotConfirmedFilings = [
      {
        destination: "USDOT / aviation consumer",
        confirmation_number: "dot-confirmed-789",
      },
    ];

    const pendingObservation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "USDOT / aviation consumer",
        href: CHAT_OWNED_FULFILLMENT_DOT_APPROVED_HREF,
        status: "approved" as const,
      },
      tasks: [openDotTask],
      filings: [],
    };

    const pendingSync = observeChatOwnedFulfillmentCompletionSync({
      observation: pendingObservation,
      previousSnapshot: null,
      wasPending: false,
    });
    expect(pendingSync.isPending).toBe(true);
    expect(pendingSync.currentSnapshot.completedStepIds).toEqual([]);

    const completedSync = observeChatOwnedFulfillmentCompletionSync({
      observation: {
        caseId: CASE_ID,
        approvedAction: {
          label: "CFPB",
          href: CHAT_OWNED_FULFILLMENT_CFPB_APPROVED_HREF,
          status: "approved" as const,
        },
        tasks: [completedDotTask],
        filings: dotConfirmedFilings,
      },
      previousSnapshot: pendingSync.currentSnapshot,
      wasPending: true,
    });

    expect(completedSync.ownedStepsNewlyCompleted).toEqual(["dot"]);
    expect(completedSync.approvedActionAdvanced).toBe(true);
    expect(completedSync.shouldRehydrateCase).toBe(true);
    expect(shouldRehydrateCaseAfterOwnedFulfillmentSync(completedSync)).toBe(true);
    expect(completedSync.currentSnapshot.completedStepIds).toEqual(["dot"]);
  });

  it("detects BBB owned-step completion transition and requests rehydrate", () => {
    const openBbbTask = {
      id: "task-bbb-open",
      user_id: "user",
      case_id: CASE_ID,
      title: "BBB filing",
      due_date: null,
      notes: `bbb_filing_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
      completed_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const completedBbbTask = {
      ...openBbbTask,
      id: "task-bbb-done",
      completed_at: "2026-06-22T12:00:00.000Z",
      updated_at: "2026-06-22T12:00:00.000Z",
    };
    const bbbConfirmedFilings = [
      {
        destination: "Better Business Bureau",
        confirmation_number: "bbb-confirmed-789",
      },
    ];

    const pendingObservation = {
      caseId: CASE_ID,
      approvedAction: {
        label: "Better Business Bureau",
        href: CHAT_OWNED_FULFILLMENT_BBB_APPROVED_HREF,
        status: "approved" as const,
      },
      tasks: [openBbbTask],
      filings: [],
    };

    const pendingSync = observeChatOwnedFulfillmentCompletionSync({
      observation: pendingObservation,
      previousSnapshot: null,
      wasPending: false,
    });
    expect(pendingSync.isPending).toBe(true);
    expect(pendingSync.currentSnapshot.completedStepIds).toEqual([]);

    const completedSync = observeChatOwnedFulfillmentCompletionSync({
      observation: {
        caseId: CASE_ID,
        approvedAction: {
          label: "State Attorney General (consumer)",
          href: CHAT_OWNED_FULFILLMENT_STATE_AG_APPROVED_HREF,
          status: "approved" as const,
        },
        tasks: [completedBbbTask],
        filings: bbbConfirmedFilings,
      },
      previousSnapshot: pendingSync.currentSnapshot,
      wasPending: true,
    });

    expect(completedSync.ownedStepsNewlyCompleted).toEqual(["bbb"]);
    expect(completedSync.approvedActionAdvanced).toBe(true);
    expect(completedSync.shouldRehydrateCase).toBe(true);
    expect(shouldRehydrateCaseAfterOwnedFulfillmentSync(completedSync)).toBe(true);
    expect(completedSync.currentSnapshot.completedStepIds).toEqual(["bbb"]);
  });
});
