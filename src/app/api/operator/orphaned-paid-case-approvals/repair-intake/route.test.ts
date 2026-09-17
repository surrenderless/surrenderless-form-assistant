import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { orphanedPaidCaseApprovalTaskNotesMarker } from "@/lib/justice/orphanedPaidCaseApprovalTask";

vi.mock("@/server/requireOperatorApiAccess", () => ({
  requireOperatorApiAccess: vi.fn(),
}));

type CaseRow = { id: string; user_id: string; intake: unknown; updated_at: string };
type TaskRow = { id: string; case_id: string; notes: string; completed_at: string | null };

let casesStore: CaseRow[] = [];
let tasksStore: TaskRow[] = [];
let timelineAppended: unknown[][] = [];
let timelineShouldFail = false;
let updatedAtCounter = 0;

function bumpUpdatedAt(): string {
  updatedAtCounter += 1;
  return new Date(Date.parse("2026-08-01T00:00:00.000Z") + updatedAtCounter * 1000).toISOString();
}

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
                (filters.user_id === undefined || c.user_id === filters.user_id) &&
                (filters.updated_at === undefined || c.updated_at === filters.updated_at)
            );
            if (!row) return { data: null, error: null };
            if (updatePayload) {
              Object.assign(row, updatePayload);
              // Real justice_cases has a BEFORE UPDATE trigger that stamps updated_at on every
              // write — simulate that so a stale expected_updated_at genuinely CAS-misses on any
              // later real write, exactly like production.
              row.updated_at = bumpUpdatedAt();
            }
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
    if (timelineShouldFail) return null;
    return [];
  }),
}));

import { POST } from "@/app/api/operator/orphaned-paid-case-approvals/repair-intake/route";
import { requireOperatorApiAccess } from "@/server/requireOperatorApiAccess";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const OPERATOR_ID = "operator_1";
const CASE_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "consumer_1";
const INITIAL_UPDATED_AT = "2026-08-01T00:00:00.000Z";

function validIntake(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    already_contacted: "yes",
    ...overrides,
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
    casesStore = [
      { id: CASE_ID, user_id: USER_ID, intake: { not: "a real intake" }, updated_at: INITIAL_UPDATED_AT },
    ];
    tasksStore = [openReviewTask()];
    timelineAppended = [];
    timelineShouldFail = false;
    updatedAtCounter = 0;
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
        expected_updated_at: INITIAL_UPDATED_AT,
      })
    );
    expect(res.status).toBe(403);
    expect(casesStore[0]?.intake).toEqual({ not: "a real intake" });
  });

  it("rejects an invalid case_id", async () => {
    const res = await POST(
      buildRequest({
        case_id: "not-a-uuid",
        task_id: TASK_ID,
        intake: validIntake(),
        expected_updated_at: INITIAL_UPDATED_AT,
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a missing task_id", async () => {
    const res = await POST(
      buildRequest({ case_id: CASE_ID, intake: validIntake(), expected_updated_at: INITIAL_UPDATED_AT })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a missing or invalid expected_updated_at", async () => {
    const missing = await POST(
      buildRequest({ case_id: CASE_ID, task_id: TASK_ID, intake: validIntake() })
    );
    expect(missing.status).toBe(400);

    const malformed = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_updated_at: "not-a-date",
      })
    );
    expect(malformed.status).toBe(400);
  });

  it("rejects a corrected intake that is still invalid, without writing anything", async () => {
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: { still: "broken" },
        expected_updated_at: INITIAL_UPDATED_AT,
      })
    );
    expect(res.status).toBe(400);
    expect(casesStore[0]?.intake).toEqual({ not: "a real intake" });
  });

  it("rejects with 409 when no open orphaned-paid-case-approval task is bound to this case", async () => {
    tasksStore = [];
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_updated_at: INITIAL_UPDATED_AT,
      })
    );
    expect(res.status).toBe(409);
    expect(casesStore[0]?.intake).toEqual({ not: "a real intake" });
  });

  it("rejects with 409 when the named task belongs to a different case", async () => {
    tasksStore = [{ ...openReviewTask(), case_id: "33333333-3333-4333-8333-333333333333" }];
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_updated_at: INITIAL_UPDATED_AT,
      })
    );
    expect(res.status).toBe(409);
  });

  it("rejects with 409 when the named task is already completed", async () => {
    tasksStore = [{ ...openReviewTask(), completed_at: "2026-01-01T00:00:00.000Z" }];
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_updated_at: INITIAL_UPDATED_AT,
      })
    );
    expect(res.status).toBe(409);
  });

  it("rejects with 409 when the named task does not match the orphaned-paid-case-approval marker", async () => {
    tasksStore = [{ ...openReviewTask(), notes: `state_ag_filing_queue:${CASE_ID}` }];
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_updated_at: INITIAL_UPDATED_AT,
      })
    );
    expect(res.status).toBe(409);
  });

  it("saves a corrected, valid intake and records a timeline entry — does not touch client_state or the review task itself", async () => {
    const corrected = validIntake();
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: corrected,
        expected_updated_at: INITIAL_UPDATED_AT,
      })
    );
    expect(res.status).toBe(200);
    expect(casesStore[0]?.intake).toEqual(corrected);
    expect(timelineAppended).toHaveLength(1);
    // The review task itself is untouched by this endpoint — closing it is finalize's job.
    expect(tasksStore[0]?.completed_at).toBeNull();
  });

  it("returns 404 when the case does not exist for this owner", async () => {
    casesStore = [];
    const res = await POST(
      buildRequest({
        case_id: CASE_ID,
        task_id: TASK_ID,
        intake: validIntake(),
        expected_updated_at: INITIAL_UPDATED_AT,
      })
    );
    expect(res.status).toBe(404);
  });

  describe("concurrency (updated_at CAS protection)", () => {
    it("a genuinely conflicting concurrent edit returns 409 and never overwrites the winner's write", async () => {
      const winnerIntake = validIntake({ company_name: "Winner Co" });
      const loserIntake = validIntake({ company_name: "Loser Co" });

      // Both operators loaded the case at the same initial updated_at.
      const winner = await POST(
        buildRequest({
          case_id: CASE_ID,
          task_id: TASK_ID,
          intake: winnerIntake,
          expected_updated_at: INITIAL_UPDATED_AT,
        })
      );
      expect(winner.status).toBe(200);

      // The loser submits a DIFFERENT correction against the same stale updated_at.
      const loser = await POST(
        buildRequest({
          case_id: CASE_ID,
          task_id: TASK_ID,
          intake: loserIntake,
          expected_updated_at: INITIAL_UPDATED_AT,
        })
      );
      expect(loser.status).toBe(409);
      const body = await loser.json();
      expect(body.error).toMatch(/updated concurrently/i);

      // The winner's write is intact — never silently overwritten by the loser.
      expect(casesStore[0]?.intake).toEqual(winnerIntake);
    });

    it("an identical retry against a now-stale updated_at is idempotent, not a conflict", async () => {
      const intake = validIntake();

      const first = await POST(
        buildRequest({
          case_id: CASE_ID,
          task_id: TASK_ID,
          intake,
          expected_updated_at: INITIAL_UPDATED_AT,
        })
      );
      expect(first.status).toBe(200);
      const updatedAtAfterFirst = casesStore[0]?.updated_at;
      expect(updatedAtAfterFirst).not.toBe(INITIAL_UPDATED_AT);

      // Client retries with the SAME content but the ORIGINAL (now stale) expected_updated_at —
      // e.g. it never received the first response due to a network failure.
      const retry = await POST(
        buildRequest({
          case_id: CASE_ID,
          task_id: TASK_ID,
          intake,
          expected_updated_at: INITIAL_UPDATED_AT,
        })
      );
      expect(retry.status).toBe(200);
      expect(casesStore[0]?.intake).toEqual(intake);
      // The retry did not perform a second write (content already matched, so the CAS write was
      // skipped entirely) — only one real update happened.
      expect(casesStore[0]?.updated_at).toBe(updatedAtAfterFirst);
    });

    it("submitting the exact current intake unchanged is a no-op success, not an error", async () => {
      casesStore[0]!.intake = validIntake();
      const same = casesStore[0]!.intake;
      const res = await POST(
        buildRequest({
          case_id: CASE_ID,
          task_id: TASK_ID,
          intake: same,
          expected_updated_at: INITIAL_UPDATED_AT,
        })
      );
      expect(res.status).toBe(200);
    });
  });

  describe("durable audit trail", () => {
    it("returns an error (not a fabricated success) when the timeline write fails, even though the intake was already saved", async () => {
      timelineShouldFail = true;
      const corrected = validIntake();
      const res = await POST(
        buildRequest({
          case_id: CASE_ID,
          task_id: TASK_ID,
          intake: corrected,
          expected_updated_at: INITIAL_UPDATED_AT,
        })
      );
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toMatch(/audit trail/i);
      // The intake write itself already durably happened.
      expect(casesStore[0]?.intake).toEqual(corrected);
    });

    it("a retry after a timeline failure completes the missing audit without re-writing the intake or touching newer data", async () => {
      timelineShouldFail = true;
      const corrected = validIntake();
      const first = await POST(
        buildRequest({
          case_id: CASE_ID,
          task_id: TASK_ID,
          intake: corrected,
          expected_updated_at: INITIAL_UPDATED_AT,
        })
      );
      expect(first.status).toBe(500);
      const updatedAtAfterFirst = casesStore[0]?.updated_at;

      timelineShouldFail = false;
      const retry = await POST(
        buildRequest({
          case_id: CASE_ID,
          task_id: TASK_ID,
          intake: corrected,
          expected_updated_at: INITIAL_UPDATED_AT, // the client still only knows the ORIGINAL value
        })
      );
      expect(retry.status).toBe(200);
      // No second write to intake — updated_at is unchanged from the first (successful) attempt.
      expect(casesStore[0]?.updated_at).toBe(updatedAtAfterFirst);
      expect(casesStore[0]?.intake).toEqual(corrected);
    });

    it("uses the exact same deterministic timeline entry id on every attempt for the same task, never a timestamp-based id", async () => {
      timelineShouldFail = true;
      const corrected = validIntake();
      await POST(
        buildRequest({
          case_id: CASE_ID,
          task_id: TASK_ID,
          intake: corrected,
          expected_updated_at: INITIAL_UPDATED_AT,
        })
      );
      timelineShouldFail = false;
      await POST(
        buildRequest({
          case_id: CASE_ID,
          task_id: TASK_ID,
          intake: corrected,
          expected_updated_at: INITIAL_UPDATED_AT,
        })
      );

      expect(appendCaseTimelineEntry).toHaveBeenCalledTimes(2);
      const firstCallEntry = vi.mocked(appendCaseTimelineEntry).mock.calls[0]?.[3] as { id: string };
      const secondCallEntry = vi.mocked(appendCaseTimelineEntry).mock.calls[1]?.[3] as { id: string };
      expect(firstCallEntry.id).toBe(secondCallEntry.id);
      expect(firstCallEntry.id).toBe(`orphaned_paid_case_approval_intake_repaired:${TASK_ID}`);
    });
  });
});
