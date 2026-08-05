import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserOr401 = vi.fn();
const resolveStripeCheckoutEnv = vi.fn();
const stripeCheckoutSessionsCreate = vi.fn();
const getStripeClient = vi.fn<(...args: unknown[]) => unknown>(() => ({
  checkout: { sessions: { create: (...args: unknown[]) => stripeCheckoutSessionsCreate(...args) } },
}));

type CaseRow = { id: string; user_id: string; paid_at: string | null };

let casesStore: CaseRow[] = [];

vi.mock("@/server/requireUser", () => ({
  getUserOr401: (...args: unknown[]) => getUserOr401(...args),
}));

vi.mock("@/lib/stripe/stripeEnv", () => ({
  resolveStripeCheckoutEnv: (...args: unknown[]) => resolveStripeCheckoutEnv(...args),
}));

vi.mock("@/lib/stripe/getStripeClient", () => ({
  getStripeClient: (...args: unknown[]) => getStripeClient(...args),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== "justice_cases") throw new Error(`unexpected table ${table}`);
      const state: { eqFilters: Record<string, string> } = { eqFilters: {} };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: string) => {
          state.eqFilters[col] = val;
          return builder;
        },
        maybeSingle: async () => {
          const found = casesStore.find(
            (c) => c.id === state.eqFilters.id && c.user_id === state.eqFilters.user_id
          );
          return { data: found ?? null, error: null };
        },
      };
      return builder;
    },
  }),
}));

import { POST } from "@/app/api/justice/cases/[id]/checkout/route";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_1";

function buildRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/justice/cases/${CASE_ID}/checkout`, {
    method: "POST",
  });
}

function ctx(id: string = CASE_ID) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/justice/cases/[id]/checkout", () => {
  beforeEach(() => {
    getUserOr401.mockReset().mockReturnValue(USER_ID);
    resolveStripeCheckoutEnv
      .mockReset()
      .mockReturnValue({ enabled: true, secretKey: "sk_test_x", priceId: "price_123" });
    stripeCheckoutSessionsCreate
      .mockReset()
      .mockResolvedValue({ url: "https://checkout.stripe.com/session/abc" });
    getStripeClient.mockClear();
    casesStore = [{ id: CASE_ID, user_id: USER_ID, paid_at: null }];
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a checkout session scoped to the signed-in consumer's exact owned case", async () => {
    const res = await POST(buildRequest(), ctx());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/session/abc" });
    expect(stripeCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        line_items: [{ price: "price_123", quantity: 1 }],
        client_reference_id: CASE_ID,
        metadata: { case_id: CASE_ID, user_id: USER_ID },
        success_url: expect.stringContaining(`case=${CASE_ID}&checkout=success`),
        cancel_url: expect.stringContaining(`case=${CASE_ID}&checkout=cancelled`),
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) })
    );
  });

  it("never hardcodes a price — the Price ID comes only from the resolved Stripe env", async () => {
    resolveStripeCheckoutEnv.mockReturnValue({
      enabled: true,
      secretKey: "sk_test_x",
      priceId: "price_from_env_only",
    });

    await POST(buildRequest(), ctx());

    expect(stripeCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ line_items: [{ price: "price_from_env_only", quantity: 1 }] }),
      expect.anything()
    );
  });

  it("creates no subscription — mode is always one-time payment", async () => {
    await POST(buildRequest(), ctx());
    expect(stripeCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "payment" }),
      expect.anything()
    );
  });

  it("uses a stable, case-scoped idempotency key so retries/concurrent requests never create more than one payable session", async () => {
    await POST(buildRequest(), ctx());
    const firstKey = stripeCheckoutSessionsCreate.mock.calls[0][1]?.idempotencyKey;
    expect(firstKey).toBeTruthy();

    stripeCheckoutSessionsCreate.mockClear();
    await POST(buildRequest(), ctx());
    const secondKey = stripeCheckoutSessionsCreate.mock.calls[0][1]?.idempotencyKey;

    expect(secondKey).toBe(firstKey);
  });

  it("uses a different idempotency key for a different case, never reusing another case's key", async () => {
    const OTHER_CASE_ID = "22222222-2222-4222-8222-222222222222";
    casesStore.push({ id: OTHER_CASE_ID, user_id: USER_ID, paid_at: null });

    await POST(buildRequest(), ctx());
    const firstKey = stripeCheckoutSessionsCreate.mock.calls[0][1]?.idempotencyKey;

    stripeCheckoutSessionsCreate.mockClear();
    await POST(
      new NextRequest(`http://localhost/api/justice/cases/${OTHER_CASE_ID}/checkout`, {
        method: "POST",
      }),
      ctx(OTHER_CASE_ID)
    );
    const secondKey = stripeCheckoutSessionsCreate.mock.calls[0][1]?.idempotencyKey;

    expect(secondKey).not.toBe(firstKey);
  });

  it("rejects unauthenticated requests", async () => {
    getUserOr401.mockReturnValue(null);

    const res = await POST(buildRequest(), ctx());

    expect(res.status).toBe(401);
    expect(stripeCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("rejects an invalid case id", async () => {
    const res = await POST(buildRequest(), ctx("not-a-uuid"));
    expect(res.status).toBe(400);
    expect(stripeCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 404 for a case that does not exist or is not owned by the signed-in consumer — never scopes checkout to another user's case", async () => {
    casesStore = [{ id: CASE_ID, user_id: "someone_else", paid_at: null }];

    const res = await POST(buildRequest(), ctx());

    expect(res.status).toBe(404);
    expect(stripeCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("skips creating a new session when the case is already paid", async () => {
    casesStore = [{ id: CASE_ID, user_id: USER_ID, paid_at: "2026-08-01T00:00:00.000Z" }];

    const res = await POST(buildRequest(), ctx());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ alreadyPaid: true });
    expect(stripeCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when Stripe is not configured", async () => {
    resolveStripeCheckoutEnv.mockReturnValue({ enabled: false, reason: "STRIPE_PRICE_ID is not configured" });

    const res = await POST(buildRequest(), ctx());

    expect(res.status).toBe(503);
    expect(stripeCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 502 when Stripe session creation throws", async () => {
    stripeCheckoutSessionsCreate.mockRejectedValue(new Error("stripe down"));

    const res = await POST(buildRequest(), ctx());

    expect(res.status).toBe(502);
  });

  it("returns 502 when Stripe returns a session with no url", async () => {
    stripeCheckoutSessionsCreate.mockResolvedValue({ url: null });

    const res = await POST(buildRequest(), ctx());

    expect(res.status).toBe(502);
  });
});
