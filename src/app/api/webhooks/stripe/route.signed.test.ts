import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSendRequest, EmailSendResult } from "@/lib/email/emailProvider";

/**
 * Route-level coverage using REAL Stripe signature verification — no mocking of
 * `stripe.webhooks.constructEvent` or the Stripe SDK itself. Only Supabase (the database) and
 * the outbound email provider are mocked. Every request below is signed with
 * `Stripe.webhooks.generateTestHeaderString`, the same helper Stripe's own docs recommend for
 * exercising a webhook handler's signature verification end-to-end.
 */

const WEBHOOK_SECRET = "whsec_test_secret_for_signed_route_tests";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "user_signed_route_1";

type PaymentRow = {
  case_id: string;
  user_id: string;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string | null;
  amount_total: number | null;
};

type EventRow = {
  id: string;
  stripe_event_id: string;
  event_category: string;
  stripe_object_id: string;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  case_id: string | null;
  user_id: string | null;
  matched: boolean;
  amount: number | null;
  currency: string | null;
  stripe_status: string | null;
  dispute_reason: string | null;
  evidence_due_by: string | null;
  alert_status: "pending" | "sending" | "sent";
  alert_message_id: string | null;
  updated_at: string;
};

type CaseRow = { id: string; user_id: string; paid_at: string | null };

type Store = {
  cases: CaseRow[];
  payments: PaymentRow[];
  events: EventRow[];
  nextId: number;
  failEventInsert?: boolean;
};

function makeSupabase(store: Store): SupabaseClient {
  const from = (table: string) => {
    if (table === "justice_cases") {
      const filters: Record<string, string> = {};
      let updatePayload: Record<string, unknown> | undefined;
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (payload: Record<string, unknown>) => {
          updatePayload = payload;
          return builder;
        },
        eq: (col: string, val: string) => {
          filters[col] = val;
          return builder;
        },
        is: async () => {
          const idx = store.cases.findIndex(
            (c) => c.id === filters.id && c.user_id === filters.user_id && c.paid_at === null
          );
          if (idx >= 0 && updatePayload) {
            store.cases[idx] = { ...store.cases[idx], ...(updatePayload as Partial<CaseRow>) };
          }
          return { data: null, error: null };
        },
        maybeSingle: async () => {
          const found = store.cases.find((c) => c.id === filters.id && c.user_id === filters.user_id);
          return { data: found ? { id: found.id, paid_at: found.paid_at } : null, error: null };
        },
      };
      return builder as unknown as ReturnType<SupabaseClient["from"]>;
    }

    if (table === "justice_case_payments") {
      const filters: Record<string, string> = {};
      let insertPayload: Record<string, unknown> | undefined;
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (payload: Record<string, unknown>) => {
          insertPayload = payload;
          return builder;
        },
        eq: (col: string, val: string) => {
          filters[col] = val;
          return builder;
        },
        then: (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) => {
          if (insertPayload) {
            store.payments.push({
              case_id: String(insertPayload.case_id),
              user_id: String(insertPayload.user_id),
              stripe_checkout_session_id: String(insertPayload.stripe_checkout_session_id),
              stripe_payment_intent_id: (insertPayload.stripe_payment_intent_id as string | null) ?? null,
              amount_total: (insertPayload.amount_total as number | null) ?? null,
            });
          }
          return Promise.resolve(onFulfilled({ data: null, error: null }));
        },
        maybeSingle: async () => {
          const found = store.payments.find((p) =>
            Object.entries(filters).every(([k, v]) => (p as unknown as Record<string, unknown>)[k] === v)
          );
          return { data: found ?? null, error: null };
        },
      };
      return builder as unknown as ReturnType<SupabaseClient["from"]>;
    }

    if (table === "justice_case_payment_events") {
      const state: { op: "select" | "insert" | "update"; filters: Record<string, string>; payload?: Record<string, unknown> } = {
        op: "select",
        filters: {},
      };
      const builder: Record<string, unknown> = {
        insert: (payload: Record<string, unknown>) => {
          state.op = "insert";
          state.payload = payload;
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          state.op = "update";
          state.payload = payload;
          return builder;
        },
        select: () => builder,
        eq: (col: string, val: string) => {
          state.filters[col] = val;
          return builder;
        },
        single: async () => resolveInsert(),
        maybeSingle: async () => {
          if (state.op === "update") return resolveUpdate();
          const found = store.events.find((e) =>
            Object.entries(state.filters).every(([k, v]) => (e as unknown as Record<string, unknown>)[k] === v)
          );
          return { data: found ?? null, error: null };
        },
        then: (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
          Promise.resolve(state.op === "update" ? resolveUpdate() : { data: null, error: null }).then(onFulfilled),
      };

      function resolveInsert() {
        if (store.failEventInsert) return { data: null, error: { code: "XX000", message: "insert down" } };
        const payload = state.payload as Record<string, unknown>;
        const dupe = store.events.find(
          (e) =>
            e.stripe_event_id === payload.stripe_event_id ||
            (e.event_category === payload.event_category && e.stripe_object_id === payload.stripe_object_id)
        );
        if (dupe) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        store.nextId += 1;
        const row: EventRow = {
          id: `evrow_${store.nextId}`,
          stripe_event_id: String(payload.stripe_event_id),
          event_category: String(payload.event_category),
          stripe_object_id: String(payload.stripe_object_id),
          stripe_payment_intent_id: (payload.stripe_payment_intent_id as string | null) ?? null,
          stripe_charge_id: (payload.stripe_charge_id as string | null) ?? null,
          case_id: (payload.case_id as string | null) ?? null,
          user_id: (payload.user_id as string | null) ?? null,
          matched: Boolean(payload.matched),
          amount: (payload.amount as number | null) ?? null,
          currency: (payload.currency as string | null) ?? null,
          stripe_status: (payload.stripe_status as string | null) ?? null,
          dispute_reason: (payload.dispute_reason as string | null) ?? null,
          evidence_due_by: (payload.evidence_due_by as string | null) ?? null,
          alert_status: "pending",
          alert_message_id: null,
          updated_at: new Date().toISOString(),
        };
        store.events.push(row);
        return { data: row, error: null };
      }

      function resolveUpdate() {
        const idx = store.events.findIndex((e) =>
          Object.entries(state.filters).every(([k, v]) => (e as unknown as Record<string, unknown>)[k] === v)
        );
        if (idx < 0) return { data: null, error: null };
        // set_updated_at() fires unconditionally on every UPDATE, even a same-value
        // reassignment (the reclaim CAS's "sending" -> "sending").
        store.events[idx] = {
          ...store.events[idx],
          ...(state.payload as Partial<EventRow>),
          updated_at: new Date().toISOString(),
        };
        return { data: store.events[idx], error: null };
      }

      return builder as unknown as ReturnType<SupabaseClient["from"]>;
    }

    throw new Error(`unexpected table ${table}`);
  };
  return { from } as unknown as SupabaseClient;
}

let currentStore: Store;
const createClient = vi.fn(() => makeSupabase(currentStore));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => createClient(),
}));

const send = vi.fn(
  async (req: EmailSendRequest): Promise<EmailSendResult> => ({ ok: true, messageId: `msg_${req.idempotencyKey}` })
);
vi.mock("@/lib/email/resolveMerchantOutreachEmailProvider", () => ({
  resolveMerchantOutreachEmailProvider: () => ({
    ok: true,
    provider: { name: "mock", send: (r: EmailSendRequest) => send(r) },
    from: "outreach@surrenderless.test",
  }),
}));

// Real Stripe.webhooks (genuine HMAC signature verification — never mocked) wrapped with a
// network-free stub for checkout.sessions.list, so the bounded legacy-payment-intent fallback
// in processStripeRefundDisputeEvent never makes a real call to api.stripe.com in tests. This is
// the ONLY Stripe SDK surface stubbed; constructEvent/generateTestHeaderString run for real.
const sessionsList = vi.fn(async () => ({ data: [] as Array<{ id: string }> }));
vi.mock("@/lib/stripe/getStripeClient", async () => {
  const actualStripe = (await vi.importActual<typeof import("stripe")>("stripe")).default;
  const realClient = new actualStripe("sk_test_signed_route_real_webhooks", {
    apiVersion: "2025-08-27.basil",
  });
  return {
    getStripeClient: () => ({
      webhooks: realClient.webhooks,
      checkout: { sessions: { list: sessionsList } },
    }),
  };
});

import { POST } from "@/app/api/webhooks/stripe/route";

function baseStore(overrides: Partial<Store> = {}): Store {
  return { cases: [], payments: [], events: [], nextId: 0, ...overrides };
}

function sign(payload: string): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
}

async function postSigned(payload: object) {
  const body = JSON.stringify(payload);
  const req = new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": sign(body) },
    body,
  });
  return POST(req);
}

function refundPayload(overrides: {
  eventId?: string;
  refundId?: string;
  paymentIntent?: string | { id: string } | null;
  charge?: string | { id: string } | null;
  amount?: number;
} = {}) {
  return {
    id: overrides.eventId ?? "evt_signed_refund_1",
    type: "refund.created",
    data: {
      object: {
        id: overrides.refundId ?? "re_signed_1",
        payment_intent: "paymentIntent" in overrides ? overrides.paymentIntent : "pi_signed_1",
        charge: "charge" in overrides ? overrides.charge : "ch_signed_1",
        amount: overrides.amount ?? 4900,
        currency: "usd",
        status: "succeeded",
      },
    },
  };
}

function disputeCreatedPayload(overrides: { eventId?: string; disputeId?: string } = {}) {
  return {
    id: overrides.eventId ?? "evt_signed_dispute_created_1",
    type: "charge.dispute.created",
    data: {
      object: {
        id: overrides.disputeId ?? "dp_signed_1",
        payment_intent: "pi_signed_1",
        charge: "ch_signed_1",
        amount: 4900,
        currency: "usd",
        status: "needs_response",
        reason: "fraudulent",
        evidence_details: { due_by: 1893456000 },
      },
    },
  };
}

function disputeClosedPayload(overrides: { eventId?: string; disputeId?: string; status?: string } = {}) {
  return {
    id: overrides.eventId ?? "evt_signed_dispute_closed_1",
    type: "charge.dispute.closed",
    data: {
      object: {
        id: overrides.disputeId ?? "dp_signed_1",
        payment_intent: "pi_signed_1",
        charge: "ch_signed_1",
        amount: 4900,
        currency: "usd",
        status: overrides.status ?? "won",
      },
    },
  };
}

function checkoutCompletedPayload(overrides: { eventId?: string; sessionId?: string } = {}) {
  return {
    id: overrides.eventId ?? "evt_signed_checkout_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: overrides.sessionId ?? "cs_signed_1",
        payment_status: "paid",
        amount_total: 4900,
        currency: "usd",
        metadata: { case_id: CASE_ID, user_id: USER_ID },
        payment_intent: "pi_signed_checkout_1",
      },
    },
  };
}

function matchedPaymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    case_id: CASE_ID,
    user_id: USER_ID,
    stripe_checkout_session_id: "cs_signed_1",
    stripe_payment_intent_id: "pi_signed_1",
    amount_total: 4900,
    ...overrides,
  };
}

describe("POST /api/webhooks/stripe — real signature verification, signed payloads", () => {
  beforeEach(() => {
    send.mockClear();
    createClient.mockClear();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_signed_route");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("STRIPE_PRICE_ID", "price_test");
    vi.stubEnv("OPERATOR_ALERT_EMAIL", "alerts@surrenderless.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a payload with an invalid signature (proves signature verification actually runs)", async () => {
    const body = JSON.stringify(refundPayload());
    const req = new NextRequest("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
      body,
    });
    currentStore = baseStore();

    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it("existing checkout entitlement behavior is unchanged: a real signed checkout.session.completed still grants entitlement", async () => {
    currentStore = baseStore({ cases: [{ id: CASE_ID, user_id: USER_ID, paid_at: null }] });

    const res = await postSigned(checkoutCompletedPayload());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "granted", case_id: CASE_ID });
    expect(currentStore.cases[0].paid_at).toBeTruthy();
    expect(currentStore.payments[0].stripe_payment_intent_id).toBe("pi_signed_checkout_1");
  });

  it("records a matched partial refund and alerts once", async () => {
    currentStore = baseStore({ cases: [{ id: CASE_ID, user_id: USER_ID, paid_at: new Date().toISOString() }], payments: [matchedPaymentRow()] });

    const res = await postSigned(refundPayload({ amount: 1000 }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, status: "recorded", matched: true, case_id: CASE_ID, alert: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].text).toMatch(/partial refund/);
  });

  it("records an unmatched refund, alerts with Stripe identifiers, and still returns 200", async () => {
    currentStore = baseStore({ payments: [] });

    const res = await postSigned(refundPayload({ paymentIntent: "pi_unknown_signed" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: "recorded", matched: false, case_id: null, alert: "sent" });
    expect(send.mock.calls[0][0].text).toContain("pi_unknown_signed");
  });

  it("records a dispute-created event with its evidence deadline", async () => {
    currentStore = baseStore({ cases: [{ id: CASE_ID, user_id: USER_ID, paid_at: new Date().toISOString() }], payments: [matchedPaymentRow()] });

    const res = await postSigned(disputeCreatedPayload());

    expect(res.status).toBe(200);
    expect(send.mock.calls[0][0].text).toContain(new Date(1893456000 * 1000).toISOString());
  });

  it("records dispute-closed (won) and dispute-closed (lost) for two different disputes as two separate alerts with the resolution", async () => {
    currentStore = baseStore({ cases: [{ id: CASE_ID, user_id: USER_ID, paid_at: new Date().toISOString() }], payments: [matchedPaymentRow()] });

    const won = await postSigned(disputeClosedPayload({ disputeId: "dp_won", status: "won" }));
    const lost = await postSigned(
      disputeClosedPayload({ eventId: "evt_signed_dispute_closed_2", disputeId: "dp_lost", status: "lost" })
    );

    expect(won.status).toBe(200);
    expect(lost.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].text).toContain("won");
    expect(send.mock.calls[1][0].text).toContain("lost");
  });

  it("falls back to the Charge id when PaymentIntent is null on the event, recording it unmatched", async () => {
    currentStore = baseStore({ cases: [{ id: CASE_ID, user_id: USER_ID, paid_at: new Date().toISOString() }], payments: [matchedPaymentRow()] });

    const res = await postSigned(refundPayload({ paymentIntent: null, charge: "ch_signed_fallback" }));

    expect(res.status).toBe(200);
    expect(currentStore.events[0].stripe_payment_intent_id).toBeNull();
    expect(currentStore.events[0].stripe_charge_id).toBe("ch_signed_fallback");
    expect(currentStore.events[0].matched).toBe(false);
  });

  it("is idempotent on redelivery of the exact same signed event", async () => {
    currentStore = baseStore({ cases: [{ id: CASE_ID, user_id: USER_ID, paid_at: new Date().toISOString() }], payments: [matchedPaymentRow()] });
    const payload = refundPayload();

    const first = await postSigned(payload);
    const second = await postSigned(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await second.json()).alert).toBe("already_sent");
    expect(currentStore.events).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("is idempotent across two different signed event ids describing the same refund object", async () => {
    currentStore = baseStore({ cases: [{ id: CASE_ID, user_id: USER_ID, paid_at: new Date().toISOString() }], payments: [matchedPaymentRow()] });

    const first = await postSigned(refundPayload({ eventId: "evt_signed_A" }));
    const second = await postSigned(refundPayload({ eventId: "evt_signed_B" }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await second.json()).alert).toBe("already_sent");
    expect(currentStore.events).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("resists concurrent duplicate delivery of the same signed event — exactly one alert sent; the loser gets a retryable 500, and Stripe's redelivery converges", async () => {
    currentStore = baseStore({ cases: [{ id: CASE_ID, user_id: USER_ID, paid_at: new Date().toISOString() }], payments: [matchedPaymentRow()] });
    const payload = refundPayload();

    const [a, b] = await Promise.all([postSigned(payload), postSigned(payload)]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 500]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(currentStore.events).toHaveLength(1);

    // Stripe would redeliver the 500; the retry converges on the already-sent row.
    const retry = await postSigned(payload);
    expect(retry.status).toBe(200);
    expect((await retry.json()).alert).toBe("already_sent");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("acks an unsupported event type with 200 and records nothing", async () => {
    currentStore = baseStore();

    const res = await postSigned({ id: "evt_signed_unsupported", type: "invoice.paid", data: { object: {} } });

    expect(res.status).toBe(200);
    expect(currentStore.events).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns a 500 retryable response (not a 200 ack) when the ledger insert fails for a non-duplicate reason", async () => {
    currentStore = baseStore({ cases: [{ id: CASE_ID, user_id: USER_ID, paid_at: new Date().toISOString() }], payments: [matchedPaymentRow()], failEventInsert: true });

    const res = await postSigned(refundPayload());

    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBe(false);
  });

  it("reclaims a stale 'sending' row (simulating a crashed prior delivery) through the real signed route and sends exactly once", async () => {
    currentStore = baseStore({
      cases: [{ id: CASE_ID, user_id: USER_ID, paid_at: new Date().toISOString() }],
      payments: [matchedPaymentRow()],
      events: [
        {
          id: "evrow_stuck_signed_1",
          stripe_event_id: "evt_signed_refund_1",
          event_category: "refund",
          stripe_object_id: "re_signed_1",
          stripe_payment_intent_id: "pi_signed_1",
          stripe_charge_id: "ch_signed_1",
          case_id: CASE_ID,
          user_id: USER_ID,
          matched: true,
          amount: 4900,
          currency: "usd",
          stripe_status: "succeeded",
          dispute_reason: null,
          evidence_due_by: null,
          alert_status: "sending",
          alert_message_id: null,
          // Comfortably older than STALE_SENDING_RECLAIM_THRESHOLD_MS (60s); the route uses the
          // real wall clock (no nowMs override), so this must be real-time-anchored.
          updated_at: new Date(Date.now() - 90_000).toISOString(),
        },
      ],
    });

    const res = await postSigned(refundPayload());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: "recorded", matched: true, case_id: CASE_ID, alert: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(currentStore.events[0].alert_status).toBe("sent");
  });
});
