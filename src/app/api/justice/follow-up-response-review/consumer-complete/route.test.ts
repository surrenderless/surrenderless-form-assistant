import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { JusticeIntake } from "@/lib/justice/types";

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

vi.mock("@/lib/justice/completeFollowUpResponseReview", () => ({
  completeFollowUpResponseReview: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({})),
}));

import { POST } from "@/app/api/justice/follow-up-response-review/consumer-complete/route";
import { getUserOr401 } from "@/server/requireUser";
import { completeFollowUpResponseReview } from "@/lib/justice/completeFollowUpResponseReview";

const USER_ID = "user_test_123";
const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440001";

function buildRequest(body?: unknown, raw?: string) {
  return new NextRequest("http://localhost/api/justice/follow-up-response-review/consumer-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
}

function successResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true as const,
    task: {
      id: TASK_ID,
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Follow-up response review",
      due_date: null,
      notes: "follow_up_response_review",
      completed_at: "2026-07-20T00:00:00.000Z",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    },
    clientState: { approved_next_action: { status: "completed" } },
    intake: { company_name: "Acme" } as JusticeIntake,
    timeline: [],
    outcome: "resolved" as const,
    advanced: false,
    idempotent: false,
    archived: false as const,
    ...overrides,
  };
}

describe("POST /api/justice/follow-up-response-review/consumer-complete", () => {
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

    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID, outcome: "resolved" }));

    expect(res.status).toBe(401);
    expect(completeFollowUpResponseReview).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const res = await POST(buildRequest(undefined, "{not json"));

    expect(res.status).toBe(400);
    expect(completeFollowUpResponseReview).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid case_id", async () => {
    const res = await POST(buildRequest({ case_id: "not-a-uuid", task_id: TASK_ID, outcome: "resolved" }));

    expect(res.status).toBe(400);
    expect(completeFollowUpResponseReview).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid task_id", async () => {
    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: "not-a-uuid", outcome: "resolved" }));

    expect(res.status).toBe(400);
    expect(completeFollowUpResponseReview).not.toHaveBeenCalled();
  });

  it("rejects an invalid outcome", async () => {
    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, outcome: "maybe" })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/resolved or no_resolution/i);
    expect(completeFollowUpResponseReview).not.toHaveBeenCalled();
  });

  it("rejects further_escalation — that outcome stays operator-only", async () => {
    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, outcome: "further_escalation" })
    );

    expect(res.status).toBe(400);
    expect(completeFollowUpResponseReview).not.toHaveBeenCalled();
  });

  it("rejects a non-string notes field", async () => {
    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, outcome: "resolved", notes: 123 })
    );

    expect(res.status).toBe(400);
    expect(completeFollowUpResponseReview).not.toHaveBeenCalled();
  });

  it("delegates to completeFollowUpResponseReview using the authenticated user's own id — not any client-supplied id", async () => {
    vi.mocked(completeFollowUpResponseReview).mockResolvedValue(successResult());

    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        outcome: "resolved",
        notes: "Got a refund",
        user_id: "someone-elses-id",
      })
    );

    expect(res.status).toBe(200);
    expect(completeFollowUpResponseReview).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      { caseId: CASE_ID, taskId: TASK_ID, outcome: "resolved", notes: "Got a refund" }
    );
  });

  it("accepts no_resolution and returns the mapped response shape", async () => {
    vi.mocked(completeFollowUpResponseReview).mockResolvedValue(
      successResult({ outcome: "no_resolution" as const })
    );

    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, outcome: "no_resolution" })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("no_resolution");
    expect(body.archived).toBe(false);
    expect(body.task).toMatchObject({ id: TASK_ID });
  });

  it("is idempotent across repeated calls", async () => {
    vi.mocked(completeFollowUpResponseReview).mockResolvedValue(
      successResult({ idempotent: true })
    );

    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, outcome: "resolved" })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idempotent).toBe(true);
  });

  it("propagates a 404 when the case/task does not belong to this user", async () => {
    // completeFollowUpResponseReview scopes every query by user_id, so a foreign case_id/task_id
    // simply resolves as not-found — this is the cross-user protection boundary.
    vi.mocked(completeFollowUpResponseReview).mockResolvedValue({
      ok: false,
      error: "Not found",
      status: 404,
    });

    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, outcome: "resolved" })
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  it("propagates other business-logic errors from completeFollowUpResponseReview", async () => {
    vi.mocked(completeFollowUpResponseReview).mockResolvedValue({
      ok: false,
      error: "Task is not a follow-up response review",
      status: 400,
    });

    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, outcome: "no_resolution" })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Task is not a follow-up response review");
  });

  it("fails closed when Supabase is not configured", async () => {
    vi.unstubAllEnvs();

    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, outcome: "resolved" })
    );

    expect(res.status).toBe(503);
    expect(completeFollowUpResponseReview).not.toHaveBeenCalled();
  });
});
