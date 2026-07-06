import { describe, expect, it, vi } from "vitest";
import {
  autoInitiateOutcomeTrackingAfterSuccessfulRealBbbAutofill,
  buildDefaultFollowUpAtAfterRealBbbAutofill,
  buildDefaultOutcomeNoteAfterRealBbbAutofill,
  buildOutcomeTrackingAfterRealBbbAutofill,
  hasConfirmationOnFileForRealBbbAutofill,
  shouldAutoAcknowledgeHandlingAfterRealBbbAutofill,
  shouldAutoInitiateOutcomeTrackingAfterRealBbbAutofill,
  shouldSetDefaultOutcomeNoteAfterRealBbbAutofill,
} from "@/lib/justice/autoOutcomeTrackingAfterRealBbbAutofill";
import { REAL_BBB_COMPLAINT_FILING_CONFIRMATION } from "@/lib/justice/recordRealBbbComplaintFiling";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

const intake: JusticeIntake = {
  company_name: "Acme Retail",
  company_website: "",
  problem_category: "online_purchase",
  story: "Item never arrived",
  money_involved: "$50",
  pay_or_order_date: "2026-01-01",
  order_confirmation_details: "",
  user_display_name: "User",
  reply_email: "user@example.com",
  purchase_or_signup: "web order",
  already_contacted: "yes",
};

const stateAgAction: JusticeApprovedNextAction = {
  label: "State Attorney General (consumer)",
  href: "/justice/state-ag",
  status: "approved",
  approved_at: "2026-06-15T10:00:00.000Z",
  handling_requested_at: "2026-06-16T12:00:00.000Z",
  handling_request_note: "Prior handling note",
};

describe("buildDefaultOutcomeNoteAfterRealBbbAutofill", () => {
  it("builds a concise case-derived note from intake", () => {
    expect(buildDefaultOutcomeNoteAfterRealBbbAutofill(intake)).toBe(
      "BBB filing recorded for Acme Retail (web order). Confirmation on file. Awaiting BBB/merchant response."
    );
  });
});

describe("hasConfirmationOnFileForRealBbbAutofill", () => {
  it("returns true when confirmation number is present", () => {
    expect(hasConfirmationOnFileForRealBbbAutofill(REAL_BBB_COMPLAINT_FILING_CONFIRMATION)).toBe(
      true
    );
  });

  it("returns false when confirmation is blank", () => {
    expect(hasConfirmationOnFileForRealBbbAutofill("  ")).toBe(false);
  });
});

describe("shouldAutoAcknowledgeHandlingAfterRealBbbAutofill", () => {
  it("returns true when handling was requested and confirmation is on file", () => {
    expect(
      shouldAutoAcknowledgeHandlingAfterRealBbbAutofill(stateAgAction, true)
    ).toBe(true);
  });

  it("returns false when already acknowledged", () => {
    expect(
      shouldAutoAcknowledgeHandlingAfterRealBbbAutofill(
        { ...stateAgAction, handling_acknowledged_at: "2026-06-17T08:00:00.000Z" },
        true
      )
    ).toBe(false);
  });

  it("returns false without confirmation on file", () => {
    expect(shouldAutoAcknowledgeHandlingAfterRealBbbAutofill(stateAgAction, false)).toBe(false);
  });
});

describe("buildOutcomeTrackingAfterRealBbbAutofill", () => {
  it("sets outcome, follow-up, and acknowledgement when eligible", () => {
    const filedAt = "2026-06-16T12:00:00.000Z";
    const acknowledgedAt = "2026-06-16T12:05:00.000Z";
    const { local } = buildOutcomeTrackingAfterRealBbbAutofill(stateAgAction, intake, {
      hasConfirmationOnFile: true,
      filedAt,
      acknowledgedAt,
    });

    expect(local.outcome_note).toBe(buildDefaultOutcomeNoteAfterRealBbbAutofill(intake));
    expect(local.follow_up_needed).toBe(true);
    expect(local.follow_up_at).toBe(buildDefaultFollowUpAtAfterRealBbbAutofill(filedAt));
    expect(local.handling_acknowledged_at).toBe(acknowledgedAt);
  });

  it("preserves existing user-entered outcome and acknowledgement", () => {
    const existingNote = "User outcome note";
    const existingAck = "2026-06-10T08:00:00.000Z";
    const { local } = buildOutcomeTrackingAfterRealBbbAutofill(
      {
        ...stateAgAction,
        outcome_note: existingNote,
        handling_acknowledged_at: existingAck,
        follow_up_needed: true,
        follow_up_at: "2026-07-01T12:00:00.000Z",
      },
      intake,
      { hasConfirmationOnFile: true }
    );

    expect(local.outcome_note).toBe(existingNote);
    expect(local.handling_acknowledged_at).toBe(existingAck);
    expect(local.follow_up_at).toBe("2026-07-01T12:00:00.000Z");
  });
});

describe("shouldAutoInitiateOutcomeTrackingAfterRealBbbAutofill", () => {
  it("returns false without confirmation on file", () => {
    expect(shouldAutoInitiateOutcomeTrackingAfterRealBbbAutofill(stateAgAction, false)).toBe(
      false
    );
  });

  it("returns false when all tracking fields are already set", () => {
    expect(
      shouldAutoInitiateOutcomeTrackingAfterRealBbbAutofill(
        {
          ...stateAgAction,
          outcome_note: "Done",
          follow_up_needed: true,
          handling_acknowledged_at: "2026-06-17T08:00:00.000Z",
        },
        true
      )
    ).toBe(false);
  });
});

describe("autoInitiateOutcomeTrackingAfterSuccessfulRealBbbAutofill", () => {
  it("persists outcome tracking via PATCH when eligible", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ client_state: {} }), { status: 200 });
      }
      if (url.includes("/api/justice/cases/")) {
        return new Response(JSON.stringify({ client_state: {} }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    const applyTimeline = vi.fn();

    const result = await autoInitiateOutcomeTrackingAfterSuccessfulRealBbbAutofill({
      caseId: "550e8400-e29b-41d4-a716-446655440000",
      intake,
      actionAfterHandling: stateAgAction,
      confirmationNumber: REAL_BBB_COMPLAINT_FILING_CONFIRMATION,
      fetchFn,
      applyTimeline,
    });

    expect(result.outcome_note).toBe(buildDefaultOutcomeNoteAfterRealBbbAutofill(intake));
    expect(result.follow_up_needed).toBe(true);
    expect(result.handling_acknowledged_at?.trim()).toBeTruthy();
    const patchCalls = fetchFn.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patchCalls).toHaveLength(1);
    const body = JSON.parse(String(patchCalls[0][1]?.body)) as {
      client_state?: {
        approved_next_action?: {
          outcome_note?: string;
          handling_acknowledged_at?: string;
        };
      };
    };
    expect(body.client_state?.approved_next_action?.outcome_note?.trim()).toBeTruthy();
    expect(body.client_state?.approved_next_action?.handling_acknowledged_at?.trim()).toBeTruthy();
    expect(applyTimeline).toHaveBeenCalledOnce();
  });

  it("returns action unchanged when outcome note already exists and follow-up is set", async () => {
    const fetchFn = vi.fn();
    const alreadyTracked = {
      ...stateAgAction,
      outcome_note: "Existing outcome",
      follow_up_needed: true,
      handling_acknowledged_at: "2026-06-17T08:00:00.000Z",
    };

    const result = await autoInitiateOutcomeTrackingAfterSuccessfulRealBbbAutofill({
      caseId: "550e8400-e29b-41d4-a716-446655440000",
      intake,
      actionAfterHandling: alreadyTracked,
      confirmationNumber: REAL_BBB_COMPLAINT_FILING_CONFIRMATION,
      fetchFn,
    });

    expect(result).toBe(alreadyTracked);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("skips when confirmation is not on file", async () => {
    const fetchFn = vi.fn();

    const result = await autoInitiateOutcomeTrackingAfterSuccessfulRealBbbAutofill({
      caseId: "550e8400-e29b-41d4-a716-446655440000",
      intake,
      actionAfterHandling: stateAgAction,
      confirmationNumber: null,
      fetchFn,
    });

    expect(result).toBe(stateAgAction);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(shouldSetDefaultOutcomeNoteAfterRealBbbAutofill(result)).toBe(true);
  });
});
