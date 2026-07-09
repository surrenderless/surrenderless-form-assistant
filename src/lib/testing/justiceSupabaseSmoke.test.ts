import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
import {
  GET as listChatMessages,
  POST as appendChatMessages,
} from "@/app/api/justice/chat-messages/route";
import { getUserOr401 } from "@/server/requireUser";
import {
  assertJusticeSupabaseSmokeConnectivityPreflight,
  assertJusticeSupabaseSmokeStrictRunIntegrationExecuted,
  buildJusticeSupabaseSmokeCaseStartedTimeline,
  buildJusticeSupabaseSmokeChatTurns,
  buildJusticeSupabaseSmokeClientState,
  buildJusticeSupabaseSmokeIntake,
  buildJusticeSupabaseSmokeIntruderClerkUserId,
  buildJusticeSupabaseSmokeRunId,
  canResolveJusticeSupabaseSmokeClerkUserIdFromE2eCredentials,
  deleteJusticeSupabaseSmokeCase,
  disablePlaywrightJusticeMockEnvForSmoke,
  extractSupabaseProjectRef,
  getJusticeSupabaseSmokeSkipReason,
  getJusticeSupabaseSmokeStrictRunFailureReason,
  getJusticeSupabaseSmokeStrictRunIntegrationFailureReason,
  isDeployedProduction,
  isJusticeSupabaseSmokeConfigured,
  isJusticeSupabaseSmokeStrictRun,
  isSupabaseProjectRefAllowedForSmoke,
  isSupabaseProjectRefBlockedForSmoke,
  JUSTICE_SUPABASE_SMOKE_ALLOWED_PROJECT_REF_ENV,
  JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID_ENV,
  JUSTICE_SUPABASE_SMOKE_ENABLED_ENV,
  JUSTICE_SUPABASE_SMOKE_FORBIDDEN_PROJECT_REF_ENV,
  JUSTICE_SUPABASE_SMOKE_INTEGRATION_CHAT_MESSAGES_TEST_NAME,
  JUSTICE_SUPABASE_SMOKE_INTEGRATION_DESCRIBE_NAME,
  JUSTICE_SUPABASE_SMOKE_INTEGRATION_LIFECYCLE_TEST_NAME,
  JUSTICE_SUPABASE_SMOKE_STRICT_RUN_ENV,
  listJusticeSupabaseSmokeCaseChatMessagesAdmin,
  markJusticeSupabaseSmokeIntegrationChatMessagesExecuted,
  markJusticeSupabaseSmokeIntegrationLifecycleExecuted,
  markJusticeSupabaseSmokeIntegrationTestExecuted,
  resetJusticeSupabaseSmokeIntegrationExecutionMarker,
  resetJusticeSupabaseSmokeIntegrationExecutionMarkerPath,
  resolveJusticeSupabaseSmokeClerkUserId,
  runJusticeSupabaseSmokeConnectivityPreflight,
  setJusticeSupabaseSmokeIntegrationExecutionMarkerPath,
  validateJusticeSupabaseSmokeProjectRefAllowlist,
  wasJusticeSupabaseSmokeIntegrationChatMessagesExecuted,
  wasJusticeSupabaseSmokeIntegrationLifecycleExecuted,
  wasJusticeSupabaseSmokeIntegrationTestExecuted,
} from "@/lib/testing/justiceSupabaseSmoke";

const STAGING_PROJECT_REF = "staging-smoke-ref";
const STAGING_SUPABASE_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;
const SMOKE_USER_ID = "user_justice_supabase_smoke_test";
const REAL_CLERK_SECRET_KEY = "sk_test_0123456789012345678901234567890";
const E2E_EMAIL = "e2e-signed-in@example.com";

function withTemporaryIntegrationExecutionMarker<T>(run: () => T): T {
  const markerPath = path.join(
    os.tmpdir(),
    `justice-supabase-smoke-marker-${process.pid}-${Date.now()}.tmp`
  );
  setJusticeSupabaseSmokeIntegrationExecutionMarkerPath(markerPath);
  resetJusticeSupabaseSmokeIntegrationExecutionMarker();
  try {
    return run();
  } finally {
    resetJusticeSupabaseSmokeIntegrationExecutionMarker();
    resetJusticeSupabaseSmokeIntegrationExecutionMarkerPath();
    try {
      fs.unlinkSync(markerPath);
    } catch {
      /* ignore missing marker file */
    }
  }
}

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
    expect(clientState.approved_next_action).toBeUndefined();
    expect(clientState.smoke_persistence_marker).toBe(runId);
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

  it("returns a strict-run failure reason when dedicated mode is enabled but smoke is not configured", () => {
    vi.stubEnv(JUSTICE_SUPABASE_SMOKE_STRICT_RUN_ENV, "1");
    expect(isJusticeSupabaseSmokeStrictRun()).toBe(true);
    expect(isJusticeSupabaseSmokeConfigured()).toBe(false);
    expect(getJusticeSupabaseSmokeStrictRunFailureReason()).toMatch(/Skipped:|Refused:/);
  });

  it("does not require strict-run configuration during default unit test runs", () => {
    expect(isJusticeSupabaseSmokeStrictRun()).toBe(false);
    expect(getJusticeSupabaseSmokeStrictRunFailureReason()).toBeNull();
    expect(getJusticeSupabaseSmokeStrictRunIntegrationFailureReason()).toBeNull();
    expect(isJusticeSupabaseSmokeConfigured()).toBe(false);
  });

  it("requires strict run to record all real integration test executions", () => {
    withTemporaryIntegrationExecutionMarker(() => {
      stubJusticeSupabaseSmokeBaseEnv();
      vi.stubEnv(JUSTICE_SUPABASE_SMOKE_STRICT_RUN_ENV, "1");
      vi.stubEnv(JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID_ENV, SMOKE_USER_ID);

      expect(wasJusticeSupabaseSmokeIntegrationLifecycleExecuted()).toBe(false);
      expect(wasJusticeSupabaseSmokeIntegrationChatMessagesExecuted()).toBe(false);
      expect(getJusticeSupabaseSmokeStrictRunIntegrationFailureReason()).toMatch(
        /missing integration tests/i
      );
      expect(() => assertJusticeSupabaseSmokeStrictRunIntegrationExecuted()).toThrow(
        /missing integration tests/i
      );

      markJusticeSupabaseSmokeIntegrationLifecycleExecuted();
      expect(wasJusticeSupabaseSmokeIntegrationLifecycleExecuted()).toBe(true);
      expect(getJusticeSupabaseSmokeStrictRunIntegrationFailureReason()).toMatch(
        JUSTICE_SUPABASE_SMOKE_INTEGRATION_CHAT_MESSAGES_TEST_NAME
      );

      markJusticeSupabaseSmokeIntegrationChatMessagesExecuted();
      expect(wasJusticeSupabaseSmokeIntegrationChatMessagesExecuted()).toBe(true);
      expect(getJusticeSupabaseSmokeStrictRunIntegrationFailureReason()).toBeNull();
      expect(() => assertJusticeSupabaseSmokeStrictRunIntegrationExecuted()).not.toThrow();
    });
  });

  it("tracks arbitrary integration test names in the execution marker", () => {
    withTemporaryIntegrationExecutionMarker(() => {
      const customName = "custom integration test";
      expect(wasJusticeSupabaseSmokeIntegrationTestExecuted(customName)).toBe(false);
      markJusticeSupabaseSmokeIntegrationTestExecuted(customName);
      expect(wasJusticeSupabaseSmokeIntegrationTestExecuted(customName)).toBe(true);
    });
  });

  it("does not enforce integration execution outside strict dedicated smoke runs", () => {
    withTemporaryIntegrationExecutionMarker(() => {
      stubJusticeSupabaseSmokeBaseEnv();
      vi.stubEnv(JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID_ENV, SMOKE_USER_ID);

      expect(getJusticeSupabaseSmokeStrictRunIntegrationFailureReason()).toBeNull();
      expect(() => assertJusticeSupabaseSmokeStrictRunIntegrationExecuted()).not.toThrow();
    });
  });

  it("validates allowlist preflight success and mismatch failure", () => {
    stubJusticeSupabaseSmokeBaseEnv();
    expect(validateJusticeSupabaseSmokeProjectRefAllowlist()).toEqual({
      ok: true,
      projectRef: STAGING_PROJECT_REF,
    });

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://other-ref.supabase.co");
    expect(validateJusticeSupabaseSmokeProjectRefAllowlist()).toEqual({
      ok: false,
      error: expect.stringMatching(/does not match required staging ref/i),
    });
  });

  it("preflight succeeds when allowlist matches and justice_cases query succeeds", async () => {
    stubJusticeSupabaseSmokeBaseEnv();
    const mockLimit = vi.fn().mockResolvedValue({ error: null, data: [] });
    const mockSelect = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    const result = await runJusticeSupabaseSmokeConnectivityPreflight(() => ({
      from: mockFrom,
    }));

    expect(result).toEqual({ ok: true, projectRef: STAGING_PROJECT_REF });
    expect(mockFrom).toHaveBeenCalledWith("justice_cases");
    expect(mockFrom).toHaveBeenCalledWith("justice_case_chat_messages");
    expect(mockSelect).toHaveBeenCalledWith("id");
    expect(mockLimit).toHaveBeenCalledWith(1);
  });

  it("preflight fails before lifecycle writes when justice_case_chat_messages query fails", async () => {
    stubJusticeSupabaseSmokeBaseEnv();
    const mockLimit = vi
      .fn()
      .mockResolvedValueOnce({ error: null, data: [] })
      .mockResolvedValueOnce({ error: { message: "relation does not exist" }, data: null });
    const mockSelect = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    const result = await runJusticeSupabaseSmokeConnectivityPreflight(() => ({
      from: mockFrom,
    }));

    expect(result).toEqual({
      ok: false,
      error:
        "Supabase justice_case_chat_messages preflight query failed: relation does not exist. Apply supabase/migrations/20260708120000_justice_case_chat_messages.sql.",
    });
  });

  it("preflight fails before lifecycle writes when justice_cases query fails", async () => {
    stubJusticeSupabaseSmokeBaseEnv();
    const mockLimit = vi.fn().mockResolvedValue({ error: { message: "permission denied" }, data: null });
    const mockSelect = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    const result = await runJusticeSupabaseSmokeConnectivityPreflight(() => ({
      from: mockFrom,
    }));

    expect(result).toEqual({
      ok: false,
      error: "Supabase justice_cases preflight query failed: permission denied",
    });

    await expect(
      assertJusticeSupabaseSmokeConnectivityPreflight(() => ({
        from: mockFrom,
      }))
    ).rejects.toThrow(/preflight query failed: permission denied/);
  });
});

describe.skipIf(!isJusticeSupabaseSmokeConfigured())(JUSTICE_SUPABASE_SMOKE_INTEGRATION_DESCRIBE_NAME, () => {
  let clerkUserId = "";

  beforeAll(async () => {
    disablePlaywrightJusticeMockEnvForSmoke();
    await assertJusticeSupabaseSmokeConnectivityPreflight();

    const explicit = process.env.JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID?.trim();
    if (explicit) {
      clerkUserId = explicit;
      return;
    }

    const email =
      process.env.E2E_CLERK_USER_EMAIL?.trim() ||
      process.env.E2E_CLERK_USER_USERNAME?.trim() ||
      "";
    if (email) {
      const { clerkClient } = await vi.importActual<typeof import("@clerk/clerk-sdk-node")>(
        "@clerk/clerk-sdk-node"
      );
      const users = await clerkClient.users.getUserList({ emailAddress: [email], limit: 1 });
      const resolved = Array.isArray(users) ? users[0]?.id?.trim() : null;
      if (resolved) {
        clerkUserId = resolved;
        return;
      }
    }

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

  it(JUSTICE_SUPABASE_SMOKE_INTEGRATION_LIFECYCLE_TEST_NAME, async () => {
    markJusticeSupabaseSmokeIntegrationLifecycleExecuted();

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
      expect(hydrated.client_state).toMatchObject({ smoke_persistence_marker: runId });
      expect(Array.isArray(hydrated.timeline)).toBe(true);

      const savedListRes = await listCases(new NextRequest("http://localhost/api/justice/cases?limit=50"));
      expect(savedListRes.status).toBe(200);
      const savedList = (await savedListRes.json()) as { cases: Array<{ id: string }> };
      expect(listContainsCase(savedList, caseId)).toBe(true);
    } finally {
      if (caseId) {
        await deleteJusticeSupabaseSmokeCase(caseId);
      }
    }
  });

  it(JUSTICE_SUPABASE_SMOKE_INTEGRATION_CHAT_MESSAGES_TEST_NAME, async () => {
    markJusticeSupabaseSmokeIntegrationChatMessagesExecuted();

    const runId = buildJusticeSupabaseSmokeRunId();
    const intake = buildJusticeSupabaseSmokeIntake(runId);
    const turns = buildJusticeSupabaseSmokeChatTurns(runId);
    const intruderUserId = buildJusticeSupabaseSmokeIntruderClerkUserId(clerkUserId);
    let caseId: string | null = null;

    try {
      const createRes = await createCase(
        buildJsonRequest("http://localhost/api/justice/cases", "POST", { intake })
      );
      expect(createRes.status).toBe(200);
      const created = (await createRes.json()) as { id: string };
      caseId = created.id;

      const appendRes = await appendChatMessages(
        buildJsonRequest("http://localhost/api/justice/chat-messages", "POST", {
          case_id: caseId,
          messages: turns,
        })
      );
      expect(appendRes.status).toBe(200);
      const appended = (await appendRes.json()) as {
        messages: Array<{ client_turn_id: string; role: string; content: string }>;
      };
      expect(appended.messages).toHaveLength(2);
      expect(appended.messages.map((row) => row.client_turn_id)).toEqual(
        turns.map((turn) => turn.client_turn_id)
      );

      const listRes = await listChatMessages(
        new NextRequest(`http://localhost/api/justice/chat-messages?case_id=${caseId}`)
      );
      expect(listRes.status).toBe(200);
      const listed = (await listRes.json()) as {
        messages: Array<{ client_turn_id: string; role: string; content: string }>;
      };
      expect(listed.messages).toHaveLength(2);
      expect(listed.messages.map((row) => row.client_turn_id)).toEqual(
        turns.map((turn) => turn.client_turn_id)
      );
      expect(listed.messages.map((row) => row.content)).toEqual(turns.map((turn) => turn.content));
      expect(listed.messages[0]?.role).toBe("user");
      expect(listed.messages[1]?.role).toBe("assistant");

      vi.mocked(getUserOr401).mockReturnValue(intruderUserId);
      const forbiddenRes = await listChatMessages(
        new NextRequest(`http://localhost/api/justice/chat-messages?case_id=${caseId}`)
      );
      expect(forbiddenRes.status).toBe(404);
      const forbiddenBody = (await forbiddenRes.json()) as { error: string };
      expect(forbiddenBody.error).toBe("Not found");

      vi.mocked(getUserOr401).mockReturnValue(intruderUserId);
      const forbiddenAppendRes = await appendChatMessages(
        buildJsonRequest("http://localhost/api/justice/chat-messages", "POST", {
          case_id: caseId,
          messages: [
            {
              client_turn_id: `smoke_intruder_${runId}`,
              role: "user",
              content: "Intruder should not append",
            },
          ],
        })
      );
      expect(forbiddenAppendRes.status).toBe(404);
      const forbiddenAppendBody = (await forbiddenAppendRes.json()) as { error: string };
      expect(forbiddenAppendBody.error).toBe("Not found");

      vi.mocked(getUserOr401).mockReturnValue(clerkUserId);
      const ownerStillListedRes = await listChatMessages(
        new NextRequest(`http://localhost/api/justice/chat-messages?case_id=${caseId}`)
      );
      expect(ownerStillListedRes.status).toBe(200);
      const ownerStillListed = (await ownerStillListedRes.json()) as {
        messages: Array<{ client_turn_id: string }>;
      };
      expect(ownerStillListed.messages).toHaveLength(2);
    } finally {
      if (caseId) {
        await deleteJusticeSupabaseSmokeCase(caseId);
        const remaining = await listJusticeSupabaseSmokeCaseChatMessagesAdmin(caseId);
        expect(remaining).toEqual([]);
      }
    }
  });
});
