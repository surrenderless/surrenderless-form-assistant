import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/requireOperatorApiAccess", () => ({
  requireOperatorApiAccess: vi.fn(),
}));

vi.mock("@/lib/justice/completeSupersededLaneReviewTask", () => ({
  completeSupersededLaneReviewTask: vi.fn(),
}));

vi.mock("@/lib/justice/operatorFulfillmentQueue", () => ({
  resolveCaseOwnerUserIdForOperatorFulfillment: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({})),
}));

import { POST } from "@/app/api/justice/follow-up-response-review/complete-superseded/route";
import { requireOperatorApiAccess } from "@/server/requireOperatorApiAccess";
import { completeSupersededLaneReviewTask } from "@/lib/justice/completeSupersededLaneReviewTask";
import { resolveCaseOwnerUserIdForOperatorFulfillment } from "@/lib/justice/operatorFulfillmentQueue";

const USER_ID = "user_test_123";
const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440001";
const OWNER_HREF = "/justice/demand-letter";

function buildRequest(body?: unknown, raw?: string) {
  return new NextRequest(
    "http://localhost/api/justice/follow-up-response-review/complete-superseded",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    }
  );
}

function successResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true as const,
    task: {
      id: TASK_ID,
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Follow-up response review: Small claims / demand letter",
      due_date: null,
      notes: `superseded_lane_review:${CASE_ID}\nowner_href:${OWNER_HREF}\ndecision:response_received`,
      completed_at: "2026-07-20T00:00:00.000Z",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    },
    timeline: [],
    outcome: "response_received" as const,
    idempotent: false,
    ...overrides,
  };
}

describe("POST /api/justice/follow-up-response-review/complete-superseded", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(requireOperatorApiAccess).mockResolvedValue({
      ok: true,
      operatorUserId: USER_ID,
    } as never);
    vi.mocked(resolveCaseOwnerUserIdForOperatorFulfillment).mockResolvedValue({
      ok: true,
      userId: USER_ID,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects non-operator requests", async () => {
    vi.mocked(requireOperatorApiAccess).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as never,
    } as never);

    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, owner_href: OWNER_HREF, outcome: "response_received" })
    );

    expect(res.status).toBe(403);
    expect(completeSupersededLaneReviewTask).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const res = await POST(buildRequest(undefined, "{not json"));

    expect(res.status).toBe(400);
    expect(completeSupersededLaneReviewTask).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid case_id", async () => {
    const res = await POST(
      buildRequest({ case_id: "not-a-uuid", task_id: TASK_ID, owner_href: OWNER_HREF, outcome: "response_received" })
    );

    expect(res.status).toBe(400);
    expect(completeSupersededLaneReviewTask).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid task_id", async () => {
    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: "not-a-uuid", owner_href: OWNER_HREF, outcome: "response_received" })
    );

    expect(res.status).toBe(400);
    expect(completeSupersededLaneReviewTask).not.toHaveBeenCalled();
  });

  it("rejects an owner_href outside the supported email lanes", async () => {
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        owner_href: "/justice/bbb",
        outcome: "response_received",
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/owner_href/i);
    expect(completeSupersededLaneReviewTask).not.toHaveBeenCalled();
  });

  it("rejects an invalid outcome", async () => {
    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, owner_href: OWNER_HREF, outcome: "maybe" })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/response_received or no_response/i);
    expect(completeSupersededLaneReviewTask).not.toHaveBeenCalled();
  });

  it("rejects a non-string notes field", async () => {
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        owner_href: OWNER_HREF,
        outcome: "response_received",
        notes: 123,
      })
    );

    expect(res.status).toBe(400);
    expect(completeSupersededLaneReviewTask).not.toHaveBeenCalled();
  });

  it("delegates to completeSupersededLaneReviewTask with the resolved case-owner user id", async () => {
    vi.mocked(completeSupersededLaneReviewTask).mockResolvedValue(successResult());

    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        owner_href: OWNER_HREF,
        outcome: "response_received",
        notes: "Reply arrived by mail",
      })
    );

    expect(res.status).toBe(200);
    expect(completeSupersededLaneReviewTask).toHaveBeenCalledWith(expect.anything(), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "response_received",
      notes: "Reply arrived by mail",
    });
    const body = await res.json();
    expect(body.outcome).toBe("response_received");
  });

  it("is idempotent across repeated calls", async () => {
    vi.mocked(completeSupersededLaneReviewTask).mockResolvedValue(
      successResult({ idempotent: true })
    );

    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, owner_href: OWNER_HREF, outcome: "no_response" })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idempotent).toBe(true);
  });

  it("propagates a 400 when the task owner_href does not match", async () => {
    vi.mocked(completeSupersededLaneReviewTask).mockResolvedValue({
      ok: false,
      error: "Task does not belong to the given owner_href",
      status: 400,
    });

    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, owner_href: OWNER_HREF, outcome: "response_received" })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Task does not belong to the given owner_href");
  });

  it("fails closed when Supabase is not configured", async () => {
    vi.unstubAllEnvs();

    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, owner_href: OWNER_HREF, outcome: "response_received" })
    );

    expect(res.status).toBe(503);
    expect(completeSupersededLaneReviewTask).not.toHaveBeenCalled();
  });
});
