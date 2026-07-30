import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockFilingSelectMaybeSingle = vi.fn();
const mockCaseSelectMaybeSingle = vi.fn();
const mockFilingUpdateMaybeSingle = vi.fn();

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

vi.mock("@/lib/justice/handlingRequestTask", () => ({
  completeHandlingRequestTaskIfOpen: vi.fn(async () => ({ timeline: null })),
  isFirstFilingConfirmationTransition: vi.fn(
    (before: string | null | undefined, after: string | null | undefined) =>
      !before?.trim() && Boolean(after?.trim())
  ),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "justice_case_filings") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: mockFilingSelectMaybeSingle,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: mockFilingUpdateMaybeSingle,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "justice_cases") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: mockCaseSelectMaybeSingle,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  })),
}));

import { DELETE, PATCH } from "@/app/api/justice/filings/[id]/route";
import { getUserOr401 } from "@/server/requireUser";

const USER_ID = "user_test_123";
const FILING_ID = "550e8400-e29b-41d4-a716-446655440000";
const CASE_ID = "550e8400-e29b-41d4-a716-446655440001";

function buildRequest(method: "PATCH" | "DELETE", body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/justice/filings/${FILING_ID}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function routeContext() {
  return { params: Promise.resolve({ id: FILING_ID }) };
}

describe("PATCH/DELETE /api/justice/filings/[id] destination-integrity protection", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("allows PATCH when the resulting destination matches the case's current approved-action href", async () => {
    mockFilingSelectMaybeSingle.mockResolvedValue({
      data: { confirmation_number: null, destination: "Better Business Bureau", case_id: CASE_ID },
      error: null,
    });
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: {
        client_state: {
          approved_next_action: { href: "/justice/bbb", label: "Better Business Bureau", status: "approved" },
        },
      },
      error: null,
    });
    mockFilingUpdateMaybeSingle.mockResolvedValue({
      data: {
        id: FILING_ID,
        user_id: USER_ID,
        case_id: CASE_ID,
        destination: "Better Business Bureau",
        filed_at: "2026-07-01",
        confirmation_number: "BBB-123",
        filing_url: null,
        notes: null,
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z",
      },
      error: null,
    });

    const res = await PATCH(
      buildRequest("PATCH", { confirmation_number: "BBB-123" }),
      routeContext()
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confirmation_number).toBe("BBB-123");
  });

  it("fails closed when PATCHing a filing's destination to something other than the case's current escalation destination", async () => {
    // Case is on BBB — attempting to relabel this filing as the demand-letter destination
    // must not be allowed to fabricate resolution proof for the wrong step.
    mockFilingSelectMaybeSingle.mockResolvedValue({
      data: { confirmation_number: null, destination: "Better Business Bureau", case_id: CASE_ID },
      error: null,
    });
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: {
        client_state: {
          approved_next_action: { href: "/justice/bbb", label: "Better Business Bureau", status: "approved" },
        },
      },
      error: null,
    });

    const res = await PATCH(
      buildRequest("PATCH", { destination: "Small claims / demand letter", confirmation_number: "dl-1" }),
      routeContext()
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/does not match/i);
    expect(mockFilingUpdateMaybeSingle).not.toHaveBeenCalled();
  });

  it("fails closed when the filing's existing (unchanged) destination no longer matches the case's current step", async () => {
    // Even without touching destination, adding a confirmation_number to a stale filing row
    // must not succeed once the case has moved on to a different escalation step.
    mockFilingSelectMaybeSingle.mockResolvedValue({
      data: {
        confirmation_number: null,
        destination: "Small claims / demand letter",
        case_id: CASE_ID,
      },
      error: null,
    });
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: {
        client_state: {
          approved_next_action: { href: "/justice/bbb", label: "Better Business Bureau", status: "approved" },
        },
      },
      error: null,
    });

    const res = await PATCH(buildRequest("PATCH", { confirmation_number: "dl-1" }), routeContext());

    expect(res.status).toBe(409);
    expect(mockFilingUpdateMaybeSingle).not.toHaveBeenCalled();
  });

  it("blocks DELETE unconditionally — filing records are durable and never consumer-deletable", async () => {
    const res = await DELETE(buildRequest("DELETE"), routeContext());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/cannot be deleted/i);
    expect(mockFilingSelectMaybeSingle).not.toHaveBeenCalled();
  });
});
