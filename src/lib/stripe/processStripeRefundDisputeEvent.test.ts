import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSendRequest, EmailSendResult } from "@/lib/email/emailProvider";
import type { StripeWebhookEventLike } from "@/lib/stripe/processStripeCheckoutCompletedEvent";
import type { StripeSessionsLookup } from "@/lib/stripe/processStripeRefundDisputeEvent";

const timelineAppend = vi.fn(async () => null);
vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: () => timelineAppend(),
}));

type ProviderResolution =
  | { ok: true; provider: { name: string; send: (r: EmailSendRequest) => Promise<EmailSendResult> }; from: string }
  | { ok: false; reason: string };

let providerResolution: ProviderResolution;
const send = vi.fn(
  async (req: EmailSendRequest): Promise<EmailSendResult> => ({ ok: true, messageId: `msg_${req.idempotencyKey}` })
);

vi.mock("@/lib/email/resolveMerchantOutreachEmailProvider", () => ({
  resolveMerchantOutreachEmailProvider: () => providerResolution,
}));

import { processStripeRefundDisputeEvent } from "@/lib/stripe/processStripeRefundDisputeEvent";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_owner_1";

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
};

type Store = {
  payments: PaymentRow[];
  events: EventRow[];
  nextId: number;
  failInsert?: boolean;
  failClaimUpdate?: boolean;
  failMarkSentUpdate?: boolean;
  sessionsForPaymentIntent?: Record<string, string>;
};

function makeSupabase(store: Store): SupabaseClient {
  const from = (table: string) => {
    if (table === "justice_case_payments") {
      const filters: Record<string, string> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: string) => {
          filters[col] = val;
          return builder;
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
      const state: {
        op: "select" | "insert" | "update";
        filters: Record<string, string>;
        updatePayload?: Record<string, unknown>;
      } = { op: "select", filters: {} };

      const builder: Record<string, unknown> = {
        insert: (payload: Record<string, unknown>) => {
          state.op = "insert";
          state.updatePayload = payload;
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          state.op = "update";
          state.updatePayload = payload;
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
            Object.entries(state.filters).every(
              ([k, v]) => (e as unknown as Record<string, unknown>)[k] === v
            )
          );
          return { data: found ?? null, error: null };
        },
        // Real Supabase PostgrestFilterBuilder is itself thenable — production code sometimes
        // awaits an .update().eq().eq() chain directly without a terminal .select()/.maybeSingle()
        // (matching the established fire-and-forget update convention elsewhere in this codebase).
        then: (onFulfilled: (v: { data: unknown; error: unknown }) => unknown, onRejected?: (e: unknown) => unknown) =>
          Promise.resolve(state.op === "update" ? resolveUpdate() : { data: null, error: null }).then(
            onFulfilled,
            onRejected
          ),
      };

      function resolveInsert() {
        if (store.failInsert) return { data: null, error: { code: "XX000", message: "insert down" } };
        const payload = state.updatePayload as Record<string, unknown>;
        const dupe = store.events.find(
          (e) =>
            e.stripe_event_id === payload.stripe_event_id ||
            (e.event_category === payload.event_category && e.stripe_object_id === payload.stripe_object_id)
        );
        if (dupe) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
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
        };
        store.events.push(row);
        return { data: row, error: null };
      }

      function resolveUpdate() {
        const idx = store.events.findIndex((e) =>
          Object.entries(state.filters).every(
            ([k, v]) => (e as unknown as Record<string, unknown>)[k] === v
          )
        );
        if (idx < 0) return { data: null, error: null };
        const isClaim =
          "alert_status" in (state.updatePayload ?? {}) &&
          (state.updatePayload as Record<string, unknown>).alert_status === "sending";
        const isMarkSent =
          (state.updatePayload as Record<string, unknown>).alert_status === "sent";
        if (isClaim && store.failClaimUpdate) return { data: null, error: { message: "claim update down" } };
        if (isMarkSent && store.failMarkSentUpdate) return { data: null, error: { message: "mark sent down" } };
        store.events[idx] = { ...store.events[idx], ...(state.updatePayload as Partial<EventRow>) };
        return { data: store.events[idx], error: null };
      }

      return builder as unknown as ReturnType<SupabaseClient["from"]>;
    }

    throw new Error(`unexpected table ${table}`);
  };
  return { from } as unknown as SupabaseClient;
}

function makeSessionsLookup(store: Store): StripeSessionsLookup {
  return {
    list: async ({ payment_intent }) => {
      const sessionId = store.sessionsForPaymentIntent?.[payment_intent];
      return { data: sessionId ? [{ id: sessionId }] : [] };
    },
  };
}

function baseStore(overrides: Partial<Store> = {}): Store {
  return { payments: [], events: [], nextId: 0, ...overrides };
}

function matchedPaymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    case_id: CASE_ID,
    user_id: USER_ID,
    stripe_checkout_session_id: "cs_1",
    stripe_payment_intent_id: "pi_123",
    amount_total: 4900,
    ...overrides,
  };
}

function refundEvent(overrides: {
  id?: string;
  refundId?: string;
  paymentIntent?: string | { id: string } | null;
  charge?: string | { id: string } | null;
  amount?: number;
  currency?: string;
  status?: string;
} = {}): StripeWebhookEventLike {
  return {
    id: overrides.id ?? "evt_refund_1",
    type: "refund.created",
    data: {
      object: {
        id: overrides.refundId ?? "re_1",
        payment_intent: "paymentIntent" in overrides ? overrides.paymentIntent : "pi_123",
        charge: "charge" in overrides ? overrides.charge : "ch_1",
        amount: overrides.amount ?? 4900,
        currency: overrides.currency ?? "usd",
        status: overrides.status ?? "succeeded",
      },
    },
  };
}

function disputeCreatedEvent(overrides: {
  id?: string;
  disputeId?: string;
  paymentIntent?: string | { id: string } | null;
  charge?: string | { id: string } | null;
  amount?: number;
  currency?: string;
  status?: string;
  reason?: string;
  dueBySeconds?: number;
} = {}): StripeWebhookEventLike {
  return {
    id: overrides.id ?? "evt_dispute_1",
    type: "charge.dispute.created",
    data: {
      object: {
        id: overrides.disputeId ?? "dp_1",
        payment_intent: "paymentIntent" in overrides ? overrides.paymentIntent : "pi_123",
        charge: "charge" in overrides ? overrides.charge : "ch_1",
        amount: overrides.amount ?? 4900,
        currency: overrides.currency ?? "usd",
        status: overrides.status ?? "needs_response",
        reason: overrides.reason ?? "fraudulent",
        evidence_details: { due_by: overrides.dueBySeconds ?? 1893456000 },
      },
    },
  };
}

function disputeClosedEvent(overrides: {
  id?: string;
  disputeId?: string;
  paymentIntent?: string | { id: string } | null;
  status?: string;
} = {}): StripeWebhookEventLike {
  return {
    id: overrides.id ?? "evt_dispute_closed_1",
    type: "charge.dispute.closed",
    data: {
      object: {
        id: overrides.disputeId ?? "dp_1",
        payment_intent: "paymentIntent" in overrides ? overrides.paymentIntent : "pi_123",
        charge: "ch_1",
        amount: 4900,
        currency: "usd",
        status: overrides.status ?? "won",
      },
    },
  };
}

describe("processStripeRefundDisputeEvent", () => {
  beforeEach(() => {
    send.mockClear();
    timelineAppend.mockClear();
    providerResolution = { ok: true, provider: { name: "mock", send }, from: "outreach@surrenderless.test" };
    vi.stubEnv("OPERATOR_ALERT_EMAIL", "alerts@surrenderless.test");
  });

  it("acks unsupported event types without recording anything", async () => {
    const store = baseStore();
    const result = await processStripeRefundDisputeEvent(
      makeSupabase(store),
      makeSessionsLookup(store),
      { id: "evt_x", type: "charge.refunded", data: { object: {} } }
    );

    expect(result).toEqual({ status: "ignored_unhandled_type" });
    expect(store.events).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("records and alerts a matched full refund, identifying it as a full refund", async () => {
    const store = baseStore({ payments: [matchedPaymentRow()] });
    const result = await processStripeRefundDisputeEvent(
      makeSupabase(store),
      makeSessionsLookup(store),
      refundEvent({ amount: 4900 })
    );

    expect(result).toEqual({ status: "recorded", matched: true, case_id: CASE_ID, alert: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].text).toMatch(/full refund/);
    expect(store.events[0].alert_status).toBe("sent");
    expect(timelineAppend).toHaveBeenCalledTimes(1);
  });

  it("records and alerts a matched partial refund, identifying it as a partial refund", async () => {
    const store = baseStore({ payments: [matchedPaymentRow({ amount_total: 4900 })] });
    const result = await processStripeRefundDisputeEvent(
      makeSupabase(store),
      makeSessionsLookup(store),
      refundEvent({ amount: 1000 })
    );

    expect(result.status).toBe("recorded");
    expect(send.mock.calls[0][0].text).toMatch(/partial refund/);
  });

  it("records and alerts an unmatched refund with its Stripe identifiers, returning 200-equivalent success", async () => {
    const store = baseStore({ payments: [] });
    const result = await processStripeRefundDisputeEvent(
      makeSupabase(store),
      makeSessionsLookup(store),
      refundEvent({ paymentIntent: "pi_unknown" })
    );

    expect(result).toEqual({ status: "recorded", matched: false, case_id: null, alert: "sent" });
    expect(send.mock.calls[0][0].text).toContain("pi_unknown");
    expect(send.mock.calls[0][0].text).toContain("re_1");
    expect(timelineAppend).not.toHaveBeenCalled();
  });

  it("dispute-created alert prominently includes evidence due-by, status, reason, and amount", async () => {
    const store = baseStore({ payments: [matchedPaymentRow()] });
    const result = await processStripeRefundDisputeEvent(
      makeSupabase(store),
      makeSessionsLookup(store),
      disputeCreatedEvent({ dueBySeconds: 1893456000, status: "needs_response", reason: "fraudulent" })
    );

    expect(result.status).toBe("recorded");
    const body = send.mock.calls[0][0].text;
    expect(body).toContain(new Date(1893456000 * 1000).toISOString());
    expect(body).toContain("needs_response");
    expect(body).toContain("fraudulent");
    expect(body).toContain("49.00");
  });

  it("dispute-closed alert includes the resolution and is a separate alert from dispute-created on the same dispute id", async () => {
    const store = baseStore({ payments: [matchedPaymentRow()] });
    await processStripeRefundDisputeEvent(makeSupabase(store), makeSessionsLookup(store), disputeCreatedEvent());
    const closed = await processStripeRefundDisputeEvent(
      makeSupabase(store),
      makeSessionsLookup(store),
      disputeClosedEvent({ status: "won" })
    );

    expect(closed).toEqual({ status: "recorded", matched: true, case_id: CASE_ID, alert: "sent" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].text).toContain("won");
    expect(store.events).toHaveLength(2);
  });

  it("falls back through the nullable PaymentIntent to the Charge id, still recording (unmatched, since no charge index exists)", async () => {
    const store = baseStore({ payments: [matchedPaymentRow()] });
    const result = await processStripeRefundDisputeEvent(
      makeSupabase(store),
      makeSessionsLookup(store),
      refundEvent({ paymentIntent: null, charge: "ch_fallback" })
    );

    expect(result).toEqual({ status: "recorded", matched: false, case_id: null, alert: "sent" });
    expect(store.events[0].stripe_charge_id).toBe("ch_fallback");
    expect(store.events[0].stripe_payment_intent_id).toBeNull();
  });

  it("matches a legacy payment (no stored payment_intent) via the bounded Checkout Session fallback", async () => {
    const store = baseStore({
      payments: [matchedPaymentRow({ stripe_payment_intent_id: null, stripe_checkout_session_id: "cs_legacy" })],
      sessionsForPaymentIntent: { pi_123: "cs_legacy" },
    });
    const result = await processStripeRefundDisputeEvent(
      makeSupabase(store),
      makeSessionsLookup(store),
      refundEvent({ paymentIntent: "pi_123" })
    );

    expect(result).toEqual({ status: "recorded", matched: true, case_id: CASE_ID, alert: "sent" });
  });

  it("is idempotent on redelivery of the same Stripe event id — records once, alerts once", async () => {
    const store = baseStore({ payments: [matchedPaymentRow()] });
    const supabase = makeSupabase(store);
    const sessions = makeSessionsLookup(store);

    const first = await processStripeRefundDisputeEvent(supabase, sessions, refundEvent());
    const second = await processStripeRefundDisputeEvent(supabase, sessions, refundEvent());

    expect(first.status).toBe("recorded");
    expect(second).toEqual({ status: "recorded", matched: true, case_id: CASE_ID, alert: "already_sent" });
    expect(store.events).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(timelineAppend).toHaveBeenCalledTimes(1);
  });

  it("is idempotent across two DIFFERENT Stripe event ids describing the same underlying refund object", async () => {
    const store = baseStore({ payments: [matchedPaymentRow()] });
    const supabase = makeSupabase(store);
    const sessions = makeSessionsLookup(store);

    const first = await processStripeRefundDisputeEvent(supabase, sessions, refundEvent({ id: "evt_A" }));
    const second = await processStripeRefundDisputeEvent(supabase, sessions, refundEvent({ id: "evt_B" }));

    expect(first.status).toBe("recorded");
    expect(second).toEqual({ status: "recorded", matched: true, case_id: CASE_ID, alert: "already_sent" });
    expect(store.events).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("resists a concurrent duplicate delivery racing the alert-send claim — exactly one email is sent, and the loser gets a retryable error rather than a false success", async () => {
    const store = baseStore({ payments: [matchedPaymentRow()] });
    const supabase = makeSupabase(store);
    const sessions = makeSessionsLookup(store);

    // Simulate near-simultaneous redelivery: both calls race past the initial insert/lookup
    // before either completes the claim+send, by running them concurrently via Promise.all. The
    // loser must never fabricate "already_sent" while the winner's send is still in flight (or
    // failed to record) — it asks for a retry instead, so Stripe's own redelivery converges.
    const [a, b] = await Promise.all([
      processStripeRefundDisputeEvent(supabase, sessions, refundEvent()),
      processStripeRefundDisputeEvent(supabase, sessions, refundEvent()),
    ]);

    const results = [a, b];
    const sentCount = results.filter((r) => r.status === "recorded" && r.alert === "sent").length;
    const errorCount = results.filter((r) => r.status === "error").length;
    expect(sentCount).toBe(1);
    expect(errorCount).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);

    // Stripe would redeliver the errored request; the retry must find the row already 'sent'
    // and correctly report success without sending a second email.
    const retry = await processStripeRefundDisputeEvent(supabase, sessions, refundEvent());
    expect(retry).toEqual({ status: "recorded", matched: true, case_id: CASE_ID, alert: "already_sent" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not send a duplicate alert when charge.refunded is also (hypothetically) received for a refund already recorded via refund.created", async () => {
    // This codebase deliberately does NOT handle charge.refunded at all (refund.created is the
    // sole refund source per Stripe's own guidance) — proving it is ignored, not double-counted.
    const store = baseStore({ payments: [matchedPaymentRow()] });
    const supabase = makeSupabase(store);
    const sessions = makeSessionsLookup(store);

    await processStripeRefundDisputeEvent(supabase, sessions, refundEvent());
    const chargeRefunded = await processStripeRefundDisputeEvent(supabase, sessions, {
      id: "evt_charge_refunded",
      type: "charge.refunded",
      data: { object: { id: "ch_1" } },
    });

    expect(chargeRefunded).toEqual({ status: "ignored_unhandled_type" });
    expect(store.events).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("returns malformed for an event object missing its Stripe object id", async () => {
    const store = baseStore();
    const result = await processStripeRefundDisputeEvent(makeSupabase(store), makeSessionsLookup(store), {
      id: "evt_bad",
      type: "refund.created",
      data: { object: { amount: 100 } },
    });

    expect(result).toEqual({ status: "malformed" });
    expect(store.events).toHaveLength(0);
  });

  it("returns a retryable error (not 200) when the ledger insert fails for a non-duplicate reason", async () => {
    const store = baseStore({ failInsert: true });
    const result = await processStripeRefundDisputeEvent(
      makeSupabase(store),
      makeSessionsLookup(store),
      refundEvent()
    );

    expect(result).toEqual({ status: "error", error: "insert down" });
    expect(send).not.toHaveBeenCalled();
  });

  it("reverts the claim to pending and returns a retryable error when the send fails, so a webhook retry re-attempts it", async () => {
    send.mockResolvedValueOnce({ ok: false, error: "provider down", retryable: true });
    const store = baseStore({ payments: [matchedPaymentRow()] });
    const result = await processStripeRefundDisputeEvent(
      makeSupabase(store),
      makeSessionsLookup(store),
      refundEvent()
    );

    expect(result).toEqual({ status: "error", error: "provider down" });
    expect(store.events[0].alert_status).toBe("pending");
  });

  it("acks success without sending when OPERATOR_ALERT_EMAIL is not configured, leaving the row visibly pending", async () => {
    vi.stubEnv("OPERATOR_ALERT_EMAIL", "");
    const store = baseStore({ payments: [matchedPaymentRow()] });
    const result = await processStripeRefundDisputeEvent(
      makeSupabase(store),
      makeSessionsLookup(store),
      refundEvent()
    );

    expect(result).toEqual({ status: "recorded", matched: true, case_id: CASE_ID, alert: "skipped_no_recipient" });
    expect(store.events[0].alert_status).toBe("pending");
    expect(send).not.toHaveBeenCalled();
  });
});
