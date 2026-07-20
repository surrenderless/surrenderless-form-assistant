import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  BBB_DECIDE_ACTION_INTERNAL_SECRET_HEADER,
  BBB_DECIDE_ACTION_USER_ID_HEADER,
  BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS,
  BROWSERLESS_TIMEOUT_MAX_MS,
  OWNED_FILING_BROWSERLESS_SESSION_TIMEOUT_MS,
  ensureBrowserlessOwnedFilingSessionTimeout,
  evaluateOwnedBbbAutofillExecutionReadiness,
  getBbbDecideActionInternalSecret,
  isVercelProductionEnv,
  resolveBbbDecideActionInternalUserId,
  resolveChromiumConnectionForRealBbbSubmit,
} from "@/lib/justice/bbbOwnedFilingProduction";

vi.mock("@/lib/testing/playwrightMockRealBbbBoundedSubmitLoop", () => ({
  isPlaywrightMockRealBbbBoundedSubmitLoopEnabled: vi.fn(() => false),
}));

import { isPlaywrightMockRealBbbBoundedSubmitLoopEnabled } from "@/lib/testing/playwrightMockRealBbbBoundedSubmitLoop";

describe("bbbOwnedFilingProduction execution gates", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(isPlaywrightMockRealBbbBoundedSubmitLoopEnabled).mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("exports a 300s route maxDuration suitable for Vercel Pro", () => {
    expect(BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS).toBe(300);
  });

  it("detects Vercel production via VERCEL_ENV", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isVercelProductionEnv()).toBe(true);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isVercelProductionEnv()).toBe(false);
  });

  it("requires Browserless in Vercel production and does not fall back to local Chromium", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BROWSERLESS_URL", "");
    const connection = resolveChromiumConnectionForRealBbbSubmit();
    expect(connection).toEqual({
      mode: "unavailable",
      error: expect.stringContaining("BROWSERLESS_URL is required in Vercel production"),
    });
  });

  it("uses Browserless when configured in production and injects timeout=300000 ms", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BROWSERLESS_URL", "wss://chrome.browserless.io?token=test");
    const connection = resolveChromiumConnectionForRealBbbSubmit();
    expect(connection.mode).toBe("browserless");
    if (connection.mode !== "browserless") return;
    const resolved = new URL(connection.url);
    expect(resolved.searchParams.get("token")).toBe("test");
    expect(resolved.searchParams.get("timeout")).toBe("300000");
    expect(resolved.searchParams.get("timeout")).toBe(
      String(OWNED_FILING_BROWSERLESS_SESSION_TIMEOUT_MS)
    );
  });

  it("derives owned-filing Browserless timeout ms from the 300s route-duration constant", () => {
    expect(OWNED_FILING_BROWSERLESS_SESSION_TIMEOUT_MS).toBe(
      BBB_OWNED_AUTOFILL_ROUTE_MAX_DURATION_SECONDS * 1000
    );
    expect(OWNED_FILING_BROWSERLESS_SESSION_TIMEOUT_MS).toBe(300_000);
    expect(BROWSERLESS_TIMEOUT_MAX_MS).toBe(900_000);
    expect(BROWSERLESS_TIMEOUT_MAX_MS).toBeGreaterThanOrEqual(
      OWNED_FILING_BROWSERLESS_SESSION_TIMEOUT_MS
    );
  });

  it.each([
    {
      name: "missing",
      input: "wss://production-sfo.browserless.io/?token=abc&stealth=true",
      expected: "300000",
    },
    {
      name: "stale 60000",
      input: "wss://production-sfo.browserless.io/?token=abc&timeout=60000&stealth=true",
      expected: "300000",
    },
    {
      name: "59000",
      input: "wss://production-sfo.browserless.io/?token=abc&timeout=59000&stealth=true",
      expected: "300000",
    },
    {
      name: "invalid",
      input: "wss://production-sfo.browserless.io/?token=abc&timeout=not-a-number&stealth=true",
      expected: "300000",
    },
    {
      name: "duplicate low+stale",
      input:
        "wss://production-sfo.browserless.io/?token=abc&timeout=60000&timeout=59000&stealth=true",
      expected: "300000",
    },
  ])("replaces $name timeout with 300000 and preserves token/extra params", ({ input, expected }) => {
    const out = ensureBrowserlessOwnedFilingSessionTimeout(input);
    const resolved = new URL(out);
    expect(resolved.searchParams.get("token")).toBe("abc");
    expect(resolved.searchParams.get("stealth")).toBe("true");
    expect(resolved.searchParams.get("timeout")).toBe(expected);
    expect(resolved.searchParams.getAll("timeout")).toEqual([expected]);
  });

  it("preserves an already-valid timeout at the owned-filing budget", () => {
    const out = ensureBrowserlessOwnedFilingSessionTimeout(
      "wss://production-sfo.browserless.io/?token=abc&timeout=300000&stealth=true"
    );
    const resolved = new URL(out);
    expect(resolved.searchParams.get("token")).toBe("abc");
    expect(resolved.searchParams.get("stealth")).toBe("true");
    expect(resolved.searchParams.getAll("timeout")).toEqual(["300000"]);
  });

  it("preserves a valid timeout between the budget and upgraded-plan maximum", () => {
    const out = ensureBrowserlessOwnedFilingSessionTimeout(
      "wss://production-sfo.browserless.io/?token=abc&timeout=600000&stealth=true"
    );
    const resolved = new URL(out);
    expect(resolved.searchParams.get("token")).toBe("abc");
    expect(resolved.searchParams.get("stealth")).toBe("true");
    expect(resolved.searchParams.getAll("timeout")).toEqual(["600000"]);
  });

  it("replaces a timeout above the upgraded-plan maximum with the owned-filing budget", () => {
    const out = ensureBrowserlessOwnedFilingSessionTimeout(
      `wss://production-sfo.browserless.io/?token=abc&timeout=${BROWSERLESS_TIMEOUT_MAX_MS + 1}&stealth=true`
    );
    const resolved = new URL(out);
    expect(resolved.searchParams.getAll("timeout")).toEqual(["300000"]);
  });

  it("collapses duplicates preferring the first valid timeout in range", () => {
    const out = ensureBrowserlessOwnedFilingSessionTimeout(
      "wss://production-sfo.browserless.io/?token=abc&timeout=59000&timeout=300000&stealth=true"
    );
    const resolved = new URL(out);
    expect(resolved.searchParams.get("token")).toBe("abc");
    expect(resolved.searchParams.get("stealth")).toBe("true");
    expect(resolved.searchParams.getAll("timeout")).toEqual(["300000"]);
  });

  it("allows local Chromium outside production when Browserless is unset", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("BROWSERLESS_URL", "");
    expect(resolveChromiumConnectionForRealBbbSubmit()).toEqual({ mode: "local" });
  });

  it("authenticates decide-action via internal secret headers without cookies", () => {
    vi.stubEnv("BBB_DECIDE_ACTION_INTERNAL_SECRET", "prod-secret-value");
    expect(getBbbDecideActionInternalSecret()).toBe("prod-secret-value");

    const ok = new NextRequest("http://localhost/api/decide-action", {
      method: "POST",
      headers: {
        [BBB_DECIDE_ACTION_INTERNAL_SECRET_HEADER]: "prod-secret-value",
        [BBB_DECIDE_ACTION_USER_ID_HEADER]: "user_owned_1",
      },
    });
    expect(resolveBbbDecideActionInternalUserId(ok)).toBe("user_owned_1");

    const badSecret = new NextRequest("http://localhost/api/decide-action", {
      method: "POST",
      headers: {
        [BBB_DECIDE_ACTION_INTERNAL_SECRET_HEADER]: "wrong",
        [BBB_DECIDE_ACTION_USER_ID_HEADER]: "user_owned_1",
      },
    });
    expect(resolveBbbDecideActionInternalUserId(badSecret)).toBeNull();

    const cookieOnly = new NextRequest("http://localhost/api/decide-action", {
      method: "POST",
      headers: { cookie: "session=abc" },
    });
    expect(resolveBbbDecideActionInternalUserId(cookieOnly)).toBeNull();
  });

  it("skips owned readiness when production lacks Browserless or decide-action secret", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example");
    vi.stubEnv("BROWSERLESS_URL", "");
    vi.stubEnv("BBB_DECIDE_ACTION_INTERNAL_SECRET", "secret");
    expect(evaluateOwnedBbbAutofillExecutionReadiness("user_1")).toEqual({
      ok: false,
      reason: expect.stringContaining("BROWSERLESS_URL"),
    });

    vi.stubEnv("BROWSERLESS_URL", "wss://chrome.browserless.io");
    vi.stubEnv("BBB_DECIDE_ACTION_INTERNAL_SECRET", "");
    expect(evaluateOwnedBbbAutofillExecutionReadiness("user_1")).toEqual({
      ok: false,
      reason: expect.stringContaining("BBB_DECIDE_ACTION_INTERNAL_SECRET"),
    });
  });

  it("builds cookie-free decide-action headers when production readiness passes", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example/");
    vi.stubEnv("BROWSERLESS_URL", "wss://chrome.browserless.io");
    vi.stubEnv("BBB_DECIDE_ACTION_INTERNAL_SECRET", "prod-secret");
    const ready = evaluateOwnedBbbAutofillExecutionReadiness("user_42");
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.base).toBe("https://app.example");
    expect(ready.forwardedHeaders.cookie).toBeUndefined();
    expect(ready.forwardedHeaders[BBB_DECIDE_ACTION_INTERNAL_SECRET_HEADER]).toBe("prod-secret");
    expect(ready.forwardedHeaders[BBB_DECIDE_ACTION_USER_ID_HEADER]).toBe("user_42");
  });
});
