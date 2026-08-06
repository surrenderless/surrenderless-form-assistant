import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const resolveStripeWebhookEnv = vi.fn();
const constructEvent = vi.fn();
const getStripeClient = vi.fn<(...args: unknown[]) => unknown>(() => ({
  webhooks: { constructEvent },
}));
const processStripeCheckoutCompletedEvent = vi.fn();
const createClient = vi.fn<(...args: unknown[]) => unknown>(() => ({ from: vi.fn() }));

vi.mock("@/lib/stripe/stripeEnv", () => ({
  resolveStripeWebhookEnv: (...args: unknown[]) => resolveStripeWebhookEnv(...args),
}));

vi.mock("@/lib/stripe/getStripeClient", () => ({
  getStripeClient: (...args: unknown[]) => getStripeClient(...args),
}));

vi.mock("@/lib/stripe/processStripeCheckoutCompletedEvent", () => ({
  processStripeCheckoutCompletedEvent: (...args: unknown[]) =>
    processStripeCheckoutCompletedEvent(...args),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

import { POST } from "@/app/api/webhooks/stripe/route";

const VALID_EVENT = {
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: { id: "cs_1", payment_status: "paid", metadata: { case_id: "c1", user_id: "u1" } } },
};

function buildRequest(body = "{}", headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/webhooks/stripe", () => {
  beforeEach(() => {
    resolveStripeWebhookEnv
      .mockReset()
      .mockReturnValue({ enabled: true, secretKey: "sk_test_x", webhookSecret: "whsec_x" });
    constructEvent.mockReset().mockReturnValue(VALID_EVENT);
    getStripeClient.mockClear();
    processStripeCheckoutCompletedEvent
      .mockReset()
      .mockResolvedValue({ status: "granted", case_id: "c1" });
    createClient.mockClear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("verifies the signature against the raw body and processes a granted payment", async () => {
    const res = await POST(buildRequest("raw-body", { "stripe-signature": "t=1,v1=abc" }));

    expect(constructEvent).toHaveBeenCalledWith("raw-body", "t=1,v1=abc", "whsec_x");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "granted", case_id: "c1" });
  });

  it("rejects a request with an invalid/missing signature without processing anything", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("signature mismatch");
    });

    const res = await POST(buildRequest("raw-body", { "stripe-signature": "bad" }));

    expect(res.status).toBe(401);
    expect(processStripeCheckoutCompletedEvent).not.toHaveBeenCalled();
  });

  it("returns 500 (so Stripe retries) when processing reports a real error", async () => {
    processStripeCheckoutCompletedEvent.mockResolvedValue({ status: "error", error: "db down" });

    const res = await POST(buildRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, status: "error", error: "db down" });
  });

  it("acks a redelivered event that still resolved to granted with 200, never retried", async () => {
    processStripeCheckoutCompletedEvent.mockResolvedValue({ status: "granted", case_id: "c1" });

    const res = await POST(buildRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "granted", case_id: "c1" });
  });

  it("acks an unhandled event type with 200", async () => {
    processStripeCheckoutCompletedEvent.mockResolvedValue({ status: "ignored_unhandled_type" });

    const res = await POST(buildRequest());

    expect(res.status).toBe(200);
  });

  it("fails closed with 503 when Stripe env is not configured", async () => {
    resolveStripeWebhookEnv.mockReturnValue({
      enabled: false,
      reason: "STRIPE_WEBHOOK_SECRET is not configured",
    });

    const res = await POST(buildRequest());

    expect(res.status).toBe(503);
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it("returns 503 when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const res = await POST(buildRequest());

    expect(res.status).toBe(503);
    expect(processStripeCheckoutCompletedEvent).not.toHaveBeenCalled();
  });
});
