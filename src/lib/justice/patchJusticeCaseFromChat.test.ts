import { describe, expect, it, vi } from "vitest";
import { OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR } from "@/lib/justice/ensureOwnedFilingTaskAfterClientStateWrite";
import {
  isOwnedFilingTaskEnsureRetryableError,
  parseJusticeCaseApiError,
  patchJusticeCaseFromChat,
} from "@/lib/justice/patchJusticeCaseFromChat";
import { persistPreparedPacketApprovalToCase } from "@/lib/justice/persistPreparedPacketApprovalToCase";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const nextAction: JusticeApprovedNextAction = {
  label: "Merchant contact",
  href: "/justice/merchant",
  status: "approved",
  approved_at: "2026-07-17T12:00:00.000Z",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("patchJusticeCaseFromChat", () => {
  it("parses API error bodies", async () => {
    const res = jsonResponse(500, { error: OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR });
    expect(await parseJusticeCaseApiError(res)).toBe(OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR);
    expect(isOwnedFilingTaskEnsureRetryableError(OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR)).toBe(
      true
    );
  });

  it("retries owned-filing ensure 500 then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(500, { error: OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: CASE_ID,
          client_state: {
            prepared_packet_approved: true,
            approved_next_action: nextAction,
          },
        })
      );

    const result = await patchJusticeCaseFromChat({
      caseId: CASE_ID,
      patch: { client_state: { prepared_packet_approved: true } },
      fetchFn,
      maxAttempts: 3,
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempts).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.data.client_state).toEqual({
      prepared_packet_approved: true,
      approved_next_action: nextAction,
    });
  });

  it("stops after max attempts on owned-filing ensure failure", async () => {
    const fetchFn = vi.fn().mockImplementation(() =>
      jsonResponse(500, { error: OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR })
    );

    const result = await patchJusticeCaseFromChat({
      caseId: CASE_ID,
      patch: { client_state: { prepared_packet_approved: true } },
      fetchFn,
      maxAttempts: 3,
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryableOwnedFilingEnsure).toBe(true);
    expect(result.error).toBe(OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR);
    expect(result.attempts).toBe(3);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-owned-filing failures", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(409, { error: "Conflict" }));

    const result = await patchJusticeCaseFromChat({
      caseId: CASE_ID,
      patch: { client_state: {} },
      fetchFn,
      maxAttempts: 3,
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryableOwnedFilingEnsure).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("persistPreparedPacketApprovalToCase", () => {
  it("applies server client_state only after retry-then-success", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          client_state: { prepared_packet_approved: false },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(500, { error: OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          client_state: {
            prepared_packet_approved: true,
            approved_next_action: nextAction,
          },
          timeline: [],
        })
      );

    const result = await persistPreparedPacketApprovalToCase({
      caseId: CASE_ID,
      nextAction,
      fetchFn,
      maxAttempts: 3,
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempts).toBe(2);
    expect(result.clientState).toEqual({
      prepared_packet_approved: true,
      approved_next_action: nextAction,
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("final owned-filing failure does not report approved success", async () => {
    const fetchFn = vi.fn().mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        return jsonResponse(200, {
          client_state: { prepared_packet_approved: false },
        });
      }
      return jsonResponse(500, { error: OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR });
    });

    const result = await persistPreparedPacketApprovalToCase({
      caseId: CASE_ID,
      nextAction,
      fetchFn,
      maxAttempts: 3,
      retryDelayMs: 0,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryableOwnedFilingEnsure).toBe(true);
    expect(result.error).toBe(OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR);
    expect(result.attempts).toBe(3);
    // GET + 3 PATCH attempts
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
});
