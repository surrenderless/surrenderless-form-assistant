import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const reconcileRecipientRequiredConsumerReminders = vi.fn();
const createClient = vi.fn(() => ({ from: vi.fn() }));

vi.mock("@/lib/justice/reconcileRecipientRequiredConsumerReminders", () => ({
  reconcileRecipientRequiredConsumerReminders: (...args: unknown[]) =>
    reconcileRecipientRequiredConsumerReminders(...args),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

import { GET, POST, maxDuration } from "@/app/api/cron/notify-recipient-required-consumers/route";

const CRON_SECRET = "test-cron-secret";

const CLEAN_SUMMARY = {
  scanned: 4,
  attempted: 1,
  sent: 1,
  skipped: 3,
  failed: 0,
  results: [],
};

const FAILING_SUMMARY = {
  scanned: 4,
  attempted: 1,
  sent: 0,
  skipped: 3,
  failed: 1,
  results: [
    {
      case_id: "case-1",
      user_id: "u1",
      task_id: "task-1",
      lane: "merchant_contact",
      kind: "failed",
      reason: "consumer_recipient_unresolved",
    },
  ],
};

function buildRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/cron/notify-recipient-required-consumers", {
    method: "GET",
    headers,
  });
}

describe("GET/POST /api/cron/notify-recipient-required-consumers", () => {
  beforeEach(() => {
    reconcileRecipientRequiredConsumerReminders.mockReset().mockResolvedValue(CLEAN_SUMMARY);
    createClient.mockClear();
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 200 with ok: true when there are no failures", async () => {
    const res = await GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ...CLEAN_SUMMARY });
    expect(reconcileRecipientRequiredConsumerReminders).toHaveBeenCalledTimes(1);
  });

  it("returns a 500-range status with ok: false when the summary reports failures — monitoring must be able to detect a stuck reminder", async () => {
    reconcileRecipientRequiredConsumerReminders.mockResolvedValue(FAILING_SUMMARY);

    const res = await GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, ...FAILING_SUMMARY });
  });

  it("supports operator-triggered POST with the same secret", async () => {
    const res = await POST(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(res.status).toBe(200);
    expect(reconcileRecipientRequiredConsumerReminders).toHaveBeenCalledTimes(1);
  });

  it("rejects requests without the cron bearer secret", async () => {
    const res = await GET(buildRequest());

    expect(res.status).toBe(401);
    expect(reconcileRecipientRequiredConsumerReminders).not.toHaveBeenCalled();
  });

  it("rejects requests with an incorrect cron bearer secret", async () => {
    const res = await GET(buildRequest({ authorization: "Bearer wrong" }));

    expect(res.status).toBe(401);
    expect(reconcileRecipientRequiredConsumerReminders).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the cron secret is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(res.status).toBe(503);
    expect(reconcileRecipientRequiredConsumerReminders).not.toHaveBeenCalled();
  });

  it("returns 503 when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const res = await GET(buildRequest({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(res.status).toBe(503);
    expect(reconcileRecipientRequiredConsumerReminders).not.toHaveBeenCalled();
  });

  it("declares a runtime budget appropriate for a daily notification sweep", () => {
    expect(maxDuration).toBe(60);
  });
});
