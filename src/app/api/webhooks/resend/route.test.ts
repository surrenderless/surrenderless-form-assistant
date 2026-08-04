import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRecord = vi.fn();
const mockRecordDemandLetter = vi.fn();
const mockRecordPaymentDispute = vi.fn();
const mockRecordMerchantContact = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: () => ({}) })),
}));

vi.mock("@/lib/justice/consumerClosedNotificationDelivery", () => ({
  recordConsumerClosedNotificationDeliveryEvent: (...args: unknown[]) => mockRecord(...args),
}));

vi.mock("@/lib/justice/demandLetterEmailDelivery", () => ({
  recordDemandLetterEmailBounceEvent: (...args: unknown[]) => mockRecordDemandLetter(...args),
}));

vi.mock("@/lib/justice/paymentDisputeEmailDelivery", () => ({
  recordPaymentDisputeEmailBounceEvent: (...args: unknown[]) => mockRecordPaymentDispute(...args),
}));

vi.mock("@/lib/justice/merchantContactEmailDelivery", () => ({
  recordMerchantContactEmailBounceEvent: (...args: unknown[]) => mockRecordMerchantContact(...args),
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
  mockRecordDemandLetter.mockReset();
  mockRecordPaymentDispute.mockReset();
  mockRecordMerchantContact.mockReset();
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

  it("falls back to the filing-email bounce lanes when the closed-notification marker doesn't match", async () => {
    mockRecord.mockResolvedValue({ status: "ignored_unknown" });
    mockRecordDemandLetter.mockResolvedValue({ status: "ignored_unknown" });
    mockRecordPaymentDispute.mockResolvedValue({ status: "ignored_unknown" });
    mockRecordMerchantContact.mockResolvedValue({
      status: "recorded",
      caseId: "case-1",
      state: "bounced",
    });
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: "re_merchant_1" } });

    const res = await POST(signedRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, status: "recorded", state: "bounced" });
    expect(mockRecordDemandLetter).toHaveBeenCalledWith(expect.anything(), {
      messageId: "re_merchant_1",
      eventType: "email.bounced",
    });
    expect(mockRecordPaymentDispute).toHaveBeenCalledWith(expect.anything(), {
      messageId: "re_merchant_1",
      eventType: "email.bounced",
    });
    expect(mockRecordMerchantContact).toHaveBeenCalledWith(expect.anything(), {
      messageId: "re_merchant_1",
      eventType: "email.bounced",
    });
  });

  it("stops at the first filing-email lane that matches without trying the rest", async () => {
    mockRecord.mockResolvedValue({ status: "ignored_unknown" });
    mockRecordDemandLetter.mockResolvedValue({
      status: "recorded",
      caseId: "case-1",
      state: "complained",
    });
    const body = JSON.stringify({ type: "email.complained", data: { email_id: "re_demand_1" } });

    const res = await POST(signedRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ status: "recorded", state: "complained" });
    expect(mockRecordDemandLetter).toHaveBeenCalledTimes(1);
    expect(mockRecordPaymentDispute).not.toHaveBeenCalled();
    expect(mockRecordMerchantContact).not.toHaveBeenCalled();
  });

  it("does not try the filing-email lanes for a plain delivered event", async () => {
    mockRecord.mockResolvedValue({ status: "ignored_unknown" });
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_1" } });

    const res = await POST(signedRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ status: "ignored_unknown" });
    expect(mockRecordDemandLetter).not.toHaveBeenCalled();
    expect(mockRecordPaymentDispute).not.toHaveBeenCalled();
    expect(mockRecordMerchantContact).not.toHaveBeenCalled();
  });

  it("acks unknown when no lane — closed-notification or filing-email — matches", async () => {
    mockRecord.mockResolvedValue({ status: "ignored_unknown" });
    mockRecordDemandLetter.mockResolvedValue({ status: "ignored_unknown" });
    mockRecordPaymentDispute.mockResolvedValue({ status: "ignored_unknown" });
    mockRecordMerchantContact.mockResolvedValue({ status: "ignored_unknown" });
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: "re_nowhere" } });

    const res = await POST(signedRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, status: "ignored_unknown" });
  });

  it("returns 500 on the initial bounce when the lane recorded the delivery flip but could not confirm actionability", async () => {
    mockRecord.mockResolvedValue({ status: "ignored_unknown" });
    mockRecordDemandLetter.mockResolvedValue({ status: "error", reason: "task_reopen_failed" });
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: "re_demand_partial" } });

    const res = await POST(signedRequest(body));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toMatchObject({ ok: false, status: "error", reason: "task_reopen_failed" });
  });

  it("returns 200 on a replay once the previously-incomplete action is repaired", async () => {
    mockRecord.mockResolvedValue({ status: "ignored_unknown" });
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: "re_demand_repair" } });

    mockRecordDemandLetter.mockResolvedValueOnce({ status: "error", reason: "task_reopen_failed" });
    const first = await POST(signedRequest(body));
    expect(first.status).toBe(500);

    mockRecordDemandLetter.mockResolvedValueOnce({
      status: "recorded",
      caseId: "case-1",
      state: "bounced",
    });
    const second = await POST(signedRequest(body));
    const secondJson = await second.json();

    expect(second.status).toBe(200);
    expect(secondJson).toMatchObject({ ok: true, status: "recorded", state: "bounced" });
    expect(mockRecordDemandLetter).toHaveBeenCalledTimes(2);
  });

  it("returns 200 on a later replay once everything was already satisfied (harmless no-op)", async () => {
    mockRecord.mockResolvedValue({ status: "ignored_unknown" });
    mockRecordDemandLetter.mockResolvedValue({
      status: "recorded",
      caseId: "case-1",
      state: "bounced",
    });
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: "re_demand_settled" } });

    const first = await POST(signedRequest(body));
    const second = await POST(signedRequest(body));
    const third = await POST(signedRequest(body));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    expect(mockRecordDemandLetter).toHaveBeenCalledTimes(3);
  });

  it("returns 503 when the webhook secret is not configured", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_1" } });
    const res = await POST(signedRequest(body));
    expect(res.status).toBe(503);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
