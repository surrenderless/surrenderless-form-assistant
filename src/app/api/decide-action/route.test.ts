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

const SAMPLE_DECISION = {
  fieldsToFill: [
    {
      selector: "sub-a",
      value: "Option A",
      controlKind: "radio",
      choiceSelectorType: "id",
    },
  ],
  nextButton: { selectorType: "text", value: "Continue" },
  waitForNavigation: true,
};

function buildRequest(body: Record<string, unknown>, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new NextRequest("http://localhost/api/decide-action", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function postWithModelContent(content: string) {
  mockCreate.mockResolvedValue({
    choices: [{ message: { content } }],
  });
  return POST(buildRequest({ pageData: { fields: [] }, userData: {} }));
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

  it("requests JSON mode on a supported model and returns a structured decision", async () => {
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
    const createArg = mockCreate.mock.calls[0]?.[0] as {
      model: string;
      response_format?: { type: string };
      messages: Array<{ content: string }>;
    };
    expect(createArg.model).toBe("gpt-4.1-mini");
    expect(createArg.response_format).toEqual({ type: "json_object" });
    expect(createArg.messages[0]?.content).toMatch(/JSON/i);
    expect(createArg.messages[1]?.content).toContain("Acme");
    expect(createArg.messages[1]?.content).toContain(
      "select the required option before Continue"
    );
    expect(createArg.messages[1]?.content).toContain('controlKind "radio", "checkbox", or "choice"');
    expect(createArg.messages[1]?.content).toContain("exact optionValue");
    expect(createArg.messages[1]?.content).toContain("choiceControls");
    expect(createArg.messages[1]?.content).toContain("choiceSelectorType");
    expect(createArg.messages[1]?.content).toContain("Never invent choice metadata");
    expect(createArg.messages[1]?.content).toContain("optionValue equals accessibleName");
    expect(createArg.messages[1]?.content).toContain('choiceSelectorType "id"');
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

  it("accepts bare valid JSON from the model", async () => {
    const res = await postWithModelContent(JSON.stringify(SAMPLE_DECISION));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ decision: SAMPLE_DECISION });
  });

  it("accepts fenced ```json JSON from the model as a defensive fallback", async () => {
    const res = await postWithModelContent(
      `\`\`\`json\n${JSON.stringify(SAMPLE_DECISION, null, 2)}\n\`\`\``
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ decision: SAMPLE_DECISION });
  });

  it("accepts fenced ``` JSON without a language tag", async () => {
    const res = await postWithModelContent(`\`\`\`\n${JSON.stringify(SAMPLE_DECISION)}\n\`\`\``);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ decision: SAMPLE_DECISION });
  });

  it("accepts surrounding whitespace around bare or fenced JSON", async () => {
    const bare = await postWithModelContent(`  \n${JSON.stringify(SAMPLE_DECISION)}\n  `);
    expect(bare.status).toBe(200);
    expect(await bare.json()).toEqual({ decision: SAMPLE_DECISION });

    const fenced = await postWithModelContent(
      `\n\`\`\`json\n${JSON.stringify(SAMPLE_DECISION)}\n\`\`\`\n`
    );
    expect(fenced.status).toBe(200);
    expect(await fenced.json()).toEqual({ decision: SAMPLE_DECISION });
  });

  it("returns sanitized 500 for malformed JSON without echoing model text", async () => {
    const partial = await postWithModelContent('{ "fieldsToFill": [');
    expect(partial.status).toBe(500);
    expect(await partial.json()).toEqual({ error: "Invalid JSON response from GPT" });

    const brokenFence = await postWithModelContent(
      "```json\n{ broken secret@example.com\n```"
    );
    expect(brokenFence.status).toBe(500);
    const brokenBody = await brokenFence.json();
    expect(brokenBody).toEqual({ error: "Invalid JSON response from GPT" });
    expect(JSON.stringify(brokenBody)).not.toContain("secret@example.com");
  });

  it("returns 500 for prose-only model output", async () => {
    const res = await postWithModelContent(
      "Select the Online shopping subcategory and click Continue."
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Invalid JSON response from GPT" });
  });

  it("returns 500 when prose surrounds JSON or a fenced payload", async () => {
    const bareWrapped = await postWithModelContent(
      `Here is the decision:\n${JSON.stringify(SAMPLE_DECISION)}\nThanks!`
    );
    expect(bareWrapped.status).toBe(500);

    const fenceWrapped = await postWithModelContent(
      `Here is the decision:\n\`\`\`json\n${JSON.stringify(SAMPLE_DECISION)}\n\`\`\`\nDone.`
    );
    expect(fenceWrapped.status).toBe(500);

    const trailing = await postWithModelContent(
      `${JSON.stringify(SAMPLE_DECISION)}\n// trailing note`
    );
    expect(trailing.status).toBe(500);
  });

  it("returns sanitized 500 when OpenAI rejects or throws", async () => {
    mockCreate.mockRejectedValue(
      new Error("401 incorrect API key for private@example.com case story")
    );

    const res = await POST(buildRequest({ pageData: { fields: [] }, userData: {} }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "decide-action model request failed" });
    expect(JSON.stringify(body)).not.toContain("private@example.com");
    expect(JSON.stringify(body)).not.toContain("API key");
    expect(JSON.stringify(body)).not.toContain("case story");
  });
});
