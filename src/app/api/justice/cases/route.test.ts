import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";

const mockInsertSingle = vi.fn();
const mockListMaybeSingle = vi.fn();
/** Captures the actual select() string the route used, so a regression that drops case_version
 * from either the create or list SELECT is caught even though the mock itself always returns it —
 * asserting only the mock's canned response would prove nothing about what the route really asked
 * Supabase for (see [id]/route.test.ts's identical rationale for mockCaseUpdatePatch). */
const capturedSelects: string[] = [];

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      if (table !== "justice_cases") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        insert: (row: Record<string, unknown>) => ({
          select: (cols: string) => {
            capturedSelects.push(cols);
            return {
              single: () => mockInsertSingle(row),
            };
          },
        }),
        select: (cols: string) => {
          capturedSelects.push(cols);
          return {
            eq: () => ({
              is: () => ({
                order: () => ({
                  range: () => mockListMaybeSingle(),
                }),
              }),
              not: () => ({
                order: () => ({
                  range: () => mockListMaybeSingle(),
                }),
              }),
            }),
          };
        },
      };
    },
  })),
}));

import { GET, POST } from "@/app/api/justice/cases/route";
import { getUserOr401 } from "@/server/requireUser";

const USER_ID = "user_test_123";
const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const intake = buildJusticeIntakeFromParts({
  ...defaultBuildJusticeIntakeParts(),
  problem_category: "online_purchase",
  company_name: "Acme Retail",
  purchase_or_signup: "widget",
  story: "Never arrived.",
  already_contacted: "no",
  user_display_name: "Jordan Lee",
  reply_email: "e2e@example.com",
});

function buildCreateRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/justice/cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function buildListRequest(qs = "") {
  return new NextRequest(`http://localhost/api/justice/cases${qs}`);
}

describe("POST /api/justice/cases (create)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    capturedSelects.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("real create response includes case_version — without this, the very first PATCH after create refuses to write (patchJusticeCaseIntake's missing_version guard)", async () => {
    mockInsertSingle.mockResolvedValue({
      data: {
        id: CASE_ID,
        intake,
        timeline: [],
        payment_dispute_draft: null,
        client_state: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        case_version: 1,
        archived_at: null,
        case_label: null,
      },
      error: null,
    });

    const res = await POST(buildCreateRequest({ intake, timeline: [] }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.case_version).toBe(1);
    // Proves the route's own .select(...) string actually asked Supabase for case_version — not
    // just that the (test-authored) mock response happens to include it.
    expect(capturedSelects.some((s) => s.includes("case_version"))).toBe(true);
  });

  it("case_version defaults to 1 for a freshly created case (matches the case_version migration's column default)", async () => {
    mockInsertSingle.mockResolvedValue({
      data: {
        id: CASE_ID,
        intake,
        timeline: [],
        payment_dispute_draft: null,
        client_state: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        case_version: 1,
        archived_at: null,
        case_label: null,
      },
      error: null,
    });

    const res = await POST(buildCreateRequest({ intake, timeline: [] }));
    const body = await res.json();
    expect(body.case_version).toBe(1);
  });
});

describe("GET /api/justice/cases (list)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    capturedSelects.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("real list response rows include case_version — without this, resuming a case via the list endpoint (fetchLatestActiveJusticeCaseRow) refuses the first subsequent PATCH", async () => {
    mockListMaybeSingle.mockResolvedValue({
      data: [
        {
          id: CASE_ID,
          intake,
          timeline: [],
          payment_dispute_draft: null,
          client_state: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          case_version: 3,
          archived_at: null,
          case_label: null,
        },
      ],
      error: null,
    });

    const res = await GET(buildListRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cases).toHaveLength(1);
    expect(body.cases[0].case_version).toBe(3);
    expect(capturedSelects.some((s) => s.includes("case_version"))).toBe(true);
  });
});
