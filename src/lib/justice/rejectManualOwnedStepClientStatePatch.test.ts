import { describe, expect, it } from "vitest";
import {
  MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
  MERCHANT_RESOLVED_TERMINAL_HREF,
  MERCHANT_RESOLVED_TERMINAL_LABEL,
} from "@/lib/justice/handlingTrackingProgress";
import { cfpbFilingTaskNotesMarker } from "@/lib/justice/cfpbFilingTask";
import { demandLetterFilingTaskNotesMarker } from "@/lib/justice/demandLetterFilingTask";
import { merchantContactFilingTaskNotesMarker } from "@/lib/justice/merchantContactFilingTask";
import {
  isAllowedMerchantResolvedTerminalClientStatePatch,
  isManualOwnedHumanFulfillmentStepProgression,
  rejectManualOwnedStepClientStatePatch,
  REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE,
} from "@/lib/justice/rejectManualOwnedStepClientStatePatch";
import { stateAgFilingTaskNotesMarker } from "@/lib/justice/stateAgFilingTask";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake(overrides: Partial<JusticeIntake> = {}): JusticeIntake {
  return {
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    company_website: "",
    purchase_or_signup: "widget",
    story: "Never arrived.",
    money_involved: "$50",
    pay_or_order_date: "2026-01-01",
    order_confirmation_details: "",
    user_display_name: "Jordan Lee",
    reply_email: "jordan@example.com",
    already_contacted: "no",
    ...overrides,
  };
}

const resolvedIntake = baseIntake({
  already_contacted: "yes",
  contact_method: "email",
  contact_date: "2026-01-15",
  merchant_response_type: "resolved",
  contact_proof_type: "paste",
  contact_proof_text: "Refund confirmed by email",
});

const merchantResolvedTerminalCompleted = {
  label: MERCHANT_RESOLVED_TERMINAL_LABEL,
  href: MERCHANT_RESOLVED_TERMINAL_HREF,
  status: "completed" as const,
  approved_at: "2026-01-16T00:00:00.000Z",
  completed_at: "2026-01-16T00:00:00.000Z",
};

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

describe("isAllowedMerchantResolvedTerminalClientStatePatch", () => {
  it("allows the verified /justice/merchant -> merchant-resolved transition when intake confirms resolved with complete documentation", () => {
    expect(
      isAllowedMerchantResolvedTerminalClientStatePatch(
        merchantContactApproved,
        merchantResolvedTerminalCompleted,
        resolvedIntake,
        false
      )
    ).toBe(true);
  });

  it("rejects when the intake does not actually confirm the resolved outcome (wrong merchant_response_type)", () => {
    const notResolvedIntake = baseIntake({
      already_contacted: "yes",
      contact_method: "email",
      contact_date: "2026-01-15",
      merchant_response_type: "refused_help",
      contact_proof_type: "paste",
      contact_proof_text: "No refund offered",
    });
    expect(
      isAllowedMerchantResolvedTerminalClientStatePatch(
        merchantContactApproved,
        merchantResolvedTerminalCompleted,
        notResolvedIntake,
        false
      )
    ).toBe(false);
  });

  it("rejects when already_contacted is not yes, even if merchant_response_type says resolved", () => {
    const notActuallyContactedIntake = baseIntake({
      already_contacted: "no",
      merchant_response_type: "resolved",
      contact_date: "2026-01-15",
      contact_method: "email",
      contact_proof_type: "paste",
      contact_proof_text: "Refund confirmed",
    });
    expect(
      isAllowedMerchantResolvedTerminalClientStatePatch(
        merchantContactApproved,
        merchantResolvedTerminalCompleted,
        notActuallyContactedIntake,
        false
      )
    ).toBe(false);
  });

  it("rejects when no intake is available at all", () => {
    expect(
      isAllowedMerchantResolvedTerminalClientStatePatch(
        merchantContactApproved,
        merchantResolvedTerminalCompleted,
        null,
        false
      )
    ).toBe(false);
  });

  it("rejects incomplete documentation: missing contact date", () => {
    const missingDateIntake = baseIntake({
      already_contacted: "yes",
      merchant_response_type: "resolved",
      contact_method: "email",
      contact_date: "",
      contact_proof_type: "paste",
      contact_proof_text: "Refund confirmed by email",
    });
    expect(
      isAllowedMerchantResolvedTerminalClientStatePatch(
        merchantContactApproved,
        merchantResolvedTerminalCompleted,
        missingDateIntake,
        false
      )
    ).toBe(false);
  });

  it("rejects incomplete documentation: missing contact_method (required field absent)", () => {
    const missingMethodIntake = baseIntake({
      already_contacted: "yes",
      merchant_response_type: "resolved",
      contact_date: "2026-01-15",
      contact_proof_type: "paste",
      contact_proof_text: "Refund confirmed by email",
    });
    expect(
      isAllowedMerchantResolvedTerminalClientStatePatch(
        merchantContactApproved,
        merchantResolvedTerminalCompleted,
        missingMethodIntake,
        false
      )
    ).toBe(false);
  });

  it("rejects invalid/empty proof text for a 'paste' proof type", () => {
    const emptyProofIntake = baseIntake({
      already_contacted: "yes",
      merchant_response_type: "resolved",
      contact_method: "email",
      contact_date: "2026-01-15",
      contact_proof_type: "paste",
      contact_proof_text: "",
    });
    expect(
      isAllowedMerchantResolvedTerminalClientStatePatch(
        merchantContactApproved,
        merchantResolvedTerminalCompleted,
        emptyProofIntake,
        false
      )
    ).toBe(false);
  });

  it("rejects invalid/empty proof text for a 'ticket' proof type", () => {
    const emptyTicketIntake = baseIntake({
      already_contacted: "yes",
      merchant_response_type: "resolved",
      contact_method: "email",
      contact_date: "2026-01-15",
      contact_proof_type: "ticket",
      contact_proof_text: "  ",
    });
    expect(
      isAllowedMerchantResolvedTerminalClientStatePatch(
        merchantContactApproved,
        merchantResolvedTerminalCompleted,
        emptyTicketIntake,
        false
      )
    ).toBe(false);
  });

  it("rejects an 'upload' proof type when no real evidence file is on the case", () => {
    const uploadProofIntake = baseIntake({
      already_contacted: "yes",
      merchant_response_type: "resolved",
      contact_method: "email",
      contact_date: "2026-01-15",
      contact_proof_type: "upload",
    });
    expect(
      isAllowedMerchantResolvedTerminalClientStatePatch(
        merchantContactApproved,
        merchantResolvedTerminalCompleted,
        uploadProofIntake,
        false
      )
    ).toBe(false);
  });

  it("allows an 'upload' proof type once a real evidence file is confirmed on the case", () => {
    const uploadProofIntake = baseIntake({
      already_contacted: "yes",
      merchant_response_type: "resolved",
      contact_method: "email",
      contact_date: "2026-01-15",
      contact_proof_type: "upload",
    });
    expect(
      isAllowedMerchantResolvedTerminalClientStatePatch(
        merchantContactApproved,
        merchantResolvedTerminalCompleted,
        uploadProofIntake,
        true
      )
    ).toBe(true);
  });

  it("rejects for an unrelated owned existing action (CFPB) even when incoming looks like the terminal action and intake confirms resolved — no other owned step can borrow this exception", () => {
    const cfpbApproved = {
      label: "CFPB",
      href: MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
      status: "approved" as const,
    };
    expect(
      isAllowedMerchantResolvedTerminalClientStatePatch(
        cfpbApproved,
        merchantResolvedTerminalCompleted,
        resolvedIntake,
        false
      )
    ).toBe(false);
  });

  it("rejects for an unrelated owned existing action (BBB)", () => {
    const bbbApproved = {
      label: "Better Business Bureau",
      href: "/justice/bbb",
      status: "approved" as const,
    };
    expect(
      isAllowedMerchantResolvedTerminalClientStatePatch(
        bbbApproved,
        merchantResolvedTerminalCompleted,
        resolvedIntake,
        false
      )
    ).toBe(false);
  });

  it("rejects for an unrelated owned existing action (State AG)", () => {
    expect(
      isAllowedMerchantResolvedTerminalClientStatePatch(
        stateAgApproved,
        merchantResolvedTerminalCompleted,
        resolvedIntake,
        false
      )
    ).toBe(false);
  });

  it("rejects when the incoming action isn't exactly the terminal href", () => {
    expect(
      isAllowedMerchantResolvedTerminalClientStatePatch(
        merchantContactApproved,
        { ...merchantContactApproved, status: "completed", completed_at: "2026-01-16T00:00:00.000Z" },
        resolvedIntake,
        false
      )
    ).toBe(false);
  });

  it("rejects when the incoming terminal action isn't status completed", () => {
    expect(
      isAllowedMerchantResolvedTerminalClientStatePatch(
        merchantContactApproved,
        { ...merchantResolvedTerminalCompleted, status: "approved" },
        resolvedIntake,
        false
      )
    ).toBe(false);
  });
});

describe("rejectManualOwnedStepClientStatePatch — merchant-resolved terminal exception", () => {
  it("permits the transition from an OPEN owned merchant-contact task straight to the merchant-resolved terminal action when intake confirms resolved", () => {
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: merchantContactApproved },
        incomingClientState: { approved_next_action: merchantResolvedTerminalCompleted },
        tasks: [openMerchantContactTask()],
        filings: [],
        intake: resolvedIntake,
      })
    ).toBeNull();
  });

  it("permits the same transition when the owned merchant-contact task is already completed (idempotent replay)", () => {
    const completedMerchantContactTask: JusticeCaseTaskRow = {
      ...openMerchantContactTask(),
      completed_at: "2026-01-16T00:00:00.000Z",
    };
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: merchantResolvedTerminalCompleted },
        incomingClientState: { approved_next_action: merchantResolvedTerminalCompleted },
        tasks: [completedMerchantContactTask],
        filings: [],
        intake: resolvedIntake,
      })
    ).toBeNull();
  });

  it("still rejects the transition when intake does not confirm the resolved outcome, even with the exact terminal client_state and no intake passed", () => {
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: merchantContactApproved },
        incomingClientState: { approved_next_action: merchantResolvedTerminalCompleted },
        tasks: [openMerchantContactTask()],
        filings: [],
        // intake omitted — server could not load an authoritative intake, so the exception must
        // not fire and the ordinary owned-step guard (open task owns the step) still applies.
      })
    ).toBe(REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("still rejects (open task owns the step) when intake's merchant_response_type is wrong, even with an otherwise well-formed report", () => {
    const wrongOutcomeIntake = baseIntake({
      already_contacted: "yes",
      contact_method: "email",
      contact_date: "2026-01-15",
      merchant_response_type: "partial_help",
      contact_proof_type: "paste",
      contact_proof_text: "Partial refund only",
    });
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: merchantContactApproved },
        incomingClientState: { approved_next_action: merchantResolvedTerminalCompleted },
        tasks: [openMerchantContactTask()],
        filings: [],
        intake: wrongOutcomeIntake,
      })
    ).toBe(REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("still rejects (open task owns the step) when documentation is incomplete (no contact proof text for a 'paste' proof type)", () => {
    const incompleteIntake = baseIntake({
      already_contacted: "yes",
      contact_method: "email",
      contact_date: "2026-01-15",
      merchant_response_type: "resolved",
      contact_proof_type: "paste",
      contact_proof_text: "",
    });
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: merchantContactApproved },
        incomingClientState: { approved_next_action: merchantResolvedTerminalCompleted },
        tasks: [openMerchantContactTask()],
        filings: [],
        intake: incompleteIntake,
      })
    ).toBe(REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("still rejects (open task owns the step) when the declared proof type is 'upload' but no real evidence file is on the case", () => {
    const unverifiedUploadIntake = baseIntake({
      already_contacted: "yes",
      contact_method: "email",
      contact_date: "2026-01-15",
      merchant_response_type: "resolved",
      contact_proof_type: "upload",
    });
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: merchantContactApproved },
        incomingClientState: { approved_next_action: merchantResolvedTerminalCompleted },
        tasks: [openMerchantContactTask()],
        filings: [],
        intake: unverifiedUploadIntake,
        hasUploadedEvidenceFile: false,
      })
    ).toBe(REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE);
  });

  it("permits the transition for an 'upload' proof type once hasUploadedEvidenceFile is true", () => {
    const verifiedUploadIntake = baseIntake({
      already_contacted: "yes",
      contact_method: "email",
      contact_date: "2026-01-15",
      merchant_response_type: "resolved",
      contact_proof_type: "upload",
    });
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: merchantContactApproved },
        incomingClientState: { approved_next_action: merchantResolvedTerminalCompleted },
        tasks: [openMerchantContactTask()],
        filings: [],
        intake: verifiedUploadIntake,
        hasUploadedEvidenceFile: true,
      })
    ).toBeNull();
  });

  it("does not let an unrelated owned action (CFPB, with an open task) use this exception, even if intake happens to confirm merchant-resolved", () => {
    const cfpbApproved = {
      label: "CFPB",
      href: MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
      status: "approved" as const,
    };
    const openCfpbTask: JusticeCaseTaskRow = {
      id: "task-cfpb",
      user_id: "user",
      case_id: CASE_ID,
      title: "CFPB filing: Acme Retail",
      due_date: null,
      notes: cfpbFilingTaskNotesMarker(CASE_ID),
      completed_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    expect(
      rejectManualOwnedStepClientStatePatch({
        caseId: CASE_ID,
        existingClientState: { approved_next_action: cfpbApproved },
        incomingClientState: {
          approved_next_action: { ...cfpbApproved, status: "completed", completed_at: "2026-01-16T00:00:00.000Z" },
        },
        tasks: [openCfpbTask],
        filings: [],
        intake: resolvedIntake,
      })
    ).toBe(REJECT_MANUAL_OWNED_STEP_CLIENT_STATE_PATCH_MESSAGE);
  });
});
