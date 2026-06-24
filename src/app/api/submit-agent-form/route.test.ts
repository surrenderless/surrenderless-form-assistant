import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  buildMockFtcPracticeSubmissionUrl,
  REAL_BBB_COMPLAINT_SUBMISSION_URL,
} from "@/lib/justice/assistedSubmissionLane";
import { ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR } from "@/lib/justice/assistedSubmissionExternalUrl";

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

vi.mock("@/utils/rateLimiter", () => ({
  rateLimit: vi.fn(),
}));

vi.mock("@/server/CrewBridge", () => ({
  runCrewBridge: vi.fn(),
}));

import { POST } from "@/app/api/submit-agent-form/route";
import { runCrewBridge } from "@/server/CrewBridge";
import { getUserOr401 } from "@/server/requireUser";
import { rateLimit } from "@/utils/rateLimiter";

const USER_ID = "user_test_123";
const BASE_ORIGIN = "http://localhost:3000";
const MOCK_FTC_URL = buildMockFtcPracticeSubmissionUrl(BASE_ORIGIN);
const USER_DATA = { name: "User", address: "1 Main St", email: "user@example.com" };

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest(`${BASE_ORIGIN}/api/submit-agent-form`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/submit-agent-form", () => {
  beforeEach(() => {
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    vi.mocked(rateLimit).mockResolvedValue(false);
    vi.mocked(runCrewBridge).mockResolvedValue({ status: "ok" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns 401 before rate limit or runCrewBridge when unauthenticated", async () => {
    vi.mocked(getUserOr401).mockReturnValue(null);

    const res = await POST(buildRequest({ url: MOCK_FTC_URL, userData: USER_DATA }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(rateLimit).not.toHaveBeenCalled();
    expect(runCrewBridge).not.toHaveBeenCalled();
  });

  it("returns 429 before URL policy or runCrewBridge when rate-limited", async () => {
    vi.mocked(rateLimit).mockResolvedValue(true);

    const res = await POST(
      buildRequest({ url: REAL_BBB_COMPLAINT_SUBMISSION_URL, userData: USER_DATA })
    );

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Rate limit exceeded" });
    expect(getUserOr401).toHaveBeenCalled();
    expect(runCrewBridge).not.toHaveBeenCalled();
  });

  it("returns 403 for a forbidden submission URL after auth and rate limit", async () => {
    const res = await POST(
      buildRequest({ url: "https://example.com/arbitrary-form", userData: USER_DATA })
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR });
    expect(getUserOr401).toHaveBeenCalled();
    expect(rateLimit).toHaveBeenCalledWith(USER_ID);
    expect(runCrewBridge).not.toHaveBeenCalled();
  });

  it("calls runCrewBridge for a permitted same-origin mock submission URL", async () => {
    const crewResult = { status: "completed", steps: 3 };
    vi.mocked(runCrewBridge).mockResolvedValue(crewResult);

    const res = await POST(buildRequest({ url: MOCK_FTC_URL, userData: USER_DATA }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: crewResult });
    expect(runCrewBridge).toHaveBeenCalledOnce();
    expect(runCrewBridge).toHaveBeenCalledWith({ url: MOCK_FTC_URL, userData: USER_DATA });
  });

  it("calls runCrewBridge for a permitted real BBB URL when autofill is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "true");
    const crewResult = { status: "completed" };
    vi.mocked(runCrewBridge).mockResolvedValue(crewResult);

    const res = await POST(
      buildRequest({ url: REAL_BBB_COMPLAINT_SUBMISSION_URL, userData: USER_DATA })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: crewResult });
    expect(runCrewBridge).toHaveBeenCalledOnce();
    expect(runCrewBridge).toHaveBeenCalledWith({
      url: REAL_BBB_COMPLAINT_SUBMISSION_URL,
      userData: USER_DATA,
    });
  });

  it("returns 500 with the existing error shape when runCrewBridge fails", async () => {
    vi.mocked(runCrewBridge).mockRejectedValue(new Error("CrewBridge spawn failed"));

    const res = await POST(buildRequest({ url: MOCK_FTC_URL, userData: USER_DATA }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "CrewBridge spawn failed" });
  });
});
