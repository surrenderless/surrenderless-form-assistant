import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const findAndClaimNextQueuedOwnedFiling = vi.fn();
const executeClaimedBbbFiling = vi.fn();
const executeClaimedFtcFiling = vi.fn();
const createClient = vi.fn((..._args: unknown[]) => ({ from: vi.fn() }));

vi.mock("@/lib/justice/claimQueuedOwnedFiling", () => ({
  findAndClaimNextQueuedOwnedFiling: (...args: unknown[]) =>
    findAndClaimNextQueuedOwnedFiling(...args),
}));

vi.mock("@/lib/justice/bbbOwnedFilingExecute", () => ({
  executeClaimedBbbFiling: (...args: unknown[]) => executeClaimedBbbFiling(...args),
}));

vi.mock("@/lib/justice/ftcOwnedFilingExecute", () => ({
  executeClaimedFtcFiling: (...args: unknown[]) => executeClaimedFtcFiling(...args),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

import { GET, POST, maxDuration } from "@/app/api/cron/run-queued-owned-filings/route";

const CRON_SECRET = "test-cron-secret";

function buildRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/cron/run-queued-owned-filings", {
    method: "GET",
    headers,
  });
}

const CLAIMED_TASK = {
  id: "22222222-2222-4222-8222-222222222222",
  user_id: "user_1",
  case_id: "11111111-1111-4111-8111-111111111111",
  title: "FTC filing",
  due_date: null,
  notes: "submitting",
  completed_at: null,
  created_at: "2026-07-14T00:00:00.000Z",
  updated_at: "2026-07-14T00:00:00.000Z",
};

describe("GET/POST /api/cron/run-queued-owned-filings", () => {
  beforeEach(() => {
    findAndClaimNextQueuedOwnedFiling.mockReset().mockResolvedValue(null);
    executeClaimedBbbFiling.mockReset().mockResolvedValue({ status: "accepted" });
    executeClaimedFtcFiling.mockReset().mockResolvedValue({ status: "accepted" });
    createClient.mockClear();
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("OWNED_FILING_SUBMIT_ARMED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("configures a long maxDuration so one bounded submit cannot overrun the function", () => {
    expect(maxDuration).toBe(800);
  });

  it("returns processed:0 when there is nothing queued (no execution)", async () => {
    const res = await GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 0 });
    expect(executeClaimedBbbFiling).not.toHaveBeenCalled();
    expect(executeClaimedFtcFiling).not.toHaveBeenCalled();
  });

  it("never claims or executes when OWNED_FILING_SUBMIT_ARMED is unset (fail closed)", async () => {
    vi.stubEnv("OWNED_FILING_SUBMIT_ARMED", "");
    const res = await GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      processed: 0,
      claimed: 0,
      skipped: "owned_filing_submit_unarmed",
    });
    expect(findAndClaimNextQueuedOwnedFiling).not.toHaveBeenCalled();
    expect(executeClaimedBbbFiling).not.toHaveBeenCalled();
    expect(executeClaimedFtcFiling).not.toHaveBeenCalled();
  });

  it("never claims when OWNED_FILING_SUBMIT_ARMED is false", async () => {
    vi.stubEnv("OWNED_FILING_SUBMIT_ARMED", "false");
    const res = await POST(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: "owned_filing_submit_unarmed", claimed: 0 });
    expect(findAndClaimNextQueuedOwnedFiling).not.toHaveBeenCalled();
  });

  it("concurrent unarmed worker calls cannot bypass the gate", async () => {
    vi.stubEnv("OWNED_FILING_SUBMIT_ARMED", "");
    const results = await Promise.all([
      GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` })),
      POST(buildRequest({ authorization: `Bearer ${CRON_SECRET}` })),
      GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` })),
    ]);
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ processed: 0, claimed: 0, skipped: "owned_filing_submit_unarmed" });
    }
    expect(findAndClaimNextQueuedOwnedFiling).not.toHaveBeenCalled();
    expect(executeClaimedBbbFiling).not.toHaveBeenCalled();
    expect(executeClaimedFtcFiling).not.toHaveBeenCalled();
  });

  it("executes a claimed FTC filing and reports the outcome when armed", async () => {
    findAndClaimNextQueuedOwnedFiling.mockResolvedValue({
      kind: "ftc",
      userId: "user_1",
      caseId: CLAIMED_TASK.case_id,
      task: CLAIMED_TASK,
    });
    const res = await POST(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, processed: 1, kind: "ftc", status: "accepted" });
    expect(executeClaimedFtcFiling).toHaveBeenCalledTimes(1);
    expect(executeClaimedBbbFiling).not.toHaveBeenCalled();
  });

  it("executes a claimed BBB filing when armed", async () => {
    findAndClaimNextQueuedOwnedFiling.mockResolvedValue({
      kind: "bbb",
      userId: "user_1",
      caseId: CLAIMED_TASK.case_id,
      task: CLAIMED_TASK,
    });
    executeClaimedBbbFiling.mockResolvedValue({ status: "failed", error: "no confirm" });
    const res = await GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, processed: 1, kind: "bbb", status: "failed" });
    expect(executeClaimedBbbFiling).toHaveBeenCalledTimes(1);
    expect(executeClaimedFtcFiling).not.toHaveBeenCalled();
  });

  it("rejects requests without the cron bearer secret", async () => {
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
    expect(findAndClaimNextQueuedOwnedFiling).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the cron secret is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(503);
    expect(findAndClaimNextQueuedOwnedFiling).not.toHaveBeenCalled();
  });

  it("returns 503 when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const res = await GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(503);
    expect(findAndClaimNextQueuedOwnedFiling).not.toHaveBeenCalled();
  });
});
