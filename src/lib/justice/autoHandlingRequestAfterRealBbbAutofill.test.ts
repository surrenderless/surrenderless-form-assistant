import { describe, expect, it, vi } from "vitest";
import {
  autoRequestHandlingAfterSuccessfulRealBbbAutofill,
  buildDefaultHandlingRequestNoteAfterRealBbbAutofill,
  buildHandlingRequestAfterRealBbbAutofill,
  shouldAutoRequestHandlingAfterRealBbbAutofill,
} from "@/lib/justice/autoHandlingRequestAfterRealBbbAutofill";
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
};

const bbbCompletedAction: JusticeApprovedNextAction = {
  label: "Better Business Bureau",
  href: "/justice/bbb",
  status: "completed",
  completed_at: "2026-06-16T12:00:00.000Z",
};

describe("buildDefaultHandlingRequestNoteAfterRealBbbAutofill", () => {
  it("builds a concise case-derived note from intake", () => {
    expect(buildDefaultHandlingRequestNoteAfterRealBbbAutofill(intake)).toBe(
      "BBB complaint filed for Acme Retail (web order). Issue: online purchase. Please monitor BBB response and guide next steps."
    );
  });

  it("falls back when company name is blank", () => {
    expect(
      buildDefaultHandlingRequestNoteAfterRealBbbAutofill({ ...intake, company_name: "  " })
    ).toContain("BBB complaint filed for the merchant");
  });
});

describe("shouldAutoRequestHandlingAfterRealBbbAutofill", () => {
  it("returns true when handling has not been requested", () => {
    expect(shouldAutoRequestHandlingAfterRealBbbAutofill(stateAgAction)).toBe(true);
  });

  it("returns false when handling was already requested", () => {
    expect(
      shouldAutoRequestHandlingAfterRealBbbAutofill({
        ...stateAgAction,
        handling_requested_at: "2026-06-16T12:00:00.000Z",
      })
    ).toBe(false);
  });
});

describe("buildHandlingRequestAfterRealBbbAutofill", () => {
  it("sets handling_requested_at and default note", () => {
    const requestedAt = "2026-06-16T12:00:00.000Z";
    const { local } = buildHandlingRequestAfterRealBbbAutofill(stateAgAction, intake, requestedAt);

    expect(local.handling_requested_at).toBe(requestedAt);
    expect(local.handling_request_note).toBe(
      buildDefaultHandlingRequestNoteAfterRealBbbAutofill(intake)
    );
    expect(local.href).toBe("/justice/state-ag");
  });
});

describe("autoRequestHandlingAfterSuccessfulRealBbbAutofill", () => {
  it("persists handling request via PATCH when eligible", async () => {
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

    const result = await autoRequestHandlingAfterSuccessfulRealBbbAutofill({
      caseId: "550e8400-e29b-41d4-a716-446655440000",
      intake,
      actionAfterAdvance: bbbCompletedAction,
      fetchFn,
      applyTimeline,
    });

    expect(result.handling_requested_at?.trim()).toBeTruthy();
    expect(result.handling_request_note).toBe(
      buildDefaultHandlingRequestNoteAfterRealBbbAutofill(intake)
    );
    const patchCalls = fetchFn.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patchCalls).toHaveLength(1);
    const body = JSON.parse(String(patchCalls[0][1]?.body)) as {
      client_state?: { approved_next_action?: { handling_requested_at?: string } };
    };
    expect(body.client_state?.approved_next_action?.handling_requested_at?.trim()).toBeTruthy();
    expect(applyTimeline).toHaveBeenCalledOnce();
  });

  it("skips downstream State AG escalation step", async () => {
    const fetchFn = vi.fn();
    const result = await autoRequestHandlingAfterSuccessfulRealBbbAutofill({
      caseId: "550e8400-e29b-41d4-a716-446655440000",
      intake,
      actionAfterAdvance: stateAgAction,
      fetchFn,
    });
    expect(result).toBe(stateAgAction);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns action unchanged when handling was already requested", async () => {
    const fetchFn = vi.fn();
    const alreadyRequested = {
      ...stateAgAction,
      handling_requested_at: "2026-06-16T12:00:00.000Z",
      handling_request_note: "Existing note",
    };

    const result = await autoRequestHandlingAfterSuccessfulRealBbbAutofill({
      caseId: "550e8400-e29b-41d4-a716-446655440000",
      intake,
      actionAfterAdvance: alreadyRequested,
      fetchFn,
    });

    expect(result).toBe(alreadyRequested);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
