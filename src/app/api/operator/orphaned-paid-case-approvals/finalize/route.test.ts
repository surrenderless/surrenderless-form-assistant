import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { FinalizePaidPreparedPacketApprovalResult } from "@/lib/justice/finalizePaidPreparedPacketApproval";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { orphanedPaidCaseApprovalTaskNotesMarker } from "@/lib/justice/orphanedPaidCaseApprovalTask";

vi.mock("@/server/requireOperatorApiAccess", () => ({
  requireOperatorApiAccess: vi.fn(),
}));

const finalizeMock = vi.fn<(...args: unknown[]) => Promise<FinalizePaidPreparedPacketApprovalResult>>(
  async () => ({ status: "finalized" })
);
vi.mock("@/lib/justice/finalizePaidPreparedPacketApproval", () => ({
  finalizePaidPreparedPacketApproval: (...args: unknown[]) => finalizeMock(...args),
}));

type CaseRow = { id: string; user_id: string; intake: unknown };
type PaymentRow = { case_id: string; intended_action_href: string | null; intended_action_label: string | null; created_at: string };
type EvidenceRow = { file_name: string | null; mime_type: string | null; file_size_bytes: number | null };
type TaskRow = { id: string; case_id: string; notes: string; completed_at: string | null };

let casesStore: CaseRow[] = [];
let evidenceStore: EvidenceRow[] = [];
let paymentsStore: PaymentRow[] = [];
let tasksStore: TaskRow[] = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "justice_cases") {
        const filters: Record<string, string> = {};
        const builder = {
          select: (cols: string) => {
            (builder as { _cols?: string })._cols = cols;
            return builder;
          },
          eq: (col: string, val: string) => {
            filters[col] = val;
            return builder;
          },
          maybeSingle: async () => {
            const row = casesStore.find(
              (c) =>
                c.id === filters.id &&
                (filters.user_id === undefined || c.user_id === filters.user_id)
            );
            return { data: row ?? null, error: null };
          },
        } as { _cols?: string; select: unknown; eq: unknown; maybeSingle: unknown };
        return builder as never;
      }
      if (table === "justice_case_tasks") {
        const filters: Record<string, string> = {};
        const builder = {
          select: () => builder,
          eq: (col: string, val: string) => {
            filters[col] = val;
            return builder;
          },
          maybeSingle: async () => {
            const row = tasksStore.find(
              (t) => t.id === filters.id && t.case_id === filters.case_id
            );
            return { data: row ?? null, error: null };
          },
        };
        return builder as never;
      }
      if (table === "justice_case_evidence") {
        const builder = {
          select: () => builder,
          eq: () => builder,
          limit: async () => ({ data: evidenceStore, error: null }),
        };
        return builder as never;
      }
      if (table === "justice_case_payments") {
        let caseId: string | undefined;
        const builder = {
          select: () => builder,
          eq: (col: string, val: string) => {
            if (col === "case_id") caseId = val;
            return builder;
          },
          not: () => builder,
          order: () => builder,
          limit: async () => ({
            data: paymentsStore
              .filter((p) => p.case_id === caseId && p.intended_action_href)
              .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
            error: null,
          }),
        };
        return builder as never;
      }
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

import { POST } from "@/app/api/operator/orphaned-paid-case-approvals/finalize/route";
import { requireOperatorApiAccess } from "@/server/requireOperatorApiAccess";

const OPERATOR_ID = "operator_1";
const CASE_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "consumer_1";

function openReviewTask(): TaskRow {
  return {
    id: TASK_ID,
    case_id: CASE_ID,
    notes: `${orphanedPaidCaseApprovalTaskNotesMarker(CASE_ID)}\nreason: no_routable_destination`,
    completed_at: null,
  };
}

function contactedIntake(): unknown {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    already_contacted: "yes",
  });
}

function buildRequest(body?: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/operator/orphaned-paid-case-approvals/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("POST /api/operator/orphaned-paid-case-approvals/finalize", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(requireOperatorApiAccess).mockResolvedValue({
      ok: true,
      operatorUserId: OPERATOR_ID,
    });
    casesStore = [{ id: CASE_ID, user_id: USER_ID, intake: contactedIntake() }];
    evidenceStore = [];
    paymentsStore = [];
    tasksStore = [openReviewTask()];
    finalizeMock.mockReset().mockResolvedValue({ status: "finalized" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("requires operator authentication — rejects when requireOperatorApiAccess rejects", async () => {
    vi.mocked(requireOperatorApiAccess).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID, href: "/justice/state-ag" }));
    expect(res.status).toBe(403);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid case_id without ever calling finalize", async () => {
    const res = await POST(buildRequest({ case_id: "not-a-uuid", task_id: TASK_ID, href: "/justice/state-ag" }));
    expect(res.status).toBe(400);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("rejects a missing task_id without ever calling finalize", async () => {
    const res = await POST(buildRequest({ case_id: CASE_ID, href: "/justice/state-ag" }));
    expect(res.status).toBe(400);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("rejects a missing href without ever calling finalize", async () => {
    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID }));
    expect(res.status).toBe(400);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the case does not exist — never leaks whether an id belongs to another user beyond not-found", async () => {
    casesStore = [];
    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID, href: "/justice/state-ag" }));
    expect(res.status).toBe(404);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("rejects with 409 when no open orphaned-paid-case-approval task is bound to this case — an operator cannot finalize a case the automated system never actually flagged", async () => {
    tasksStore = [];
    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID, href: "/justice/state-ag" }));
    expect(res.status).toBe(409);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("rejects with 409 when the named task_id belongs to a different case", async () => {
    tasksStore = [{ ...openReviewTask(), case_id: "33333333-3333-4333-8333-333333333333" }];
    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID, href: "/justice/state-ag" }));
    expect(res.status).toBe(409);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("rejects with 409 when the named task is already completed", async () => {
    tasksStore = [{ ...openReviewTask(), completed_at: "2026-01-01T00:00:00.000Z" }];
    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID, href: "/justice/state-ag" }));
    expect(res.status).toBe(409);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("rejects with 409 when the named task does not match the orphaned-paid-case-approval marker (a different managed task's id reused)", async () => {
    tasksStore = [{ ...openReviewTask(), notes: "state_ag_filing_queue:" + CASE_ID }];
    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID, href: "/justice/state-ag" }));
    expect(res.status).toBe(409);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("rejects with 409 when the case's stored intake is invalid", async () => {
    casesStore = [{ id: CASE_ID, user_id: USER_ID, intake: { not: "real" } }];
    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID, href: "/justice/state-ag" }));
    expect(res.status).toBe(409);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("rejects a mismatched action: an href that is neither server-eligible nor the durable payment binding is refused with 400, and finalize is never called", async () => {
    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, href: "https://evil.example/not-a-real-route" })
    );
    expect(res.status).toBe(400);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("accepts a server-computed eligible action and finalizes with the correct case/user derived from case ownership, never from the request body", async () => {
    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID, href: "/justice/state-ag" }));
    expect(res.status).toBe(200);
    expect(finalizeMock).toHaveBeenCalledTimes(1);
    expect(finalizeMock.mock.calls[0][1]).toMatchObject({
      caseId: CASE_ID,
      userId: USER_ID,
      intendedAction: { href: "/justice/state-ag" },
    });
  });

  it("also accepts the durably-recorded payment-bound action even when it is no longer currently eligible (intake changed since checkout)", async () => {
    // merchant_response_type "resolved" downgrades every escalation destination to "later" —
    // nothing is currently eligible per a fresh recompute, but the durable binding is still a
    // legitimate, real destination for this intake and must remain selectable by an operator.
    casesStore = [
      {
        id: CASE_ID,
        user_id: USER_ID,
        intake: buildJusticeIntakeFromParts({
          ...defaultBuildJusticeIntakeParts(),
          problem_category: "online_purchase",
          company_name: "Acme Retail",
          already_contacted: "yes",
          merchant_response_type: "resolved",
        }),
      },
    ];
    paymentsStore = [
      {
        case_id: CASE_ID,
        intended_action_href: "/justice/bbb",
        intended_action_label: "Better Business Bureau (paid)",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID, href: "/justice/bbb" }));
    expect(res.status).toBe(200);
    expect(finalizeMock.mock.calls[0][1]).toMatchObject({
      intendedAction: { href: "/justice/bbb", label: "Better Business Bureau (paid)" },
    });
  });

  it("manual resolution: finalize succeeding closes the loop and returns ok", async () => {
    finalizeMock.mockResolvedValue({ status: "already_finalized" });
    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID, href: "/justice/state-ag" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: "already_finalized" });
  });

  it.each([
    ["not_paid", 409],
    ["invalid_intake", 409],
    ["invalid_action", 400],
    ["conflict_retries_exhausted", 409],
  ] as const)("maps finalize status %s to HTTP %d", async (status, expectedStatus) => {
    finalizeMock.mockResolvedValue({ status });
    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID, href: "/justice/state-ag" }));
    expect(res.status).toBe(expectedStatus);
  });

  it("maps a finalize error to a retryable 500", async () => {
    finalizeMock.mockResolvedValue({ status: "error", error: "db down" });
    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID, href: "/justice/state-ag" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("db down");
  });
});
