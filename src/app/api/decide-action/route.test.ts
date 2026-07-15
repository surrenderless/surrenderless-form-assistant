import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockCreate = vi.fn();

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

vi.mock("@/utils/rateLimiter", () => ({
  rateLimit: vi.fn(),
}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

import { POST } from "@/app/api/decide-action/route";
import { getUserOr401 } from "@/server/requireUser";
import { rateLimit } from "@/utils/rateLimiter";

const USER_ID = "user_test_123";

function buildRequest(body: Record<string, unknown>, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new NextRequest("http://localhost/api/decide-action", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/decide-action", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    vi.mocked(rateLimit).mockResolvedValue(false);
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ fieldsToFill: [], nextButton: null }) } }],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns 401 before calling OpenAI when unauthenticated", async () => {
    vi.mocked(getUserOr401).mockReturnValue(null);

    const res = await POST(buildRequest({ pageData: { fields: [] }, userData: { email: "a@b.com" } }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(rateLimit).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("authenticates via internal BBB decide-action secret without Clerk cookies", async () => {
    vi.mocked(getUserOr401).mockReturnValue(null);
    vi.stubEnv("BBB_DECIDE_ACTION_INTERNAL_SECRET", "server-secret");
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ fieldsToFill: [] }) } }],
    });

    const res = await POST(
      new NextRequest("http://localhost/api/decide-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-surrenderless-bbb-decide-secret": "server-secret",
          "x-surrenderless-bbb-user-id": "user_internal",
        },
        body: JSON.stringify({ pageData: { fields: [] }, userData: {} }),
      })
    );

    expect(res.status).toBe(200);
    expect(rateLimit).toHaveBeenCalledWith("user_internal");
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("returns 429 before calling OpenAI when rate-limited", async () => {
    vi.mocked(rateLimit).mockResolvedValue(true);

    const res = await POST(buildRequest({ pageData: { fields: [] }, userProfile: { name: "User" } }));

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Rate limit exceeded" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns decision for authenticated requests and accepts userData alias", async () => {
    const decision = {
      fieldsToFill: [{ selector: "business", value: "Acme" }],
      nextButton: { selectorType: "text", value: "Continue" },
      waitForNavigation: true,
    };
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(decision) } }],
    });

    const res = await POST(
      buildRequest(
        { pageData: { url: "https://www.bbb.org/complain/", fields: [] }, userData: { business_name: "Acme" } },
        "session=abc"
      )
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ decision });
    expect(getUserOr401).toHaveBeenCalled();
    expect(rateLimit).toHaveBeenCalledWith(USER_ID);
    expect(mockCreate).toHaveBeenCalledOnce();
    const createArg = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ content: string }> };
    expect(createArg.messages[1]?.content).toContain("Acme");
  });

  it("prefers userProfile over userData when both are provided", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ fieldsToFill: [] }) } }],
    });

    await POST(
      buildRequest({
        pageData: {},
        userProfile: { source: "profile" },
        userData: { source: "data" },
      })
    );

    const createArg = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ content: string }> };
    expect(createArg.messages[1]?.content).toContain('"source": "profile"');
    expect(createArg.messages[1]?.content).not.toContain('"source": "data"');
  });
});
