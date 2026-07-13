import { describe, expect, it } from "vitest";
import {
  MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import { bbbFilingTaskNotesMarker } from "@/lib/justice/bbbFilingTask";
import { cfpbFilingTaskNotesMarker } from "@/lib/justice/cfpbFilingTask";
import { demandLetterFilingTaskNotesMarker } from "@/lib/justice/demandLetterFilingTask";
import { dotFilingTaskNotesMarker } from "@/lib/justice/dotFilingTask";
import { fccFilingTaskNotesMarker } from "@/lib/justice/fccFilingTask";
import { paymentDisputeFilingTaskNotesMarker } from "@/lib/justice/paymentDisputeFilingTask";
import { shouldSuppressChatManualActionForSurrenderlessOwnedStep } from "@/lib/justice/surrenderlessOwnedStep";
import { stateAgFilingTaskNotesMarker } from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const stateAgAction = {
  href: MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
  label: "State Attorney General (consumer)",
} as const;

const demandLetterAction = {
  href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  label: "Small claims / demand letter",
} as const;

const cfpbAction = {
  href: MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
  label: "CFPB",
} as const;

const paymentDisputeAction = {
  href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
  label: "Payment dispute (bank/card)",
} as const;

const fccAction = {
  href: MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF,
  label: "FCC",
} as const;

const dotAction = {
  href: MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF,
  label: "USDOT / aviation consumer",
} as const;

const bbbAction = {
  href: MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
  label: "Better Business Bureau",
} as const;

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
    title: "Demand letter: Acme Retail",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}`,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function openCfpbTask(): JusticeCaseTaskRow {
  const marker = cfpbFilingTaskNotesMarker(CASE_ID);
  return {
    id: "task-cfpb",
    user_id: "user",
    case_id: CASE_ID,
    title: "CFPB filing: Acme Retail",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}`,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function openPaymentDisputeTask(): JusticeCaseTaskRow {
  const marker = paymentDisputeFilingTaskNotesMarker(CASE_ID);
  return {
    id: "task-payment-dispute",
    user_id: "user",
    case_id: CASE_ID,
    title: "Payment dispute: Acme Retail",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}`,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function openFccTask(): JusticeCaseTaskRow {
  const marker = fccFilingTaskNotesMarker(CASE_ID);
  return {
    id: "task-fcc",
    user_id: "user",
    case_id: CASE_ID,
    title: "FCC filing: Acme Wireless",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}`,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function openDotTask(): JusticeCaseTaskRow {
  const marker = dotFilingTaskNotesMarker(CASE_ID);
  return {
    id: "task-dot",
    user_id: "user",
    case_id: CASE_ID,
    title: "DOT filing: Acme Air",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}`,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function openBbbTask(): JusticeCaseTaskRow {
  const marker = bbbFilingTaskNotesMarker(CASE_ID);
  return {
    id: "task-bbb",
    user_id: "user",
    case_id: CASE_ID,
    title: "BBB filing: Acme Retail",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}`,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("shouldSuppressChatManualActionForSurrenderlessOwnedStep", () => {
  it("suppresses when an open State AG human-fulfillment task exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: stateAgAction,
        caseId: CASE_ID,
        tasks: [openStateAgTask()],
        filings: [],
      })
    ).toBe(true);
  });

  it("suppresses when a confirmed State AG filing exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: stateAgAction,
        caseId: CASE_ID,
        tasks: [],
        filings: [
          {
            destination: "State Attorney General (consumer)",
            confirmation_number: "AG-12345",
          },
        ],
      })
    ).toBe(true);
  });

  it("suppresses when State AG escalation is approved before operator tasks hydrate", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: { ...stateAgAction, status: "approved" },
        caseId: CASE_ID,
        tasks: [],
        filings: [],
      })
    ).toBe(true);
  });

  it("does not suppress when State AG filing exists without confirmation", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: stateAgAction,
        caseId: CASE_ID,
        tasks: [],
        filings: [
          {
            destination: "State Attorney General (consumer)",
            confirmation_number: null,
          },
        ],
      })
    ).toBe(false);
  });

  it("does not suppress for other approved actions", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: { href: "/justice/ftc", label: "FTC" },
        caseId: CASE_ID,
        tasks: [openStateAgTask()],
        filings: [
          {
            destination: "State Attorney General (consumer)",
            confirmation_number: "AG-12345",
          },
        ],
      })
    ).toBe(false);
  });

  it("does not suppress when task is completed and no confirmed filing", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: stateAgAction,
        caseId: CASE_ID,
        tasks: [{ ...openStateAgTask(), completed_at: "2026-01-02T00:00:00.000Z" }],
        filings: [],
      })
    ).toBe(false);
  });

  it("suppresses when an open demand letter human-fulfillment task exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: demandLetterAction,
        caseId: CASE_ID,
        tasks: [openDemandLetterTask()],
        filings: [],
      })
    ).toBe(true);
  });

  it("does not suppress demand letter when task is completed", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: demandLetterAction,
        caseId: CASE_ID,
        tasks: [{ ...openDemandLetterTask(), completed_at: "2026-01-02T00:00:00.000Z" }],
        filings: [],
      })
    ).toBe(false);
  });

  it("does not suppress demand letter for other approved actions", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: { href: "/justice/ftc", label: "FTC" },
        caseId: CASE_ID,
        tasks: [openDemandLetterTask()],
        filings: [],
      })
    ).toBe(false);
  });

  it("suppresses when a confirmed demand letter filing exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: demandLetterAction,
        caseId: CASE_ID,
        tasks: [],
        filings: [
          {
            destination: "Small claims / demand letter",
            confirmation_number: "cm-12345",
          },
        ],
      })
    ).toBe(true);
  });

  it("suppresses when demand letter escalation is approved before operator tasks hydrate", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: { ...demandLetterAction, status: "approved" },
        caseId: CASE_ID,
        tasks: [],
        filings: [],
      })
    ).toBe(true);
  });

  it("does not suppress demand letter when filing exists without confirmation", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: demandLetterAction,
        caseId: CASE_ID,
        tasks: [],
        filings: [
          {
            destination: "Small claims / demand letter",
            confirmation_number: null,
          },
        ],
      })
    ).toBe(false);
  });

  it("suppresses when an open CFPB human-fulfillment task exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: cfpbAction,
        caseId: CASE_ID,
        tasks: [openCfpbTask()],
        filings: [],
      })
    ).toBe(true);
  });

  it("suppresses when a confirmed CFPB filing exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: cfpbAction,
        caseId: CASE_ID,
        tasks: [],
        filings: [
          {
            destination: "CFPB",
            confirmation_number: "cfpb-12345",
          },
        ],
      })
    ).toBe(true);
  });

  it("suppresses when CFPB escalation is approved before operator tasks hydrate", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: { ...cfpbAction, status: "approved" },
        caseId: CASE_ID,
        tasks: [],
        filings: [],
      })
    ).toBe(true);
  });

  it("does not suppress CFPB when task is completed and no confirmed filing", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: cfpbAction,
        caseId: CASE_ID,
        tasks: [{ ...openCfpbTask(), completed_at: "2026-01-02T00:00:00.000Z" }],
        filings: [],
      })
    ).toBe(false);
  });

  it("suppresses when an open payment dispute human-fulfillment task exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: paymentDisputeAction,
        caseId: CASE_ID,
        tasks: [openPaymentDisputeTask()],
        filings: [],
      })
    ).toBe(true);
  });

  it("suppresses when a confirmed payment dispute filing exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: paymentDisputeAction,
        caseId: CASE_ID,
        tasks: [],
        filings: [
          {
            destination: "Payment dispute (bank/card)",
            confirmation_number: "pd-12345",
          },
        ],
      })
    ).toBe(true);
  });

  it("suppresses when payment dispute escalation is approved before operator tasks hydrate", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: { ...paymentDisputeAction, status: "approved" },
        caseId: CASE_ID,
        tasks: [],
        filings: [],
      })
    ).toBe(true);
  });

  it("does not suppress payment dispute when task is completed and no confirmed filing", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: paymentDisputeAction,
        caseId: CASE_ID,
        tasks: [{ ...openPaymentDisputeTask(), completed_at: "2026-01-02T00:00:00.000Z" }],
        filings: [],
      })
    ).toBe(false);
  });

  it("suppresses when an open FCC human-fulfillment task exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: fccAction,
        caseId: CASE_ID,
        tasks: [openFccTask()],
        filings: [],
      })
    ).toBe(true);
  });

  it("suppresses when a confirmed FCC filing exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: fccAction,
        caseId: CASE_ID,
        tasks: [],
        filings: [
          {
            destination: "FCC",
            confirmation_number: "fcc-12345",
          },
        ],
      })
    ).toBe(true);
  });

  it("suppresses when FCC escalation is approved before operator tasks hydrate", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: { ...fccAction, status: "approved" },
        caseId: CASE_ID,
        tasks: [],
        filings: [],
      })
    ).toBe(true);
  });

  it("does not suppress FCC when task is completed and no confirmed filing", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: fccAction,
        caseId: CASE_ID,
        tasks: [{ ...openFccTask(), completed_at: "2026-01-02T00:00:00.000Z" }],
        filings: [],
      })
    ).toBe(false);
  });

  it("suppresses when an open DOT human-fulfillment task exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: dotAction,
        caseId: CASE_ID,
        tasks: [openDotTask()],
        filings: [],
      })
    ).toBe(true);
  });

  it("suppresses when a confirmed DOT filing exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: dotAction,
        caseId: CASE_ID,
        tasks: [],
        filings: [
          {
            destination: "USDOT / aviation consumer",
            confirmation_number: "dot-12345",
          },
        ],
      })
    ).toBe(true);
  });

  it("suppresses when DOT escalation is approved before operator tasks hydrate", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: { ...dotAction, status: "approved" },
        caseId: CASE_ID,
        tasks: [],
        filings: [],
      })
    ).toBe(true);
  });

  it("does not suppress DOT when task is completed and no confirmed filing", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: dotAction,
        caseId: CASE_ID,
        tasks: [{ ...openDotTask(), completed_at: "2026-01-02T00:00:00.000Z" }],
        filings: [],
      })
    ).toBe(false);
  });

  it("suppresses when an open BBB human-fulfillment task exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: bbbAction,
        caseId: CASE_ID,
        tasks: [openBbbTask()],
        filings: [],
      })
    ).toBe(true);
  });

  it("suppresses when a confirmed BBB filing exists", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: bbbAction,
        caseId: CASE_ID,
        tasks: [],
        filings: [
          {
            destination: "Better Business Bureau",
            confirmation_number: "bbb-12345",
          },
        ],
      })
    ).toBe(true);
  });

  it("suppresses when BBB escalation is approved before operator tasks hydrate", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: { ...bbbAction, status: "approved" },
        caseId: CASE_ID,
        tasks: [],
        filings: [],
      })
    ).toBe(true);
  });

  it("does not suppress BBB when task is completed and no confirmed filing", () => {
    expect(
      shouldSuppressChatManualActionForSurrenderlessOwnedStep({
        approvedAction: bbbAction,
        caseId: CASE_ID,
        tasks: [{ ...openBbbTask(), completed_at: "2026-01-02T00:00:00.000Z" }],
        filings: [],
      })
    ).toBe(false);
  });
});
