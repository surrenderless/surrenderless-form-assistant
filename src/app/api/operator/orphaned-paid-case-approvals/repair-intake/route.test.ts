import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";

vi.mock("@/server/requireOperatorApiAccess", () => ({
  requireOperatorApiAccess: vi.fn(),
}));

let casesStore: { id: string; user_id: string }[] = [];
const mockRpc = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "justice_cases") {
        const filters: Record<string, string> = {};
        const builder = {
          select: () => builder,
          eq: (col: string, val: string) => {
            filters[col] = val;
            return builder;
          },
          maybeSingle: async () => {
            const row = casesStore.find((c) => c.id === filters.id);
            return { data: row ?? null, error: null };
          },
        };
        return builder as never;
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
  })),
}));

import {
  POST,
  REPAIR_INTAKE_CONFLICT_ERROR,
  REPAIR_INTAKE_TASK_CONFLICT_ERROR,
} from "@/app/api/operator/orphaned-paid-case-approvals/repair-intake/route";
import { requireOperatorApiAccess } from "@/server/requireOperatorApiAccess";

const OPERATOR_ID = "operator_1";
const CASE_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "consumer_1";
const EXPECTED_CASE_VERSION = 3;

function validIntake(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    already_contacted: "yes",
    ...overrides,
  });
}

function buildRequest(body?: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/operator/orphaned-paid-case-approvals/repair-intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("POST /api/operator/orphaned-paid-case-approvals/repair-intake", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(requireOperatorApiAccess).mockResolvedValue({
      ok: true,
      operatorUserId: OPERATOR_ID,
    });
    casesStore = [{ id: CASE_ID, user_id: USER_ID }];
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({
      data: {
        status: "applied",
        case_version: EXPECTED_CASE_VERSION + 1,
        case_intake: {},
        audit_event_id: "audit-1",
      },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("requires operator authentication", async () => {
    vi.mocked(requireOperatorApiAccess).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_case_version: EXPECTED_CASE_VERSION,
      })
    );
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid case_id", async () => {
    const res = await POST(
      buildRequest({
        case_id: "not-a-uuid",
        task_id: TASK_ID,
        intake: validIntake(),
        expected_case_version: EXPECTED_CASE_VERSION,
      })
    );
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a missing task_id", async () => {
    const res = await POST(
      buildRequest({ case_id: CASE_ID, intake: validIntake(), expected_case_version: EXPECTED_CASE_VERSION })
    );
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a missing or invalid expected_case_version", async () => {
    const missing = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID, intake: validIntake() }));
    expect(missing.status).toBe(400);

    const notANumber = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_case_version: "not-a-number",
      })
    );
    expect(notANumber.status).toBe(400);

    const negative = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_case_version: -1,
      })
    );
    expect(negative.status).toBe(400);

    const nonInteger = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_case_version: 1.5,
      })
    );
    expect(nonInteger.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a corrected intake that is still invalid, without ever calling the RPC", async () => {
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: { still: "broken" },
        expected_case_version: EXPECTED_CASE_VERSION,
      })
    );
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 404 when the case does not exist for this owner (resolved before the RPC is ever called)", async () => {
    casesStore = [];
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_case_version: EXPECTED_CASE_VERSION,
      })
    );
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("calls the atomic RPC with the operator actor, case/task ids, expected token, and corrected intake", async () => {
    const intake = validIntake();
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake,
        expected_case_version: EXPECTED_CASE_VERSION,
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith("repair_orphaned_paid_case_approval_intake", {
      p_case_id: CASE_ID,
      p_task_id: TASK_ID,
      p_user_id: USER_ID,
      p_expected_case_version: EXPECTED_CASE_VERSION,
      p_new_intake: intake,
      p_actor: OPERATOR_ID,
    });
  });

  it("maps RPC status 'already_applied' to 200 ok (idempotent retry / no-op)", async () => {
    mockRpc.mockResolvedValue({ data: { status: "already_applied" }, error: null });
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_case_version: EXPECTED_CASE_VERSION,
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("maps RPC status 'conflict' to 409 with the concurrency error message", async () => {
    mockRpc.mockResolvedValue({ data: { status: "conflict" }, error: null });
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_case_version: EXPECTED_CASE_VERSION,
      })
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: REPAIR_INTAKE_CONFLICT_ERROR });
  });

  it("maps RPC status 'task_conflict' to 409 with the task-binding error message", async () => {
    mockRpc.mockResolvedValue({ data: { status: "task_conflict" }, error: null });
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_case_version: EXPECTED_CASE_VERSION,
      })
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: REPAIR_INTAKE_TASK_CONFLICT_ERROR });
  });

  it("maps RPC status 'not_found' to 404", async () => {
    mockRpc.mockResolvedValue({ data: { status: "not_found" }, error: null });
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_case_version: EXPECTED_CASE_VERSION,
      })
    );
    expect(res.status).toBe(404);
  });

  it("returns 500 when the RPC call itself errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "db exploded" } });
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_case_version: EXPECTED_CASE_VERSION,
      })
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db exploded" });
  });
});
