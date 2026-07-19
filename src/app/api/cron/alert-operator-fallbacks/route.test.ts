import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const reconcileOperatorFallbackAlerts = vi.fn();
const createClient = vi.fn((..._args: unknown[]) => ({ from: vi.fn() }));

vi.mock("@/lib/justice/operatorFallbackAlertReconciler", () => ({
  reconcileOperatorFallbackAlerts: (...args: unknown[]) => reconcileOperatorFallbackAlerts(...args),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

import { GET, POST, maxDuration } from "@/app/api/cron/alert-operator-fallbacks/route";

const CRON_SECRET = "test-cron-secret";

const SUMMARY = {
  scanned: 3,
  attempted: 2,
  sent: 2,
  skipped: 1,
  failed: 0,
  results: [],
};

function buildRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/cron/alert-operator-fallbacks", {
    method: "GET",
    headers,
  });
}

describe("GET/POST /api/cron/alert-operator-fallbacks", () => {
  beforeEach(() => {
    reconcileOperatorFallbackAlerts.mockReset().mockResolvedValue(SUMMARY);
    createClient.mockClear();
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs the operator fallback alert reconciler and returns its summary", async () => {
    const res = await GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alerts: SUMMARY });
    expect(reconcileOperatorFallbackAlerts).toHaveBeenCalledTimes(1);
  });

  it("supports operator-triggered POST with the same secret", async () => {
    const res = await POST(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(res.status).toBe(200);
    expect(reconcileOperatorFallbackAlerts).toHaveBeenCalledTimes(1);
  });

  it("rejects requests without the cron bearer secret", async () => {
    const res = await GET(buildRequest());

    expect(res.status).toBe(401);
    expect(reconcileOperatorFallbackAlerts).not.toHaveBeenCalled();
  });

  it("rejects requests with an incorrect cron bearer secret", async () => {
    const res = await GET(buildRequest({ authorization: "Bearer wrong" }));

    expect(res.status).toBe(401);
    expect(reconcileOperatorFallbackAlerts).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the cron secret is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(res.status).toBe(503);
    expect(reconcileOperatorFallbackAlerts).not.toHaveBeenCalled();
  });

  it("returns 503 when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const res = await GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(res.status).toBe(503);
    expect(reconcileOperatorFallbackAlerts).not.toHaveBeenCalled();
  });

  it("declares a runtime budget appropriate for a lightweight alerting scan", () => {
    expect(maxDuration).toBe(60);
  });
});
