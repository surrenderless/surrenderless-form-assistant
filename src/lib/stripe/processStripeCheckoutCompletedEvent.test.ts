import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  processStripeCheckoutCompletedEvent,
  type StripeWebhookEventLike,
} from "@/lib/stripe/processStripeCheckoutCompletedEvent";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_owner_1";
const OTHER_USER_ID = "user_owner_2";

type CaseRow = { id: string; user_id: string; paid_at: string | null };
type PaymentRow = { stripe_event_id: string; case_id: string; user_id: string };

type Store = {
  cases: CaseRow[];
  payments: PaymentRow[];
  failInsert?: boolean;
  failCaseLookup?: boolean;
  /** Number of times the entitlement update should fail before succeeding — lets tests simulate
   *  "first delivery fails partway through, replay completes it" without a permanent failure. */
  failUpdateTimes?: number;
  failExistingPaymentLookup?: boolean;
};

function makeSupabase(store: Store): SupabaseClient {
  const from = (table: string) => {
    if (table === "justice_case_payments") {
      const state: { eqFilters: Record<string, string> } = { eqFilters: {} };
      const builder: Record<string, unknown> = {
        insert: async (payload: Record<string, unknown>) => {
          if (store.failInsert) return { data: null, error: { message: "insert down" } };
          const eventId = String(payload.stripe_event_id);
          if (store.payments.some((p) => p.stripe_event_id === eventId)) {
            return {
              data: null,
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            };
          }
          store.payments.push({
            stripe_event_id: eventId,
            case_id: String(payload.case_id),
            user_id: String(payload.user_id),
          });
          return { data: null, error: null };
        },
        select: () => builder,
        eq: (col: string, val: string) => {
          state.eqFilters[col] = val;
          return builder;
        },
        maybeSingle: async () => {
          if (store.failExistingPaymentLookup) {
            return { data: null, error: { message: "payment lookup down" } };
          }
          const found = store.payments.find(
            (p) => p.stripe_event_id === state.eqFilters.stripe_event_id
          );
          return {
            data: found ? { case_id: found.case_id, user_id: found.user_id } : null,
            error: null,
          };
        },
      };
      return builder as unknown as ReturnType<SupabaseClient["from"]>;
    }

    if (table === "justice_cases") {
      const state: {
        op: "select" | "update";
        eqFilters: Record<string, string>;
        updatePayload?: Record<string, unknown>;
      } = { op: "select", eqFilters: {} };

      const builder: Record<string, unknown> = {
        select: () => {
          state.op = "select";
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          state.op = "update";
          state.updatePayload = payload;
          return builder;
        },
        eq: (col: string, val: string) => {
          state.eqFilters[col] = val;
          return builder;
        },
        is: async () => {
          if (store.failUpdateTimes && store.failUpdateTimes > 0) {
            store.failUpdateTimes -= 1;
            return { data: null, error: { message: "update down" } };
          }
          const idx = store.cases.findIndex(
            (c) =>
              c.id === state.eqFilters.id && c.user_id === state.eqFilters.user_id && c.paid_at === null
          );
          if (idx >= 0 && state.updatePayload) {
            store.cases[idx] = { ...store.cases[idx], ...(state.updatePayload as Partial<CaseRow>) };
          }
          return { data: null, error: null };
        },
        maybeSingle: async () => {
          if (store.failCaseLookup) return { data: null, error: { message: "case lookup down" } };
          const found = store.cases.find(
            (c) => c.id === state.eqFilters.id && c.user_id === state.eqFilters.user_id
          );
          return {
            data: found ? { id: found.id, paid_at: found.paid_at } : null,
            error: null,
          };
        },
      };
      return builder as unknown as ReturnType<SupabaseClient["from"]>;
    }

    throw new Error(`unexpected table ${table}`);
  };
  return { from } as unknown as SupabaseClient;
}

function checkoutEvent(
  overrides: {
    id?: string;
    type?: string;
    sessionId?: string;
    paymentStatus?: string;
    caseId?: string;
    userId?: string;
    amountTotal?: number;
    currency?: string;
    metadata?: Record<string, unknown> | null;
  } = {}
): StripeWebhookEventLike {
  const metadata =
    overrides.metadata === null
      ? null
      : overrides.metadata ?? { case_id: overrides.caseId ?? CASE_ID, user_id: overrides.userId ?? USER_ID };
  return {
    id: overrides.id ?? "evt_1",
    type: overrides.type ?? "checkout.session.completed",
    data: {
      object: {
        id: overrides.sessionId ?? "cs_test_1",
        payment_status: overrides.paymentStatus ?? "paid",
        amount_total: overrides.amountTotal ?? 4900,
        currency: overrides.currency ?? "usd",
        metadata,
      },
    },
  };
}

function baseStore(overrides: Partial<Store> = {}): Store {
  return {
    cases: [{ id: CASE_ID, user_id: USER_ID, paid_at: null }],
    payments: [],
    ...overrides,
  };
}

describe("processStripeCheckoutCompletedEvent", () => {
  it("grants entitlement on a valid checkout.session.completed paid event", async () => {
    const store = baseStore();
    const result = await processStripeCheckoutCompletedEvent(makeSupabase(store), checkoutEvent());

    expect(result).toEqual({ status: "granted", case_id: CASE_ID });
    expect(store.cases[0].paid_at).toBeTruthy();
    expect(store.payments).toHaveLength(1);
  });

  it("grants entitlement on checkout.session.async_payment_succeeded", async () => {
    const store = baseStore();
    const result = await processStripeCheckoutCompletedEvent(
      makeSupabase(store),
      checkoutEvent({ type: "checkout.session.async_payment_succeeded", id: "evt_async" })
    );

    expect(result).toEqual({ status: "granted", case_id: CASE_ID });
    expect(store.cases[0].paid_at).toBeTruthy();
  });

  it("is idempotent on a redelivered event id after a fully successful first delivery — still reports granted, never double-records or re-updates", async () => {
    const store = baseStore();
    const supabase = makeSupabase(store);

    const first = await processStripeCheckoutCompletedEvent(supabase, checkoutEvent());
    expect(first).toEqual({ status: "granted", case_id: CASE_ID });
    const paidAtAfterFirst = store.cases[0].paid_at;

    const second = await processStripeCheckoutCompletedEvent(supabase, checkoutEvent());
    expect(second).toEqual({ status: "granted", case_id: CASE_ID });
    expect(store.payments).toHaveLength(1);
    expect(store.cases[0].paid_at).toBe(paidAtAfterFirst);
  });

  it("REGRESSION: first delivery records the payment but the entitlement update fails — replay must still unlock the case", async () => {
    const store = baseStore({ failUpdateTimes: 1 });
    const supabase = makeSupabase(store);

    const first = await processStripeCheckoutCompletedEvent(supabase, checkoutEvent());

    expect(first).toEqual({ status: "error", error: "update down" });
    // The payment WAS durably recorded even though the grant step failed.
    expect(store.payments).toHaveLength(1);
    expect(store.cases[0].paid_at).toBeNull();

    // Replay of the exact same event: the insert now hits the unique constraint (duplicate), but
    // must still walk through to the entitlement update rather than short-circuiting on
    // "already recorded" — this time the update succeeds and the case unlocks.
    const replay = await processStripeCheckoutCompletedEvent(supabase, checkoutEvent());

    expect(replay).toEqual({ status: "granted", case_id: CASE_ID });
    expect(store.payments).toHaveLength(1);
    expect(store.cases[0].paid_at).toBeTruthy();
  });

  it("keeps retrying (never grants) across repeated update failures until one finally succeeds", async () => {
    const store = baseStore({ failUpdateTimes: 2 });
    const supabase = makeSupabase(store);

    const first = await processStripeCheckoutCompletedEvent(supabase, checkoutEvent());
    expect(first.status).toBe("error");
    const second = await processStripeCheckoutCompletedEvent(supabase, checkoutEvent());
    expect(second.status).toBe("error");
    expect(store.cases[0].paid_at).toBeNull();

    const third = await processStripeCheckoutCompletedEvent(supabase, checkoutEvent());
    expect(third).toEqual({ status: "granted", case_id: CASE_ID });
    expect(store.cases[0].paid_at).toBeTruthy();
  });

  it("rejects (does not grant) when a redelivered event id's persisted payment belongs to a different case/user than this delivery claims", async () => {
    const store = baseStore();
    store.payments.push({
      stripe_event_id: "evt_1",
      case_id: "99999999-9999-4999-8999-999999999999",
      user_id: "someone-else",
    });

    const result = await processStripeCheckoutCompletedEvent(makeSupabase(store), checkoutEvent());

    expect(result).toEqual({
      status: "error",
      error: "Persisted payment record does not match this event's case/user",
    });
    expect(store.cases[0].paid_at).toBeNull();
  });

  it("surfaces a failure looking up the persisted payment on a redelivered event as a retriable error", async () => {
    const store = baseStore();
    store.payments.push({ stripe_event_id: "evt_1", case_id: CASE_ID, user_id: USER_ID });
    store.failExistingPaymentLookup = true;

    const result = await processStripeCheckoutCompletedEvent(makeSupabase(store), checkoutEvent());

    expect(result).toEqual({ status: "error", error: "payment lookup down" });
  });

  it("acks and ignores an unhandled event type without touching anything", async () => {
    const store = baseStore();
    const result = await processStripeCheckoutCompletedEvent(
      makeSupabase(store),
      checkoutEvent({ type: "checkout.session.expired" })
    );

    expect(result).toEqual({ status: "ignored_unhandled_type" });
    expect(store.cases[0].paid_at).toBeNull();
    expect(store.payments).toHaveLength(0);
  });

  it("ignores checkout.session.completed when payment_status is not paid (async still pending)", async () => {
    const store = baseStore();
    const result = await processStripeCheckoutCompletedEvent(
      makeSupabase(store),
      checkoutEvent({ paymentStatus: "unpaid" })
    );

    expect(result).toEqual({ status: "ignored_unpaid" });
    expect(store.cases[0].paid_at).toBeNull();
    expect(store.payments).toHaveLength(0);
  });

  it("treats a session with no metadata as malformed and grants nothing", async () => {
    const store = baseStore();
    const result = await processStripeCheckoutCompletedEvent(
      makeSupabase(store),
      checkoutEvent({ metadata: null })
    );

    expect(result).toEqual({ status: "malformed" });
    expect(store.payments).toHaveLength(0);
  });

  it("never unlocks another user's case when metadata's user_id doesn't match the case owner", async () => {
    const store = baseStore({ cases: [{ id: CASE_ID, user_id: OTHER_USER_ID, paid_at: null }] });
    const result = await processStripeCheckoutCompletedEvent(
      makeSupabase(store),
      checkoutEvent({ userId: USER_ID })
    );

    expect(result).toEqual({ status: "case_mismatch" });
    expect(store.cases[0].paid_at).toBeNull();
    // The payment event is still durably recorded (for audit/idempotency) even though no
    // entitlement was granted, so a retried delivery of the same event can't double-process it.
    expect(store.payments).toHaveLength(1);
  });

  it("surfaces a payment-insert failure as a retriable error", async () => {
    const store = baseStore({ failInsert: true });
    const result = await processStripeCheckoutCompletedEvent(makeSupabase(store), checkoutEvent());

    expect(result).toEqual({ status: "error", error: "insert down" });
    expect(store.cases[0].paid_at).toBeNull();
  });

  it("surfaces a case-lookup failure as a retriable error", async () => {
    const store = baseStore({ failCaseLookup: true });
    const result = await processStripeCheckoutCompletedEvent(makeSupabase(store), checkoutEvent());

    expect(result).toEqual({ status: "error", error: "case lookup down" });
  });

  it("surfaces an entitlement-update failure as a retriable error", async () => {
    const store = baseStore({ failUpdateTimes: 1 });
    const result = await processStripeCheckoutCompletedEvent(makeSupabase(store), checkoutEvent());

    expect(result).toEqual({ status: "error", error: "update down" });
  });
});
