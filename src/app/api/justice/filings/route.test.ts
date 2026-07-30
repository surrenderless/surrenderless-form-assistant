import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockCaseSelectMaybeSingle = vi.fn();
const mockFilingInsertSingle = vi.fn();
const mockTimelineSelectMaybeSingle = vi.fn();
const mockTimelineUpdate = vi.fn();

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

vi.mock("@/lib/justice/handlingRequestTask", () => ({
  completeHandlingRequestTaskIfOpen: vi.fn(async () => ({ timeline: null })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "justice_cases") {
        return {
          select: (cols: string) => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: cols === "timeline" ? mockTimelineSelectMaybeSingle : mockCaseSelectMaybeSingle,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              eq: async () => mockTimelineUpdate(patch),
            }),
          }),
        };
      }
      if (table === "justice_case_filings") {
        return {
          insert: () => ({
            select: () => ({
              single: mockFilingInsertSingle,
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  })),
}));

import { POST } from "@/app/api/justice/filings/route";
import { getUserOr401 } from "@/server/requireUser";

const USER_ID = "user_test_123";
const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function buildPostRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/justice/filings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/justice/filings destination validation", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    mockTimelineSelectMaybeSingle.mockResolvedValue({ data: { timeline: [] }, error: null });
    mockTimelineUpdate.mockResolvedValue({ error: null });
    mockFilingInsertSingle.mockResolvedValue({
      data: {
        id: "filing-1",
        user_id: USER_ID,
        case_id: CASE_ID,
        destination: "Better Business Bureau",
        filed_at: "2026-07-01",
        confirmation_number: null,
        filing_url: null,
        notes: null,
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z",
      },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("records a filing whose destination matches the case's current approved-action href", async () => {
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: {
        client_state: {
          approved_next_action: {
            href: "/justice/bbb",
            label: "Better Business Bureau",
            status: "approved",
          },
        },
      },
      error: null,
    });

    const res = await POST(
      buildPostRequest({ case_id: CASE_ID, destination: "Better Business Bureau" })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.destination).toBe("Better Business Bureau");
  });

  it("fails closed with 409 when destination does not match the case's current escalation destination", async () => {
    // Case is on BBB — a "demand letter" filing must not be accepted; this is exactly the
    // mismatch that previously let a stray filing silently resolve the wrong ladder step.
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: {
        client_state: {
          approved_next_action: {
            href: "/justice/bbb",
            label: "Better Business Bureau",
            status: "approved",
          },
        },
      },
      error: null,
    });

    const res = await POST(
      buildPostRequest({ case_id: CASE_ID, destination: "Small claims / demand letter" })
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/does not match/i);
    expect(mockFilingInsertSingle).not.toHaveBeenCalled();
  });

  it("fails closed with 409 when the case has no approved action at all", async () => {
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: { client_state: {} },
      error: null,
    });

    const res = await POST(
      buildPostRequest({ case_id: CASE_ID, destination: "Small claims / demand letter" })
    );

    expect(res.status).toBe(409);
    expect(mockFilingInsertSingle).not.toHaveBeenCalled();
  });

  it("allows an assisted mock-practice destination regardless of the approved action's href", async () => {
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: {
        client_state: {
          approved_next_action: {
            href: "/justice/demand-letter",
            label: "Small claims / demand letter",
            status: "approved",
          },
        },
      },
      error: null,
    });
    mockFilingInsertSingle.mockResolvedValue({
      data: {
        id: "filing-2",
        user_id: USER_ID,
        case_id: CASE_ID,
        destination: "BBB (practice)",
        filed_at: "2026-07-01",
        confirmation_number: null,
        filing_url: null,
        notes: null,
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z",
      },
      error: null,
    });

    const res = await POST(buildPostRequest({ case_id: CASE_ID, destination: "BBB (practice)" }));

    expect(res.status).toBe(200);
    expect(mockFilingInsertSingle).toHaveBeenCalled();
  });
});
