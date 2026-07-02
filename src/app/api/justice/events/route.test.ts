import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockInsert = vi.fn();

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: mockInsert,
    })),
  })),
}));

import { POST } from "@/app/api/justice/events/route";
import { getUserOr401 } from "@/server/requireUser";

const USER_ID = "user_test_123";

function buildRequest(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/justice/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/justice/events", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    mockInsert.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns skipped for unauthenticated requests", async () => {
    vi.mocked(getUserOr401).mockReturnValue(null);

    const res = await POST(buildRequest({ event_name: "intake_completed" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: true });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("skips all events when Playwright intake commit mock is enabled", async () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_PIPELINE", "1");

    const res = await POST(
      buildRequest({ event_name: "ftc_practice_started", payload: { case_id: "abc" } })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: true });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("does not skip on production even when the Playwright mock flag is set", async () => {
    vi.stubEnv("PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_PIPELINE", "1");
    vi.stubEnv("VERCEL_ENV", "production");

    const res = await POST(buildRequest({ event_name: "intake_completed", payload: {} }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockInsert).toHaveBeenCalledWith({
      user_id: USER_ID,
      action: "intake_completed",
      result: {},
    });
  });

  it("inserts history when Playwright mock is disabled", async () => {
    const res = await POST(
      buildRequest({ event_name: "bbb_practice_started", payload: { lane: "bbb" } })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockInsert).toHaveBeenCalledWith({
      user_id: USER_ID,
      action: "bbb_practice_started",
      result: { lane: "bbb" },
    });
  });
});
