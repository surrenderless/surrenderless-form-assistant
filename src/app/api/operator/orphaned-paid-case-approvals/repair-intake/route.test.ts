import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { orphanedPaidCaseApprovalTaskNotesMarker } from "@/lib/justice/orphanedPaidCaseApprovalTask";

vi.mock("@/server/requireOperatorApiAccess", () => ({
  requireOperatorApiAccess: vi.fn(),
}));

type CaseRow = { id: string; user_id: string; intake: unknown };
type TaskRow = { id: string; case_id: string; notes: string; completed_at: string | null };

let casesStore: CaseRow[] = [];
let tasksStore: TaskRow[] = [];
let timelineAppended: unknown[] = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "justice_cases") {
        const filters: Record<string, string> = {};
        let updatePayload: Record<string, unknown> | undefined;
        const builder = {
          select: () => builder,
          eq: (col: string, val: string) => {
            filters[col] = val;
            return builder;
          },
          update: (payload: Record<string, unknown>) => {
            updatePayload = payload;
            return builder;
          },
          maybeSingle: async () => {
            const row = casesStore.find(
              (c) =>
                c.id === filters.id &&
                (filters.user_id === undefined || c.user_id === filters.user_id)
            );
            if (!row) return { data: null, error: null };
            if (updatePayload) Object.assign(row, updatePayload);
            return { data: { ...row }, error: null };
          },
        } as {
          select: unknown;
          eq: unknown;
          update: unknown;
          maybeSingle: unknown;
        };
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
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: vi.fn(async (...args: unknown[]) => {
    timelineAppended.push(args);
    return [];
  }),
}));

import { POST } from "@/app/api/operator/orphaned-paid-case-approvals/repair-intake/route";
import { requireOperatorApiAccess } from "@/server/requireOperatorApiAccess";

const OPERATOR_ID = "operator_1";
const CASE_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "consumer_1";

function validIntake(): unknown {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    already_contacted: "yes",
  });
}

function openReviewTask(): TaskRow {
  return {
    id: TASK_ID,
    case_id: CASE_ID,
    notes: `${orphanedPaidCaseApprovalTaskNotesMarker(CASE_ID)}\nreason: invalid_intake`,
    completed_at: null,
  };
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
    casesStore = [{ id: CASE_ID, user_id: USER_ID, intake: { not: "a real intake" } }];
    tasksStore = [openReviewTask()];
    timelineAppended = [];
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
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, intake: validIntake() })
    );
    expect(res.status).toBe(403);
    expect(casesStore[0]?.intake).toEqual({ not: "a real intake" });
  });

  it("rejects an invalid case_id", async () => {
    const res = await POST(
      buildRequest({ case_id: "not-a-uuid", task_id: TASK_ID, intake: validIntake() })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a missing task_id", async () => {
    const res = await POST(buildRequest({ case_id: CASE_ID, intake: validIntake() }));
    expect(res.status).toBe(400);
  });

  it("rejects a corrected intake that is still invalid, without writing anything", async () => {
    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, intake: { still: "broken" } })
    );
    expect(res.status).toBe(400);
    expect(casesStore[0]?.intake).toEqual({ not: "a real intake" });
  });

  it("rejects with 409 when no open orphaned-paid-case-approval task is bound to this case", async () => {
    tasksStore = [];
    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, intake: validIntake() })
    );
    expect(res.status).toBe(409);
    expect(casesStore[0]?.intake).toEqual({ not: "a real intake" });
  });

  it("rejects with 409 when the named task belongs to a different case", async () => {
    tasksStore = [{ ...openReviewTask(), case_id: "33333333-3333-4333-8333-333333333333" }];
    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, intake: validIntake() })
    );
    expect(res.status).toBe(409);
  });

  it("rejects with 409 when the named task is already completed", async () => {
    tasksStore = [{ ...openReviewTask(), completed_at: "2026-01-01T00:00:00.000Z" }];
    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, intake: validIntake() })
    );
    expect(res.status).toBe(409);
  });

  it("rejects with 409 when the named task does not match the orphaned-paid-case-approval marker", async () => {
    tasksStore = [{ ...openReviewTask(), notes: `state_ag_filing_queue:${CASE_ID}` }];
    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, intake: validIntake() })
    );
    expect(res.status).toBe(409);
  });

  it("saves a corrected, valid intake and records a timeline entry — does not touch client_state or the review task itself", async () => {
    const corrected = validIntake();
    const res = await POST(buildRequest({ case_id: CASE_ID, task_id: TASK_ID, intake: corrected }));
    expect(res.status).toBe(200);
    expect(casesStore[0]?.intake).toEqual(corrected);
    expect(timelineAppended).toHaveLength(1);
    // The review task itself is untouched by this endpoint — closing it is finalize's job.
    expect(tasksStore[0]?.completed_at).toBeNull();
  });

  it("returns 404 when the case does not exist for this owner", async () => {
    casesStore = [];
    const res = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, intake: validIntake() })
    );
    expect(res.status).toBe(404);
  });
});
