import { describe, expect, it, vi } from "vitest";
import {
  autoEndgameAfterManualFilingConfirmation,
  buildDefaultHandlingRequestNoteAfterManualFilingConfirmation,
  buildDefaultOutcomeNoteAfterManualFilingConfirmation,
  shouldRunManualFilingConfirmationEndgame,
} from "@/lib/justice/autoEndgameAfterManualFilingConfirmation";
import type { JusticeApprovedNextAction, JusticeIntake } from "@/lib/justice/types";

const CASE_ID = "11111111-1111-4111-8111-111111111111";

const intake: JusticeIntake = {
  company_name: "Acme Retail",
  company_website: "",
  problem_category: "online_purchase",
  story: "Unauthorized charge",
  money_involved: "$50",
  pay_or_order_date: "2026-01-01",
  order_confirmation_details: "",
  user_display_name: "User",
  reply_email: "user@example.com",
  purchase_or_signup: "web order",
  already_contacted: "no",
};

const fccStarted: JusticeApprovedNextAction = {
  label: "FCC",
  href: "/justice/fcc",
  status: "started",
  approved_at: "2026-06-15T10:00:00.000Z",
  started_at: "2026-06-15T11:00:00.000Z",
};

const cfpbStarted: JusticeApprovedNextAction = {
  label: "CFPB",
  href: "/justice/cfpb",
  status: "started",
  approved_at: "2026-06-15T10:00:00.000Z",
  started_at: "2026-06-15T11:00:00.000Z",
};

describe("buildDefaultOutcomeNoteAfterManualFilingConfirmation", () => {
  it("builds a lane-aware case-derived note", () => {
    expect(buildDefaultOutcomeNoteAfterManualFilingConfirmation(intake, fccStarted)).toBe(
      "FCC filing recorded for Acme Retail (web order). Confirmation on file. Awaiting response."
    );
  });
});

describe("buildDefaultHandlingRequestNoteAfterManualFilingConfirmation", () => {
  it("builds a lane-aware handling note", () => {
    expect(buildDefaultHandlingRequestNoteAfterManualFilingConfirmation(intake, fccStarted)).toBe(
      "FCC recorded for Acme Retail (web order). Monitor responses and guide next steps."
    );
  });
});

describe("shouldRunManualFilingConfirmationEndgame", () => {
  it("requires confirmation on file", () => {
    expect(
      shouldRunManualFilingConfirmationEndgame({
        approvedAction: fccStarted,
        caseId: CASE_ID,
        tasks: [],
        filings: [{ destination: "FCC" }],
      })
    ).toBe(false);
    expect(
      shouldRunManualFilingConfirmationEndgame({
        approvedAction: fccStarted,
        caseId: CASE_ID,
        tasks: [],
        filings: [{ destination: "FCC", confirmation_number: "FCC-1" }],
      })
    ).toBe(true);
  });

  it("skips owned State AG steps", () => {
    expect(
      shouldRunManualFilingConfirmationEndgame({
        approvedAction: {
          label: "State Attorney General (consumer)",
          href: "/justice/state-ag",
          status: "started",
        },
        caseId: CASE_ID,
        tasks: [
          {
            id: "t1",
            user_id: "user-1",
            case_id: CASE_ID,
            title: "State AG filing",
            due_date: null,
            notes: `state_ag_filing_queue:${CASE_ID}`,
            completed_at: null,
            created_at: "2026-06-15T10:00:00.000Z",
            updated_at: "2026-06-15T10:00:00.000Z",
          },
        ],
        filings: [
          {
            destination: "State Attorney General (consumer)",
            confirmation_number: "AG-1",
          },
        ],
        confirmationNumber: "AG-1",
      })
    ).toBe(false);
  });

  it("skips owned CFPB steps", () => {
    expect(
      shouldRunManualFilingConfirmationEndgame({
        approvedAction: cfpbStarted,
        caseId: CASE_ID,
        tasks: [],
        filings: [{ destination: "CFPB", confirmation_number: "CFPB-1" }],
        confirmationNumber: "CFPB-1",
      })
    ).toBe(false);
  });
});

describe("autoEndgameAfterManualFilingConfirmation", () => {
  it("completes a terminal manual lane and seeds handling, outcome, and follow-up", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ client_state: { approved_next_action: fccStarted } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          client_state: {},
          timeline: [],
        }),
      });
    const applyTimeline = vi.fn();

    const result = await autoEndgameAfterManualFilingConfirmation({
      caseId: CASE_ID,
      intake,
      approvedAction: fccStarted,
      tasks: [],
      filings: [{ destination: "FCC", confirmation_number: "FCC-99" }],
      confirmationNumber: "FCC-99",
      fetchFn: fetchFn as unknown as typeof fetch,
      applyTimeline,
    });

    expect(result.status).toBe("completed");
    expect(result.handling_requested_at?.trim()).toBeTruthy();
    expect(result.outcome_note).toContain("FCC filing recorded");
    expect(result.follow_up_needed).toBe(true);
    expect(result.handling_acknowledged_at?.trim()).toBeTruthy();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(applyTimeline).toHaveBeenCalled();
  });

  it("is a no-op without confirmation", async () => {
    const fetchFn = vi.fn();
    const result = await autoEndgameAfterManualFilingConfirmation({
      caseId: CASE_ID,
      intake,
      approvedAction: fccStarted,
      tasks: [],
      filings: [{ destination: "FCC" }],
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result).toEqual(fccStarted);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("is a no-op for owned CFPB", async () => {
    const fetchFn = vi.fn();
    const result = await autoEndgameAfterManualFilingConfirmation({
      caseId: CASE_ID,
      intake,
      approvedAction: cfpbStarted,
      tasks: [],
      filings: [{ destination: "CFPB", confirmation_number: "CFPB-99" }],
      confirmationNumber: "CFPB-99",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result).toEqual(cfpbStarted);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
