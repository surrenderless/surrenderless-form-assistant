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

vi.mock("@/lib/justice/runRealBbbBoundedSubmit", () => ({
  runRealBbbBoundedSubmit: vi.fn(),
}));

import { POST } from "@/app/api/submit-form/route";
import { runRealBbbBoundedSubmit } from "@/lib/justice/runRealBbbBoundedSubmit";
import { getUserOr401 } from "@/server/requireUser";
import { rateLimit } from "@/utils/rateLimiter";

const USER_ID = "user_test_123";
const BASE_ORIGIN = "http://localhost:3000";
const MOCK_FTC_URL = buildMockFtcPracticeSubmissionUrl(BASE_ORIGIN);

function buildRequest(body: Record<string, unknown>, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`${BASE_ORIGIN}/api/submit-form`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status: number) {
  return new Response(body, { status });
}

describe("POST /api/submit-form", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    vi.mocked(rateLimit).mockResolvedValue(false);
    vi.mocked(runRealBbbBoundedSubmit).mockResolvedValue({
      ok: true,
      fillResult: {
        status: "success",
        screenshot: null,
        pageData: null,
        stepsExecuted: 1,
        stopReason: "terminal_confirmation",
        stepLog: [],
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns 401 before rate limit or downstream work when unauthenticated", async () => {
    vi.mocked(getUserOr401).mockReturnValue(null);

    const res = await POST(
      buildRequest({ url: MOCK_FTC_URL, userData: { email: "a@b.com" } }, "session=abc")
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(rateLimit).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(runRealBbbBoundedSubmit).not.toHaveBeenCalled();
  });

  it("returns 429 before URL policy or downstream work when rate-limited", async () => {
    vi.mocked(rateLimit).mockResolvedValue(true);

    const res = await POST(
      buildRequest({ url: REAL_BBB_COMPLAINT_SUBMISSION_URL, userData: { email: "a@b.com" } })
    );

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Rate limit exceeded" });
    expect(getUserOr401).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(runRealBbbBoundedSubmit).not.toHaveBeenCalled();
  });

  it("returns 403 for a forbidden submission URL after auth and rate limit", async () => {
    const res = await POST(
      buildRequest({ url: "https://example.com/arbitrary-form", userData: { email: "a@b.com" } })
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: ASSISTED_SUBMISSION_URL_FORBIDDEN_ERROR });
    expect(getUserOr401).toHaveBeenCalled();
    expect(rateLimit).toHaveBeenCalledWith(USER_ID);
    expect(fetch).not.toHaveBeenCalled();
    expect(runRealBbbBoundedSubmit).not.toHaveBeenCalled();
  });

  it("returns success for the permitted mock assisted-submission branch", async () => {
    const fillResult = { status: "success", screenshot: null, pageData: { url: MOCK_FTC_URL } };
    vi.mocked(fetch).mockImplementation(async (input) => {
      const target = String(input);
      if (target.endsWith("/api/analyze-form")) {
        return jsonResponse({ fields: [{ name: "company_name", id: "company_name" }] });
      }
      if (target.endsWith("/api/match-fields")) {
        return jsonResponse({ instructions: [{ selector: "company_name", value: "Acme" }] });
      }
      if (target.endsWith("/api/fill-form")) {
        return jsonResponse(fillResult);
      }
      throw new Error(`Unexpected fetch: ${target}`);
    });

    const res = await POST(
      buildRequest(
        { url: MOCK_FTC_URL, userData: { email: "a@b.com", business_name: "Acme" } },
        "session=abc"
      )
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "Success", fillResult });
    expect(runRealBbbBoundedSubmit).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(3);
    const analyzeCall = vi.mocked(fetch).mock.calls[0];
    expect(String(analyzeCall?.[0])).toBe(`${BASE_ORIGIN}/api/analyze-form`);
    expect(analyzeCall?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          cookie: "session=abc",
        }),
      })
    );
  });

  it("calls the bounded real BBB runner for the permitted external BBB URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "true");
    const userData = { email: "bbb@example.com", business_name: "Acme" };
    const boundedFill = {
      status: "success" as const,
      screenshot: "https://example.com/shot.png",
      pageData: { url: REAL_BBB_COMPLAINT_SUBMISSION_URL, fields: [], buttons: [], pageText: "" },
      stepsExecuted: 2,
      stopReason: "terminal_confirmation" as const,
      stepLog: [],
    };
    vi.mocked(runRealBbbBoundedSubmit).mockResolvedValue({
      ok: true,
      fillResult: boundedFill,
    });

    const res = await POST(
      buildRequest({ url: REAL_BBB_COMPLAINT_SUBMISSION_URL, userData }, "session=bbb")
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "Success", fillResult: boundedFill });
    expect(runRealBbbBoundedSubmit).toHaveBeenCalledOnce();
    expect(runRealBbbBoundedSubmit).toHaveBeenCalledWith({
      url: REAL_BBB_COMPLAINT_SUBMISSION_URL,
      userData,
      base: BASE_ORIGIN,
      forwardedHeaders: {
        "Content-Type": "application/json",
        cookie: "session=bbb",
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("short-circuits real BBB bounded submit during Playwright mock assisted-submit E2E", async () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "true");
    vi.stubEnv("PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE", "1");

    const res = await POST(
      buildRequest(
        { url: REAL_BBB_COMPLAINT_SUBMISSION_URL, userData: { email: "bbb@example.com" } },
        "session=bbb"
      )
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      result: "Success",
      fillResult: expect.objectContaining({
        status: "success",
        stopReason: "terminal_confirmation",
        storageSkipped: true,
        stepsExecuted: 0,
      }),
    });
    expect(runRealBbbBoundedSubmit).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves incomplete real BBB status and body from the bounded runner", async () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "true");
    const incomplete = {
      ok: false as const,
      error: "Real BBB submission did not reach a confirmation page.",
      stopReason: "max_steps_reached" as const,
      stepsExecuted: 8,
      fillResult: {
        screenshot: null,
        pageData: { url: REAL_BBB_COMPLAINT_SUBMISSION_URL, fields: [], buttons: [], pageText: "" },
        stepsExecuted: 8,
        stopReason: "max_steps_reached" as const,
        stepLog: [{ step: 7, url: REAL_BBB_COMPLAINT_SUBMISSION_URL, action: "decide" as const }],
      },
      technicalDetails: { lastDecision: "continue" },
    };
    vi.mocked(runRealBbbBoundedSubmit).mockResolvedValue(incomplete);

    const res = await POST(
      buildRequest({ url: REAL_BBB_COMPLAINT_SUBMISSION_URL, userData: { email: "bbb@example.com" } })
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: incomplete.error,
      stopReason: incomplete.stopReason,
      stepsExecuted: incomplete.stepsExecuted,
      fillResult: incomplete.fillResult,
      technicalDetails: incomplete.technicalDetails,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 500 when analyze-form dependency fails", async () => {
    vi.mocked(fetch).mockResolvedValue(
      textResponse(JSON.stringify({ error: "Browser unavailable" }), 503)
    );

    const res = await POST(buildRequest({ url: MOCK_FTC_URL, userData: { email: "a@b.com" } }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: expect.stringContaining("analyze-form failed (503)"),
    });
    expect(runRealBbbBoundedSubmit).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("returns 500 when match-fields dependency fails", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const target = String(input);
      if (target.endsWith("/api/analyze-form")) {
        return jsonResponse({ fields: [{ name: "company_name" }] });
      }
      if (target.endsWith("/api/match-fields")) {
        return textResponse("upstream error", 500);
      }
      throw new Error(`Unexpected fetch: ${target}`);
    });

    const res = await POST(buildRequest({ url: MOCK_FTC_URL, userData: { email: "a@b.com" } }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "match-fields failed" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(runRealBbbBoundedSubmit).not.toHaveBeenCalled();
  });

  it("returns 500 when fill-form dependency fails", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const target = String(input);
      if (target.endsWith("/api/analyze-form")) {
        return jsonResponse({ fields: [{ name: "company_name" }] });
      }
      if (target.endsWith("/api/match-fields")) {
        return jsonResponse({ instructions: [{ selector: "company_name", value: "Acme" }] });
      }
      if (target.endsWith("/api/fill-form")) {
        return textResponse(JSON.stringify({ error: "Database insert failed" }), 500);
      }
      throw new Error(`Unexpected fetch: ${target}`);
    });

    const res = await POST(buildRequest({ url: MOCK_FTC_URL, userData: { email: "a@b.com" } }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "fill-form failed (500): Database insert failed" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(runRealBbbBoundedSubmit).not.toHaveBeenCalled();
  });

  it("uses the mock assisted pipeline instead of the bounded runner for same-origin mock URLs", async () => {
    vi.stubEnv("NEXT_PUBLIC_JUSTICE_REAL_BBB_AUTOFILL_ENABLED", "true");
    vi.mocked(fetch).mockImplementation(async (input) => {
      const target = String(input);
      if (target.endsWith("/api/analyze-form")) {
        return jsonResponse({ fields: [{ name: "company_name" }] });
      }
      if (target.endsWith("/api/match-fields")) {
        return jsonResponse({ instructions: [] });
      }
      if (target.endsWith("/api/fill-form")) {
        return jsonResponse({ status: "success" });
      }
      throw new Error(`Unexpected fetch: ${target}`);
    });

    const res = await POST(
      buildRequest({ url: MOCK_FTC_URL, userData: { email: "a@b.com" } })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      result: "Success",
      fillResult: { status: "success" },
    });
    expect(runRealBbbBoundedSubmit).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalled();
  });
});
