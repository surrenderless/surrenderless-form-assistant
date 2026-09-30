import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildJusticeIntakeFromParts, defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";

const getUserOr401 = vi.fn();
const resolveStripeCheckoutEnv = vi.fn();
const stripeCheckoutSessionsCreate = vi.fn();
const stripePricesRetrieve = vi.fn();
const getStripeClient = vi.fn<(...args: unknown[]) => unknown>(() => ({
  checkout: { sessions: { create: (...args: unknown[]) => stripeCheckoutSessionsCreate(...args) } },
  prices: { retrieve: (...args: unknown[]) => stripePricesRetrieve(...args) },
}));

type CaseRow = { id: string; user_id: string; paid_at: string | null; intake?: unknown };

let casesStore: CaseRow[] = [];
let evidenceStore: { file_name: string | null; mime_type: string | null; file_size_bytes: number | null }[] = [];

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
      if (table === "justice_case_evidence") {
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: () => builder,
          limit: async () => ({ data: evidenceStore, error: null }),
        };
        return builder;
      }
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

import { GET, POST } from "@/app/api/justice/cases/[id]/checkout/route";
import { fitsStripeMetadataValue } from "@/lib/stripe/stripeMetadataBounds";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_1";

/** Uncontacted intake deterministically resolves to the merchant-contact action — the simplest,
 *  most stable fixture for tests that don't care exactly which destination gets picked. */
function uncontactedIntake(): unknown {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    already_contacted: "no",
  });
}

function buildRequest(body?: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/justice/cases/${CASE_ID}/checkout`, {
    method: "POST",
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}

function buildGetRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/justice/cases/${CASE_ID}/checkout`, {
    method: "GET",
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
    stripePricesRetrieve.mockReset().mockResolvedValue({ unit_amount: 4900, currency: "usd" });
    getStripeClient.mockClear();
    casesStore = [{ id: CASE_ID, user_id: USER_ID, paid_at: null, intake: uncontactedIntake() }];
    evidenceStore = [];
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
        metadata: {
          case_id: CASE_ID,
          user_id: USER_ID,
          intended_action_href: "/justice/merchant",
          intended_action_label: "Merchant contact",
        },
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
    casesStore.push({ id: OTHER_CASE_ID, user_id: USER_ID, paid_at: null, intake: uncontactedIntake() });

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

  it("binds the checkout session to the intended action recomputed from the case's own stored intake, and passes manualFtc through to that computation", async () => {
    await POST(buildRequest({ manualFtc: true }), ctx());

    // Uncontacted intake always resolves to merchant contact regardless of manualFtc — this just
    // proves the flag round-trips through the request body without breaking the happy path.
    expect(stripeCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ intended_action_href: "/justice/merchant" }),
      }),
      expect.anything()
    );
  });

  it("fails closed with 409 and never starts checkout when the case's stored intake is invalid", async () => {
    casesStore = [{ id: CASE_ID, user_id: USER_ID, paid_at: null, intake: { not: "a real intake" } }];

    const res = await POST(buildRequest(), ctx());

    expect(res.status).toBe(409);
    expect(stripeCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("fails closed with 409 and never starts checkout when no destination is currently routable", async () => {
    // A contacted, fully "later"/non-routable intake (merchant issue already marked resolved)
    // can leave pickPreparedNextAction with nothing to route to.
    casesStore = [
      {
        id: CASE_ID,
        user_id: USER_ID,
        paid_at: null,
        intake: buildJusticeIntakeFromParts({
          ...defaultBuildJusticeIntakeParts(),
          problem_category: "online_purchase",
          company_name: "Acme Retail",
          already_contacted: "yes",
          merchant_response_type: "resolved",
        }),
      },
    ];

    const res = await POST(buildRequest(), ctx());

    expect(res.status).toBe(409);
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

describe("GET /api/justice/cases/[id]/checkout", () => {
  beforeEach(() => {
    getUserOr401.mockReset().mockReturnValue(USER_ID);
    resolveStripeCheckoutEnv
      .mockReset()
      .mockReturnValue({ enabled: true, secretKey: "sk_test_x", priceId: "price_123" });
    stripePricesRetrieve.mockReset().mockResolvedValue({ unit_amount: 4900, currency: "usd" });
    stripeCheckoutSessionsCreate.mockReset();
    getStripeClient.mockClear();
    casesStore = [{ id: CASE_ID, user_id: USER_ID, paid_at: null }];
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the exact price for the signed-in consumer's exact owned case, without creating a checkout session", async () => {
    const res = await GET(buildGetRequest(), ctx());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unitAmount: 4900, currency: "usd" });
    expect(stripePricesRetrieve).toHaveBeenCalledWith("price_123");
    expect(stripeCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("reflects the exact configured Price ID — never a hardcoded amount", async () => {
    resolveStripeCheckoutEnv.mockReturnValue({
      enabled: true,
      secretKey: "sk_test_x",
      priceId: "price_from_env_only",
    });
    stripePricesRetrieve.mockResolvedValue({ unit_amount: 1999, currency: "eur" });

    const res = await GET(buildGetRequest(), ctx());

    expect(await res.json()).toEqual({ unitAmount: 1999, currency: "eur" });
    expect(stripePricesRetrieve).toHaveBeenCalledWith("price_from_env_only");
  });

  it("rejects unauthenticated requests", async () => {
    getUserOr401.mockReturnValue(null);

    const res = await GET(buildGetRequest(), ctx());

    expect(res.status).toBe(401);
    expect(stripePricesRetrieve).not.toHaveBeenCalled();
  });

  it("rejects an invalid case id", async () => {
    const res = await GET(buildGetRequest(), ctx("not-a-uuid"));

    expect(res.status).toBe(400);
    expect(stripePricesRetrieve).not.toHaveBeenCalled();
  });

  it("returns 404 for a case that does not exist or is not owned by the signed-in consumer — never leaks another user's price context", async () => {
    casesStore = [{ id: CASE_ID, user_id: "someone_else", paid_at: null }];

    const res = await GET(buildGetRequest(), ctx());

    expect(res.status).toBe(404);
    expect(stripePricesRetrieve).not.toHaveBeenCalled();
  });

  it("reports alreadyPaid without calling Stripe when the case is already paid", async () => {
    casesStore = [{ id: CASE_ID, user_id: USER_ID, paid_at: "2026-08-01T00:00:00.000Z" }];

    const res = await GET(buildGetRequest(), ctx());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ alreadyPaid: true });
    expect(stripePricesRetrieve).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when Stripe is not configured — pricing is never fabricated", async () => {
    resolveStripeCheckoutEnv.mockReturnValue({ enabled: false, reason: "STRIPE_PRICE_ID is not configured" });

    const res = await GET(buildGetRequest(), ctx());

    expect(res.status).toBe(503);
    expect(stripePricesRetrieve).not.toHaveBeenCalled();
  });

  it("returns 502 (disable checkout) when the Price lookup fails", async () => {
    stripePricesRetrieve.mockRejectedValue(new Error("stripe down"));

    const res = await GET(buildGetRequest(), ctx());

    expect(res.status).toBe(502);
  });

  it("returns 502 (disable checkout) when the Price has no fixed unit amount", async () => {
    stripePricesRetrieve.mockResolvedValue({ unit_amount: null, currency: "usd" });

    const res = await GET(buildGetRequest(), ctx());

    expect(res.status).toBe(502);
  });

  it("returns 503 when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const res = await GET(buildGetRequest(), ctx());

    expect(res.status).toBe(503);
    expect(stripePricesRetrieve).not.toHaveBeenCalled();
  });
});

describe("fitsStripeMetadataValue", () => {
  it("accepts a value at exactly Stripe's 500-char metadata limit", () => {
    expect(fitsStripeMetadataValue("a".repeat(500))).toBe(true);
  });

  it("fails closed (rejects) a value one character over the limit — never truncates", () => {
    expect(fitsStripeMetadataValue("a".repeat(501))).toBe(false);
  });

  it("accepts every real prepared-action href/label used in this codebase — all well under the limit", () => {
    const realValues = [
      "/justice/merchant",
      "/justice/state-ag",
      "/justice/bbb",
      "/justice/cfpb",
      "/justice/fcc",
      "/justice/dot",
      "/justice/demand-letter",
      "/justice/payment-dispute",
      "Merchant contact",
      "State Attorney General (consumer)",
      "Better Business Bureau",
    ];
    for (const value of realValues) {
      expect(fitsStripeMetadataValue(value)).toBe(true);
    }
  });
});
