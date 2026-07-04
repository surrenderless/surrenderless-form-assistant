import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockGetUserList } = vi.hoisted(() => ({
  mockGetUserList: vi.fn(),
}));

vi.mock("@clerk/clerk-sdk-node", () => ({
  clerkClient: {
    users: {
      getUserList: mockGetUserList,
    },
  },
}));

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

import { GET as listCases, POST as createCase } from "@/app/api/justice/cases/route";
import { GET as getCase, PATCH as patchCase } from "@/app/api/justice/cases/[id]/route";
import { getUserOr401 } from "@/server/requireUser";
import {
  buildJusticeSupabaseSmokeCaseStartedTimeline,
  buildJusticeSupabaseSmokeClientState,
  buildJusticeSupabaseSmokeIntake,
  buildJusticeSupabaseSmokeRunId,
  canResolveJusticeSupabaseSmokeClerkUserIdFromE2eCredentials,
  deleteJusticeSupabaseSmokeCase,
  disablePlaywrightJusticeMockEnvForSmoke,
  extractSupabaseProjectRef,
  getJusticeSupabaseSmokeSkipReason,
  isDeployedProduction,
  isJusticeSupabaseSmokeConfigured,
  isSupabaseProjectRefAllowedForSmoke,
  isSupabaseProjectRefBlockedForSmoke,
  JUSTICE_SUPABASE_SMOKE_ALLOWED_PROJECT_REF_ENV,
  JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID_ENV,
  JUSTICE_SUPABASE_SMOKE_ENABLED_ENV,
  JUSTICE_SUPABASE_SMOKE_FORBIDDEN_PROJECT_REF_ENV,
  resolveJusticeSupabaseSmokeClerkUserId,
} from "@/lib/testing/justiceSupabaseSmoke";

const STAGING_PROJECT_REF = "staging-smoke-ref";
const STAGING_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
const SMOKE_USER_ID = "user_justice_supabase_smoke_test";
const REAL_CLERK_SECRET_KEY = "sk_test_0123456789012345678901234567890";
const E2E_EMAIL = "e2e-signed-in@example.com";

function stubJusticeSupabaseSmokeBaseEnv(): void {
  vi.stubEnv(JUSTICE_SUPABASE_SMOKE_ENABLED_ENV, "1");
  vi.stubEnv(JUSTICE_SUPABASE_SMOKE_ALLOWED_PROJECT_REF_ENV, STAGING_PROJECT_REF);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", STAGING_SUPABASE_URL);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
}

function buildJsonRequest(
  url: string,
  method: "GET" | "POST" | "PATCH",
  body?: Record<string, unknown>
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function listContainsCase(
  payload: { cases?: Array<{ id: string }> },
  caseId: string
): boolean {
  return (payload.cases ?? []).some((row) => row.id === caseId);
}

describe("justiceSupabaseSmoke gates", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockGetUserList.mockReset();
  });

  it("is disabled unless JUSTICE_SUPABASE_SMOKE_ENABLED=1", () => {
    vi.stubEnv(JUSTICE_SUPABASE_SMOKE_ALLOWED_PROJECT_REF_ENV, STAGING_PROJECT_REF);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", STAGING_SUPABASE_URL);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv(JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID_ENV, SMOKE_USER_ID);

    expect(isJusticeSupabaseSmokeConfigured()).toBe(false);

    vi.stubEnv(JUSTICE_SUPABASE_SMOKE_ENABLED_ENV, "1");
    expect(isJusticeSupabaseSmokeConfigured()).toBe(true);
  });

  it("requires JUSTICE_SUPABASE_SMOKE_ALLOWED_PROJECT_REF and matching Supabase URL", () => {
    stubJusticeSupabaseSmokeBaseEnv();
    vi.stubEnv(JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID_ENV, SMOKE_USER_ID);

    expect(isSupabaseProjectRefAllowedForSmoke(STAGING_PROJECT_REF)).toBe(true);
    expect(isJusticeSupabaseSmokeConfigured()).toBe(true);

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://other-ref.supabase.co");
    expect(isJusticeSupabaseSmokeConfigured()).toBe(false);
    expect(getJusticeSupabaseSmokeSkipReason()).toMatch(/does not match required staging ref/i);
  });

  it("refuses deployed production even when enabled", () => {
    stubJusticeSupabaseSmokeBaseEnv();
    vi.stubEnv(JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID_ENV, SMOKE_USER_ID);
    vi.stubEnv("VERCEL_ENV", "production");

    expect(isDeployedProduction()).toBe(true);
    expect(isJusticeSupabaseSmokeConfigured()).toBe(false);
    expect(getJusticeSupabaseSmokeSkipReason()).toMatch(/Refused:.*production/i);
  });

  it("refuses an explicitly forbidden Supabase project ref", () => {
    stubJusticeSupabaseSmokeBaseEnv();
    vi.stubEnv(JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID_ENV, SMOKE_USER_ID);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://prod-ref.supabase.co");
    vi.stubEnv(JUSTICE_SUPABASE_SMOKE_ALLOWED_PROJECT_REF_ENV, "prod-ref");
    vi.stubEnv(JUSTICE_SUPABASE_SMOKE_FORBIDDEN_PROJECT_REF_ENV, "prod-ref");

    expect(isSupabaseProjectRefBlockedForSmoke("prod-ref")).toBe(true);
    expect(isJusticeSupabaseSmokeConfigured()).toBe(false);
    expect(getJusticeSupabaseSmokeSkipReason()).toMatch(/blocked/i);
  });

  it("extracts Supabase project refs from hostnames", () => {
    expect(extractSupabaseProjectRef("https://abc123.supabase.co")).toBe("abc123");
    expect(extractSupabaseProjectRef("https://abc123.supabase.co/rest/v1")).toBe("abc123");
    expect(extractSupabaseProjectRef("not-a-url")).toBeNull();
  });

  it("builds unique smoke intake and roundtrip-shaped client_state", () => {
    const runId = buildJusticeSupabaseSmokeRunId();
    const intake = buildJusticeSupabaseSmokeIntake(runId);
    const caseId = "00000000-0000-4000-8000-000000000781";
    const timeline = buildJusticeSupabaseSmokeCaseStartedTimeline(caseId, runId);
    const clientState = buildJusticeSupabaseSmokeClientState(runId);

    expect(intake.company_name).toContain(runId);
    expect(timeline[0]?.case_id).toBe(caseId);
    expect(clientState.approved_next_action).toMatchObject({ status: "approved", href: "/justice/bbb" });
  });

  it("accepts Clerk E2E credentials when explicit smoke Clerk user id is unset", () => {
    stubJusticeSupabaseSmokeBaseEnv();
    vi.stubEnv("CLERK_SECRET_KEY", REAL_CLERK_SECRET_KEY);
    vi.stubEnv("E2E_CLERK_USER_EMAIL", E2E_EMAIL);

    expect(canResolveJusticeSupabaseSmokeClerkUserIdFromE2eCredentials()).toBe(true);
    expect(isJusticeSupabaseSmokeConfigured()).toBe(true);
  });

  it("returns explicit JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID without Clerk lookup", async () => {
    stubJusticeSupabaseSmokeBaseEnv();
    vi.stubEnv(JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID_ENV, SMOKE_USER_ID);

    await expect(resolveJusticeSupabaseSmokeClerkUserId()).resolves.toBe(SMOKE_USER_ID);
    expect(mockGetUserList).not.toHaveBeenCalled();
  });

  it("resolves Clerk user id from E2E email when explicit id is unset", async () => {
    stubJusticeSupabaseSmokeBaseEnv();
    vi.stubEnv("CLERK_SECRET_KEY", REAL_CLERK_SECRET_KEY);
    vi.stubEnv("E2E_CLERK_USER_EMAIL", E2E_EMAIL);
    mockGetUserList.mockResolvedValue([{ id: "user_from_clerk_lookup" }]);

    await expect(resolveJusticeSupabaseSmokeClerkUserId()).resolves.toBe("user_from_clerk_lookup");
    expect(mockGetUserList).toHaveBeenCalledWith({ emailAddress: [E2E_EMAIL], limit: 1 });
  });

  it("returns null when Clerk lookup finds no user", async () => {
    stubJusticeSupabaseSmokeBaseEnv();
    vi.stubEnv("CLERK_SECRET_KEY", REAL_CLERK_SECRET_KEY);
    vi.stubEnv("E2E_CLERK_USER_EMAIL", E2E_EMAIL);
    mockGetUserList.mockResolvedValue([]);

    await expect(resolveJusticeSupabaseSmokeClerkUserId()).resolves.toBeNull();
  });
});

describe.skipIf(!isJusticeSupabaseSmokeConfigured())("justice Supabase persistence smoke", () => {
  let clerkUserId = "";

  beforeAll(async () => {
    disablePlaywrightJusticeMockEnvForSmoke();
    const resolved = await resolveJusticeSupabaseSmokeClerkUserId();
    if (!resolved) {
      throw new Error(
        "Justice Supabase smoke is configured but Clerk user id resolution failed. Set JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID or valid CLERK_SECRET_KEY + E2E_CLERK_USER_EMAIL."
      );
    }
    clerkUserId = resolved;
  });

  beforeEach(() => {
    disablePlaywrightJusticeMockEnvForSmoke();
    vi.mocked(getUserOr401).mockReturnValue(clerkUserId);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs signed-in case create → hydrate → archive → restore via /api/justice/cases", async () => {
    const runId = buildJusticeSupabaseSmokeRunId();
    const intake = buildJusticeSupabaseSmokeIntake(runId);
    let caseId: string | null = null;

    try {
      const createRes = await createCase(
        buildJsonRequest("http://localhost/api/justice/cases", "POST", { intake })
      );
      expect(createRes.status).toBe(200);
      const created = (await createRes.json()) as { id: string; intake: { company_name: string } };
      caseId = created.id;
      expect(created.intake.company_name).toBe(intake.company_name);

      const getRes = await getCase(
        buildJsonRequest(`http://localhost/api/justice/cases/${caseId}`, "GET"),
        { params: Promise.resolve({ id: caseId }) }
      );
      expect(getRes.status).toBe(200);
      const fetched = (await getRes.json()) as { id: string; archived_at: string | null };
      expect(fetched.id).toBe(caseId);
      expect(fetched.archived_at).toBeNull();

      const timeline = buildJusticeSupabaseSmokeCaseStartedTimeline(caseId, runId);
      const clientState = buildJusticeSupabaseSmokeClientState(runId);
      const hydrateRes = await patchCase(
        buildJsonRequest(`http://localhost/api/justice/cases/${caseId}`, "PATCH", {
          timeline,
          client_state: clientState,
          case_label: `Smoke label ${runId}`,
        }),
        { params: Promise.resolve({ id: caseId }) }
      );
      expect(hydrateRes.status).toBe(200);
      const hydrated = (await hydrateRes.json()) as {
        timeline: unknown;
        client_state: Record<string, unknown>;
        case_label: string | null;
      };
      expect(hydrated.case_label).toBe(`Smoke label ${runId}`);
      expect(hydrated.client_state).toMatchObject({ approved_next_action: clientState.approved_next_action });
      expect(Array.isArray(hydrated.timeline)).toBe(true);

      const archivedAt = new Date().toISOString();
      const archiveRes = await patchCase(
        buildJsonRequest(`http://localhost/api/justice/cases/${caseId}`, "PATCH", {
          archived_at: archivedAt,
        }),
        { params: Promise.resolve({ id: caseId }) }
      );
      expect(archiveRes.status).toBe(200);
      const archived = (await archiveRes.json()) as { archived_at: string | null };
      expect(archived.archived_at).toBeTruthy();

      const archivedListRes = await listCases(
        new NextRequest("http://localhost/api/justice/cases?archived=1&limit=50")
      );
      expect(archivedListRes.status).toBe(200);
      const archivedList = (await archivedListRes.json()) as { cases: Array<{ id: string }> };
      expect(listContainsCase(archivedList, caseId)).toBe(true);

      const savedBeforeRestoreRes = await listCases(new NextRequest("http://localhost/api/justice/cases?limit=50"));
      expect(savedBeforeRestoreRes.status).toBe(200);
      const savedBeforeRestore = (await savedBeforeRestoreRes.json()) as { cases: Array<{ id: string }> };
      expect(listContainsCase(savedBeforeRestore, caseId)).toBe(false);

      const restoreRes = await patchCase(
        buildJsonRequest(`http://localhost/api/justice/cases/${caseId}`, "PATCH", {
          archived_at: null,
        }),
        { params: Promise.resolve({ id: caseId }) }
      );
      expect(restoreRes.status).toBe(200);
      const restored = (await restoreRes.json()) as { archived_at: string | null };
      expect(restored.archived_at).toBeNull();

      const savedListRes = await listCases(new NextRequest("http://localhost/api/justice/cases?limit=50"));
      expect(savedListRes.status).toBe(200);
      const savedList = (await savedListRes.json()) as { cases: Array<{ id: string }> };
      expect(listContainsCase(savedList, caseId)).toBe(true);

      const archivedAfterRestoreRes = await listCases(
        new NextRequest("http://localhost/api/justice/cases?archived=1&limit=50")
      );
      expect(archivedAfterRestoreRes.status).toBe(200);
      const archivedAfterRestore = (await archivedAfterRestoreRes.json()) as { cases: Array<{ id: string }> };
      expect(listContainsCase(archivedAfterRestore, caseId)).toBe(false);
    } finally {
      if (caseId) {
        await deleteJusticeSupabaseSmokeCase(caseId);
      }
    }
  });
});
