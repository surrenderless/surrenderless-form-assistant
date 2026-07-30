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

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: () => ({ insert: async () => ({ error: null }) }),
    storage: { from: () => ({ upload: async () => ({ data: { path: "x" }, error: null }) }) },
  })),
}));

import { POST } from "@/app/api/fill-form/route";
import { getUserOr401 } from "@/server/requireUser";
import { rateLimit } from "@/utils/rateLimiter";

const USER_ID = "user_test_123";
const BASE_ORIGIN = "http://localhost:3000";
const MOCK_FTC_URL = buildMockFtcPracticeSubmissionUrl(BASE_ORIGIN);

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest(`${BASE_ORIGIN}/api/fill-form`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function stubBrowser() {
  const page = {
    isClosed: () => false,
    goto: vi.fn(async () => {}),
    waitForLoadState: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    locator: vi.fn(() => ({
      evaluate: vi.fn(async () => "INPUT"),
      fill: vi.fn(async () => {}),
      selectOption: vi.fn(async () => {}),
    })),
    click: vi.fn(async () => {}),
    evaluate: vi.fn(async () => ({ fields: [], buttons: [], url: MOCK_FTC_URL })),
    screenshot: vi.fn(async () => {}),
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

describe("POST /api/fill-form SSRF protection", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    vi.mocked(rateLimit).mockResolvedValue(false);
    fetchSpy = vi.fn(async () => new Response(JSON.stringify({ profile: null }), { status: 404 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each([
    ["cloud metadata endpoint", "http://169.254.169.254/latest/meta-data/iam/security-credentials/"],
    ["internal-network address", "http://10.0.0.5:8080/admin"],
    ["arbitrary external domain", "https://attacker.example.com/payload"],
  ])(
    "fails closed for a disallowed URL (%s) before browser, profile lookup, or storage",
    async (_label, url) => {
      const res = await POST(
        buildRequest({ url, email: "consumer@example.com", decision: { fieldsToFill: [] } })
      );

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR });
      expect(mockLaunch).not.toHaveBeenCalled();
      expect(mockConnectOverCDP).not.toHaveBeenCalled();
      // No profile lookup (which would leak the caller's session cookie to /api/profile/get)
      // and no filling/clicking/screenshotting of the rejected target.
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );

  it("allows the canonical same-origin mock destination and proceeds to navigate/fill", async () => {
    const { page } = stubBrowser();

    const res = await POST(
      buildRequest({
        url: MOCK_FTC_URL,
        decision: { fieldsToFill: [], waitForNavigation: false },
      })
    );

    expect(res.status).toBe(200);
    expect(mockLaunch).toHaveBeenCalled();
    expect(page.goto).toHaveBeenCalledWith(MOCK_FTC_URL, expect.objectContaining({ timeout: 60000 }));
  });
});
