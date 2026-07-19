import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const runOwnedFilingDryRun = vi.fn();
const createClient = vi.fn();

vi.mock("@/lib/justice/ownedFilingDryRun", () => ({
  runOwnedFilingDryRun: (...args: unknown[]) => runOwnedFilingDryRun(...args),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

import { POST, maxDuration } from "@/app/api/cron/dry-run-owned-filing/route";

const CRON_SECRET = "test-cron-secret";
const CASE_ID = "11111111-1111-4111-8111-111111111111";

function buildRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/cron/dry-run-owned-filing", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/cron/dry-run-owned-filing", () => {
  beforeEach(() => {
    runOwnedFilingDryRun.mockReset().mockResolvedValue({
      ok: true,
      status: "dry_run_blocked_at_submit",
      destination: "bbb",
      case_id: CASE_ID,
      task_id: "t1",
      steps_executed: 2,
    });
    createClient.mockReset().mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { user_id: "user_1" }, error: null }),
          }),
        }),
      }),
    });
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("configures a long maxDuration and is POST-only operator endpoint", () => {
    expect(maxDuration).toBe(800);
  });

  it("runs dry-run for a selected case/destination with CRON_SECRET", async () => {
    const res = await POST(
      buildRequest(
        { case_id: CASE_ID, destination: "bbb", user_id: "user_1" },
        { authorization: `Bearer ${CRON_SECRET}` }
      )
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      status: "dry_run_blocked_at_submit",
      destination: "bbb",
    });
    expect(runOwnedFilingDryRun).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      CASE_ID,
      "bbb"
    );
  });

  it("resolves user_id from the case when omitted", async () => {
    const res = await POST(
      buildRequest({ case_id: CASE_ID, destination: "ftc" }, { authorization: `Bearer ${CRON_SECRET}` })
    );
    expect(res.status).toBe(200);
    expect(runOwnedFilingDryRun).toHaveBeenCalledWith(expect.anything(), "user_1", CASE_ID, "ftc");
  });

  it("rejects without cron secret", async () => {
    const res = await POST(buildRequest({ case_id: CASE_ID, destination: "bbb" }));
    expect(res.status).toBe(401);
    expect(runOwnedFilingDryRun).not.toHaveBeenCalled();
  });

  it("rejects missing destination", async () => {
    const res = await POST(
      buildRequest({ case_id: CASE_ID }, { authorization: `Bearer ${CRON_SECRET}` })
    );
    expect(res.status).toBe(400);
    expect(runOwnedFilingDryRun).not.toHaveBeenCalled();
  });
});
