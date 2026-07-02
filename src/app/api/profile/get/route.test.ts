import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockMaybeSingle = vi.fn();

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

vi.mock("@/utils/rateLimiter", () => ({
  rateLimit: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: mockMaybeSingle,
        })),
      })),
    })),
  })),
}));

import { POST } from "@/app/api/profile/get/route";
import { buildPlaywrightMockProfileGetResponse } from "@/lib/testing/playwrightMockAssistedSubmitPipeline";
import { getUserOr401 } from "@/server/requireUser";
import { rateLimit } from "@/utils/rateLimiter";

const USER_ID = "user_test_123";
const EMAIL = "e2e-signed-in@example.com";

function buildRequest(body: Record<string, unknown> = { email: EMAIL }) {
  return new NextRequest("http://localhost/api/profile/get", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/profile/get", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    vi.mocked(rateLimit).mockResolvedValue(false);
    mockMaybeSingle.mockResolvedValue({
      data: { email: EMAIL, name: "Stored User", address: "1 Main St", phone: "555-0100" },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns deterministic profile when Playwright assisted-submit mock is enabled", async () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE", "1");

    const res = await POST(buildRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(buildPlaywrightMockProfileGetResponse(EMAIL));
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it("returns profile shape expected by fill-form when mock is enabled", async () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE", "1");

    const res = await POST(buildRequest({ email: "e2e-global-setup@example.com" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      profile: {
        email: "e2e-global-setup@example.com",
        name: "E2E Playwright User",
        address: null,
        phone: null,
      },
    });
    expect(json.profile).toBeTruthy();
  });

  it("does not use mock on production even when the Playwright flag is set", async () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_ASSISTED_SUBMIT_PIPELINE", "1");
    vi.stubEnv("VERCEL_ENV", "production");

    const res = await POST(buildRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      profile: { email: EMAIL, name: "Stored User", address: "1 Main St", phone: "555-0100" },
    });
    expect(mockMaybeSingle).toHaveBeenCalled();
  });

  it("falls through to Supabase when Playwright mock is disabled", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const res = await POST(buildRequest());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User not found" });
    expect(mockMaybeSingle).toHaveBeenCalled();
  });
});
