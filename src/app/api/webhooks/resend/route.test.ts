import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRecord = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: () => ({}) })),
}));

vi.mock("@/lib/justice/consumerClosedNotificationDelivery", () => ({
  recordConsumerClosedNotificationDeliveryEvent: (...args: unknown[]) => mockRecord(...args),
}));

import { POST } from "@/app/api/webhooks/resend/route";

const RAW_SECRET = Buffer.from("route-webhook-signing-key").toString("base64");
const SECRET = `whsec_${RAW_SECRET}`;

function signedRequest(
  body: string,
  opts: { signature?: string; id?: string; timestamp?: string } = {}
) {
  const id = opts.id ?? "msg_test";
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const sig =
    opts.signature ??
    `v1,${createHmac("sha256", Buffer.from(RAW_SECRET, "base64"))
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64")}`;
  return new NextRequest("http://localhost/api/webhooks/resend", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": sig,
    },
  });
}

beforeEach(() => {
  mockRecord.mockReset();
  vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/webhooks/resend", () => {
  it("records a valid delivered event", async () => {
    mockRecord.mockResolvedValue({ status: "confirmed", caseId: "case-1", state: "delivered" });
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_1" } });

    const res = await POST(signedRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, status: "confirmed" });
    expect(mockRecord).toHaveBeenCalledWith(expect.anything(), {
      messageId: "re_1",
      idempotencyKey: "",
      eventType: "email.delivered",
    });
  });

  it("records a bounced event as a fallback", async () => {
    mockRecord.mockResolvedValue({ status: "fallback", caseId: "case-1", state: "bounced" });
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: "re_2" } });

    const res = await POST(signedRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ status: "fallback", state: "bounced" });
    expect(mockRecord).toHaveBeenCalledWith(expect.anything(), {
      messageId: "re_2",
      idempotencyKey: "",
      eventType: "email.bounced",
    });
  });

  it("rejects an invalid signature with 401 and does not record", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_1" } });
    const res = await POST(signedRequest(body, { signature: "v1,not-a-real-signature" }));

    expect(res.status).toBe(401);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("acks unhandled event types without recording", async () => {
    const body = JSON.stringify({ type: "email.opened", data: { email_id: "re_1" } });
    const res = await POST(signedRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ status: "ignored_unhandled_type" });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("acks an unknown message id (no retry)", async () => {
    mockRecord.mockResolvedValue({ status: "ignored_unknown" });
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_missing" } });

    const res = await POST(signedRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ status: "ignored_unknown" });
  });

  it("returns 500 so the provider retries on a transient DB error", async () => {
    mockRecord.mockResolvedValue({ status: "error", reason: "marker_update_failed" });
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_1" } });

    const res = await POST(signedRequest(body));
    expect(res.status).toBe(500);
  });

  it("returns 503 when the webhook secret is not configured", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_1" } });
    const res = await POST(signedRequest(body));
    expect(res.status).toBe(503);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
