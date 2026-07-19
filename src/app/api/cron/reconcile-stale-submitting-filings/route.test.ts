import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const reconcileStaleSubmittingOwnedFilings = vi.fn();
const reconcileMissingOwnedFilingTasks = vi.fn();
const createClient = vi.fn((..._args: unknown[]) => ({ from: vi.fn() }));

vi.mock("@/lib/justice/reconcileStaleSubmittingOwnedFilings", () => ({
  reconcileStaleSubmittingOwnedFilings: (...args: unknown[]) =>
    reconcileStaleSubmittingOwnedFilings(...args),
}));

vi.mock("@/lib/justice/reconcileMissingOwnedFilingTasks", () => ({
  reconcileMissingOwnedFilingTasks: (...args: unknown[]) =>
    reconcileMissingOwnedFilingTasks(...args),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

import { GET, POST } from "@/app/api/cron/reconcile-stale-submitting-filings/route";

const CRON_SECRET = "test-cron-secret";

const SUMMARY = {
  scanned: 2,
  stale: 1,
  finalized_filed: 1,
  sent_to_operator: 0,
  ignored: 0,
  skipped: 1,
  errors: 0,
  results: [],
};

function buildRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/cron/reconcile-stale-submitting-filings", {
    method: "GET",
    headers,
  });
}

describe("GET/POST /api/cron/reconcile-stale-submitting-filings", () => {
  beforeEach(() => {
    reconcileStaleSubmittingOwnedFilings.mockReset().mockResolvedValue(SUMMARY);
    reconcileMissingOwnedFilingTasks.mockReset().mockResolvedValue({});
    createClient.mockClear();
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs only the stale-submitting reconciler and returns its summary", async () => {
    const res = await GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stale_submitting: SUMMARY });
    expect(reconcileStaleSubmittingOwnedFilings).toHaveBeenCalledTimes(1);
    // The lightweight recovery endpoint must never run the heavy missing-task ensure scan.
    expect(reconcileMissingOwnedFilingTasks).not.toHaveBeenCalled();
  });

  it("supports operator-triggered POST with the same secret", async () => {
    const res = await POST(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(res.status).toBe(200);
    expect(reconcileStaleSubmittingOwnedFilings).toHaveBeenCalledTimes(1);
    expect(reconcileMissingOwnedFilingTasks).not.toHaveBeenCalled();
  });

  it("rejects requests without the cron bearer secret", async () => {
    const res = await GET(buildRequest());

    expect(res.status).toBe(401);
    expect(reconcileStaleSubmittingOwnedFilings).not.toHaveBeenCalled();
  });

  it("rejects requests with an incorrect cron bearer secret", async () => {
    const res = await GET(buildRequest({ authorization: "Bearer wrong" }));

    expect(res.status).toBe(401);
    expect(reconcileStaleSubmittingOwnedFilings).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the cron secret is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(res.status).toBe(503);
    expect(reconcileStaleSubmittingOwnedFilings).not.toHaveBeenCalled();
  });

  it("returns 503 when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const res = await GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(res.status).toBe(503);
    expect(reconcileStaleSubmittingOwnedFilings).not.toHaveBeenCalled();
  });
});
