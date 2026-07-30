import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildMockFtcPracticeSubmissionUrl } from "@/lib/justice/assistedSubmissionLane";
import { ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR } from "@/lib/justice/assistedSubmissionExternalUrl";

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

vi.mock("@/utils/rateLimiter", () => ({
  rateLimit: vi.fn(),
}));

const mockLaunch = vi.fn();
const mockConnectOverCDP = vi.fn();

vi.mock("playwright", () => ({
  chromium: {
    launch: (...args: unknown[]) => mockLaunch(...args),
    connectOverCDP: (...args: unknown[]) => mockConnectOverCDP(...args),
  },
}));

import { POST } from "@/app/api/analyze-form/route";
import { getUserOr401 } from "@/server/requireUser";
import { rateLimit } from "@/utils/rateLimiter";

const USER_ID = "user_test_123";
const BASE_ORIGIN = "http://localhost:3000";
const MOCK_FTC_URL = buildMockFtcPracticeSubmissionUrl(BASE_ORIGIN);

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest(`${BASE_ORIGIN}/api/analyze-form`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function stubBrowser() {
  const page = {
    goto: vi.fn(async () => {}),
    evaluate: vi.fn(async () => []),
  };
  const context = { newPage: vi.fn(async () => page) };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {}),
  };
  mockLaunch.mockResolvedValue(browser);
  mockConnectOverCDP.mockResolvedValue(browser);
  return { browser, context, page };
}

describe("POST /api/analyze-form SSRF protection", () => {
  beforeEach(() => {
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    vi.mocked(rateLimit).mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it.each([
    ["cloud metadata endpoint", "http://169.254.169.254/latest/meta-data/iam/security-credentials/"],
    ["internal-network address", "http://10.0.0.5:8080/admin"],
    ["localhost with a different port", "http://127.0.0.1:22"],
    ["arbitrary external domain", "https://attacker.example.com/payload"],
    ["file scheme", "file:///etc/passwd"],
  ])("fails closed for a disallowed URL (%s) before ever launching a browser", async (_label, url) => {
    const res = await POST(buildRequest({ url }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR });
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(mockConnectOverCDP).not.toHaveBeenCalled();
  });

  it("allows the canonical same-origin mock destination and proceeds to launch a browser", async () => {
    const { page } = stubBrowser();

    const res = await POST(buildRequest({ url: MOCK_FTC_URL }));

    expect(res.status).toBe(200);
    expect(mockLaunch).toHaveBeenCalled();
    expect(page.goto).toHaveBeenCalledWith(MOCK_FTC_URL, expect.objectContaining({ timeout: 60000 }));
  });

  it("rejects a real external BBB URL when the real-autofill feature flag is off", async () => {
    // REAL_BBB_COMPLAINT_SUBMISSION_URL is only allowed when the feature flag is enabled;
    // with it unset, the same URL must still be rejected before touching a browser.
    const res = await POST(buildRequest({ url: "https://www.bbb.org/complain/" }));

    expect(res.status).toBe(403);
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(mockConnectOverCDP).not.toHaveBeenCalled();
  });
});
