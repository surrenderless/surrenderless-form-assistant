import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Stripe fires checkout.session.completed for essentially all mode:"payment" sessions; some
 * delayed-settlement payment methods complete later via checkout.session.async_payment_succeeded
 * instead, so both are handled identically here (grant only once payment_status is "paid").
 * checkout.session.async_payment_failed and everything else is deliberately left unhandled —
 * an unpaid case must never be granted entitlement.
 */
const HANDLED_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

export type StripeWebhookEventLike = {
  id: string;
  type: string;
  data: { object: unknown };
};

export type ProcessStripeCheckoutCompletedEventResult =
  | { status: "granted"; case_id: string }
  | { status: "ignored_unhandled_type" }
  | { status: "ignored_unpaid" }
  | { status: "malformed" }
  | { status: "case_mismatch" }
  | { status: "error"; error: string };

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Grants durable one-time-payment entitlement for a case from a signature-verified Stripe
 * webhook event. Trusts nothing from the redirect/client — the case id and user id come only
 * from the checkout session's own metadata, which this server set itself at checkout-creation
 * time (see the checkout route), never from client input at webhook time.
 *
 * Failure-safe idempotency: recording the payment (the insert) and granting entitlement (the
 * paid_at update) are two separate steps, so a redelivered event must never treat "the payment
 * row already exists" as "entitlement was already granted" — those can diverge if the first
 * delivery recorded the payment but failed before/during the update. Every delivery — fresh or
 * redelivered — walks through the SAME grant-confirmation path below, so a replay after a
 * partial failure still completes the grant rather than silently acking a stuck-unpaid case.
 * The unique constraint on justice_case_payments.stripe_event_id still guarantees the payment
 * itself is recorded at most once; the entitlement update is separately scoped to paid_at IS
 * NULL so it can never be re-applied once already granted.
 */
export async function processStripeCheckoutCompletedEvent(
  supabase: SupabaseClient,
  event: StripeWebhookEventLike
): Promise<ProcessStripeCheckoutCompletedEventResult> {
  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    return { status: "ignored_unhandled_type" };
  }

  const session = (event.data?.object ?? {}) as {
    id?: unknown;
    payment_status?: unknown;
    metadata?: Record<string, unknown> | null;
    amount_total?: unknown;
    currency?: unknown;
  };

  const sessionId = readString(session.id);
  const paymentStatus = readString(session.payment_status);
  const metadata = session.metadata ?? {};
  const caseId = readString(metadata.case_id);
  const userId = readString(metadata.user_id);
  const amountTotal = typeof session.amount_total === "number" ? session.amount_total : null;
  const currency = readString(session.currency) || null;

  if (!sessionId || !caseId || !userId) {
    return { status: "malformed" };
  }

  if (paymentStatus !== "paid") {
    return { status: "ignored_unpaid" };
  }

  const { error: insertError } = await supabase.from("justice_case_payments").insert({
    case_id: caseId,
    user_id: userId,
    stripe_event_id: event.id,
    stripe_checkout_session_id: sessionId,
    amount_total: amountTotal,
    currency,
  });

  if (insertError && insertError.code !== "23505") {
    return { status: "error", error: insertError.message };
  }

  if (insertError) {
    // Redelivery of an event we've already durably recorded. Validate the persisted payment
    // really is for this exact case/user (defense against an — should be impossible — event id
    // collision across different metadata) before continuing through the same grant path below.
    const { data: existingPayment, error: existingErr } = await supabase
      .from("justice_case_payments")
      .select("case_id, user_id")
      .eq("stripe_event_id", event.id)
      .maybeSingle();

    if (existingErr) {
      return { status: "error", error: existingErr.message };
    }
    if (
      !existingPayment ||
      existingPayment.case_id !== caseId ||
      existingPayment.user_id !== userId
    ) {
      return {
        status: "error",
        error: "Persisted payment record does not match this event's case/user",
      };
    }
  }

  // Defense in depth: never grant entitlement without re-confirming the case actually belongs
  // to this user, even though this server set that metadata itself and it is not client-editable.
  const { data: caseRow, error: caseErr } = await supabase
    .from("justice_cases")
    .select("id, paid_at")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (caseErr) {
    return { status: "error", error: caseErr.message };
  }
  if (!caseRow) {
    return { status: "case_mismatch" };
  }

  if (caseRow.paid_at) {
    // Already granted on a prior fully-successful delivery — nothing left to do.
    return { status: "granted", case_id: caseId };
  }

  const { error: updateError } = await supabase
    .from("justice_cases")
    .update({ paid_at: new Date().toISOString() })
    .eq("id", caseId)
    .eq("user_id", userId)
    .is("paid_at", null);

  if (updateError) {
    return { status: "error", error: updateError.message };
  }

  return { status: "granted", case_id: caseId };
}
