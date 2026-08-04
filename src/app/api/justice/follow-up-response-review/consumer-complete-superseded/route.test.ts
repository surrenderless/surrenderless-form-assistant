import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

vi.mock("@/lib/justice/completeSupersededLaneReviewTask", () => ({
  completeSupersededLaneReviewTask: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({})),
}));

import { POST } from "@/app/api/justice/follow-up-response-review/consumer-complete-superseded/route";
import { getUserOr401 } from "@/server/requireUser";
import { completeSupersededLaneReviewTask } from "@/lib/justice/completeSupersededLaneReviewTask";

const USER_ID = "user_test_123";
const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440001";
const OWNER_HREF = "/justice/payment-dispute";

function buildRequest(body?: unknown, raw?: string) {
  return new NextRequest(
    "http://localhost/api/justice/follow-up-response-review/consumer-complete-superseded",
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
      title: "Follow-up response review: Payment dispute (bank/card)",
      due_date: null,
      notes: `superseded_lane_review:${CASE_ID}\nowner_href:${OWNER_HREF}\ndecision:no_response`,
      completed_at: "2026-07-20T00:00:00.000Z",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    },
    timeline: [],
    outcome: "no_response" as const,
    idempotent: false,
    ...overrides,
  };
}

describe("POST /api/justice/follow-up-response-review/consumer-complete-superseded", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(getUserOr401).mockReturnValue(null);

    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, owner_href: OWNER_HREF, outcome: "no_response" })
    );

    expect(res.status).toBe(401);
    expect(completeSupersededLaneReviewTask).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const res = await POST(buildRequest(undefined, "{not json"));

    expect(res.status).toBe(400);
    expect(completeSupersededLaneReviewTask).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid case_id", async () => {
    const res = await POST(
      buildRequest({ case_id: "not-a-uuid", task_id: TASK_ID, owner_href: OWNER_HREF, outcome: "no_response" })
    );

    expect(res.status).toBe(400);
    expect(completeSupersededLaneReviewTask).not.toHaveBeenCalled();
  });

  it("rejects an owner_href outside the supported email lanes", async () => {
    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, owner_href: "/justice/ftc", outcome: "no_response" })
    );

    expect(res.status).toBe(400);
    expect(completeSupersededLaneReviewTask).not.toHaveBeenCalled();
  });

  it("rejects an invalid outcome", async () => {
    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, owner_href: OWNER_HREF, outcome: "resolved" })
    );

    expect(res.status).toBe(400);
    expect(completeSupersededLaneReviewTask).not.toHaveBeenCalled();
  });

  it("delegates to completeSupersededLaneReviewTask using the authenticated user's own id — not any client-supplied id", async () => {
    vi.mocked(completeSupersededLaneReviewTask).mockResolvedValue(successResult());

    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        owner_href: OWNER_HREF,
        outcome: "no_response",
        user_id: "someone-elses-id",
      })
    );

    expect(res.status).toBe(200);
    expect(completeSupersededLaneReviewTask).toHaveBeenCalledWith(expect.anything(), USER_ID, {
      caseId: CASE_ID,
      taskId: TASK_ID,
      ownerHref: OWNER_HREF,
      outcome: "no_response",
      notes: null,
    });
  });

  it("propagates a 404 when the case/task does not belong to this user", async () => {
    vi.mocked(completeSupersededLaneReviewTask).mockResolvedValue({
      ok: false,
      error: "Not found",
      status: 404,
    });

    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, owner_href: OWNER_HREF, outcome: "no_response" })
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  it("fails closed when Supabase is not configured", async () => {
    vi.unstubAllEnvs();

    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, owner_href: OWNER_HREF, outcome: "no_response" })
    );

    expect(res.status).toBe(503);
    expect(completeSupersededLaneReviewTask).not.toHaveBeenCalled();
  });
});
