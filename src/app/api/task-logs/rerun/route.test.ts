import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  buildMockFtcPracticeSubmissionUrl,
  REAL_BBB_COMPLAINT_SUBMISSION_URL,
} from "@/lib/justice/assistedSubmissionLane";
import { ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR } from "@/lib/justice/assistedSubmissionExternalUrl";

const mockMaybeSingle = vi.fn();
const mockProfileSingle = vi.fn();
const mockUpdateEq = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

vi.mock("@/utils/rateLimiter", () => ({
  rateLimit: vi.fn(),
}));

vi.mock("@/server/CrewBridge", () => ({
  runCrewBridge: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "task_logs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: mockMaybeSingle,
            }),
          }),
          update: () => ({
            eq: mockUpdateEq,
          }),
        };
      }
      if (table === "user_profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: mockProfileSingle,
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  })),
}));

import { POST } from "@/app/api/task-logs/rerun/route";
import { runCrewBridge } from "@/server/CrewBridge";
import { getUserOr401 } from "@/server/requireUser";
import { rateLimit } from "@/utils/rateLimiter";

const USER_ID = "user_test_123";
const OTHER_USER_ID = "user_other_456";
const LOG_ID = "log_test_789";
const BASE_ORIGIN = "http://localhost:3000";
const MOCK_FTC_URL = buildMockFtcPracticeSubmissionUrl(BASE_ORIGIN);
const USER_PROFILE = {
  name: "User",
  address: "1 Main St",
  email: "user@example.com",
};

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest(`${BASE_ORIGIN}/api/task-logs/rerun`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function stubTaskLog(url: string | null | undefined, userId = USER_ID) {
  mockMaybeSingle.mockResolvedValue({
    data: {
      id: LOG_ID,
      user_id: userId,
      url,
      steps: [],
    },
    error: null,
  });
}

describe("POST /api/task-logs/rerun", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    vi.mocked(rateLimit).mockResolvedValue(false);
    vi.mocked(runCrewBridge).mockResolvedValue(undefined);
    mockProfileSingle.mockResolvedValue({ data: USER_PROFILE, error: null });
    stubTaskLog(MOCK_FTC_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns 401 before lookup or runCrewBridge when unauthenticated", async () => {
    vi.mocked(getUserOr401).mockReturnValue(null);

    const res = await POST(buildRequest({ logId: LOG_ID }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(rateLimit).not.toHaveBeenCalled();
    expect(mockMaybeSingle).not.toHaveBeenCalled();
    expect(runCrewBridge).not.toHaveBeenCalled();
  });

  it("returns 429 before lookup or runCrewBridge when rate-limited", async () => {
    vi.mocked(rateLimit).mockResolvedValue(true);

    const res = await POST(buildRequest({ logId: LOG_ID }));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Rate limit exceeded" });
    expect(mockMaybeSingle).not.toHaveBeenCalled();
    expect(runCrewBridge).not.toHaveBeenCalled();
  });

  it("returns 403 when the task log belongs to another user", async () => {
    stubTaskLog(MOCK_FTC_URL, OTHER_USER_ID);

    const res = await POST(buildRequest({ logId: LOG_ID }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(mockProfileSingle).not.toHaveBeenCalled();
    expect(runCrewBridge).not.toHaveBeenCalled();
  });

  it("returns 400 when the stored task log URL is missing", async () => {
    stubTaskLog(null);

    const res = await POST(buildRequest({ logId: LOG_ID }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing url" });
    expect(runCrewBridge).not.toHaveBeenCalled();
  });

  it("returns 403 when the stored task log URL is forbidden", async () => {
    stubTaskLog("https://example.com/arbitrary-form");

    const res = await POST(buildRequest({ logId: LOG_ID }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR });
    expect(runCrewBridge).not.toHaveBeenCalled();
  });

  it("calls runCrewBridge for a permitted same-origin mock submission URL", async () => {
    const res = await POST(buildRequest({ logId: LOG_ID }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "restarted" });
    expect(runCrewBridge).toHaveBeenCalledOnce();
    expect(runCrewBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        url: MOCK_FTC_URL,
        userData: USER_PROFILE,
      })
    );
  });

  it("calls runCrewBridge for a permitted real BBB URL when autofill is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "true");
    stubTaskLog(REAL_BBB_COMPLAINT_SUBMISSION_URL);

    const res = await POST(buildRequest({ logId: LOG_ID }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "restarted" });
    expect(runCrewBridge).toHaveBeenCalledOnce();
    expect(runCrewBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        url: REAL_BBB_COMPLAINT_SUBMISSION_URL,
        userData: USER_PROFILE,
      })
    );
  });

  it("returns 500 with the existing error shape when runCrewBridge fails", async () => {
    vi.mocked(runCrewBridge).mockRejectedValue(new Error("CrewBridge spawn failed"));

    const res = await POST(buildRequest({ logId: LOG_ID }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "CrewBridge spawn failed" });
  });
});
