import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveOperatorAlertEmail } from "@/lib/email/operatorAlertEmailEnv";
import { resolveMerchantOutreachEmailProvider } from "@/lib/email/resolveMerchantOutreachEmailProvider";
import { resolveOperatorWorkspaceUrl } from "@/lib/justice/operatorFallbackAlertReconciler";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";
import type { StripeWebhookEventLike } from "@/lib/stripe/processStripeCheckoutCompletedEvent";

/**
 * Records Stripe refund/dispute events for OPERATOR VISIBILITY ONLY. Deliberately never revokes
 * entitlement, clears justice_cases.paid_at, pauses fulfillment, changes case status, or emails
 * the consumer — those are separate, later decisions for a human to make from the alert.
 */
const HANDLED_EVENT_TYPES = new Set(["refund.created", "charge.dispute.created", "charge.dispute.closed"]);

export type PaymentEventCategory = "refund" | "dispute_created" | "dispute_closed";

function categoryForEventType(type: string): PaymentEventCategory | null {
  switch (type) {
    case "refund.created":
      return "refund";
    case "charge.dispute.created":
      return "dispute_created";
    case "charge.dispute.closed":
      return "dispute_closed";
    default:
      return null;
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Stripe webhook fields carry either a plain id string or an expanded object with `.id`. */
function extractIdFromStringOrObject(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Stripe evidence_details.due_by is a Unix seconds timestamp. */
function readUnixSecondsAsIso(value: unknown): string | null {
  const seconds = readNumber(value);
  if (seconds === null) return null;
  return new Date(seconds * 1000).toISOString();
}

/** Minimal Stripe Checkout Sessions surface this module needs — injectable for tests. */
export type StripeSessionsLookup = {
  list(params: { payment_intent: string; limit: number }): Promise<{ data: Array<{ id: string }> }>;
};

type PaymentEventRow = {
  id: string;
  case_id: string | null;
  user_id: string | null;
  matched: boolean;
  event_category: PaymentEventCategory;
  stripe_object_id: string;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  amount: number | null;
  currency: string | null;
  stripe_status: string | null;
  dispute_reason: string | null;
  evidence_due_by: string | null;
  alert_status: "pending" | "sending" | "sent";
  alert_message_id: string | null;
  updated_at: string;
};

/**
 * A claim stuck at 'sending' longer than this is guaranteed abandoned, not merely slow: this
 * route's own `maxDuration` (see route.ts) hard-caps a single invocation at 30 seconds, so
 * nothing can still be legitimately mid-send past that point — the process was killed. 60
 * seconds (2x that cap) leaves margin for clock/latency skew while staying 1,440x smaller than
 * Resend's own 24h idempotency-key retention window (confirmed against the Resend API docs and
 * the resend SDK's compiled source, which sets `Idempotency-Key` from this same deterministic,
 * per-event key on every send attempt) — the actual safety net if the abandoned claim's send
 * secretly reached Resend before the process died: a reclaim's resend inside that 24h window
 * gets Resend's own cached response back, never a second physical email.
 */
export const STALE_SENDING_RECLAIM_THRESHOLD_MS = 60_000;

type MatchedPayment = { case_id: string; user_id: string; amount_total: number | null };

async function resolveMatchedPayment(
  supabase: SupabaseClient,
  sessionsLookup: StripeSessionsLookup,
  paymentIntentId: string | null
): Promise<MatchedPayment | null> {
  if (!paymentIntentId) return null;

  const { data: byIntent, error: byIntentErr } = await supabase
    .from("justice_case_payments")
    .select("case_id, user_id, amount_total")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (byIntentErr) {
    console.warn("stripe refund/dispute event: match by payment_intent", byIntentErr.message);
    return null;
  }
  if (byIntent) {
    return { case_id: byIntent.case_id, user_id: byIntent.user_id, amount_total: byIntent.amount_total };
  }

  // Bounded legacy fallback: rows recorded before stripe_payment_intent_id existed only have
  // stripe_checkout_session_id. One extra Stripe API call resolves payment_intent -> session id.
  let sessionId: string | null = null;
  try {
    const sessions = await sessionsLookup.list({ payment_intent: paymentIntentId, limit: 1 });
    sessionId = sessions.data[0]?.id?.trim() || null;
  } catch (e) {
    console.warn("stripe refund/dispute event: session lookup fallback failed", e);
    return null;
  }
  if (!sessionId) return null;

  const { data: bySession, error: bySessionErr } = await supabase
    .from("justice_case_payments")
    .select("case_id, user_id, amount_total")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (bySessionErr) {
    console.warn("stripe refund/dispute event: match by session fallback", bySessionErr.message);
    return null;
  }
  if (!bySession) return null;
  return { case_id: bySession.case_id, user_id: bySession.user_id, amount_total: bySession.amount_total };
}

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null) return "unknown amount";
  const dollars = (amount / 100).toFixed(2);
  return currency ? `${dollars} ${currency.toUpperCase()}` : dollars;
}

function refundPartialFullLabel(row: PaymentEventRow, payment: MatchedPayment | null): string {
  if (row.amount === null || !payment || payment.amount_total === null) {
    return "partial vs. full not determinable";
  }
  return row.amount === payment.amount_total ? "full refund" : "partial refund";
}

function buildAlertSubjectAndBody(
  row: PaymentEventRow,
  payment: MatchedPayment | null
): { subject: string; text: string } {
  const caseLine = row.case_id
    ? [`Case ID: ${row.case_id}`, `Operator workspace: ${resolveOperatorWorkspaceUrl(row.case_id)}`]
    : [];

  if (row.event_category === "refund") {
    const label = refundPartialFullLabel(row, payment);
    return {
      subject: `[Surrenderless] Stripe refund recorded — ${label}`,
      text: [
        "A Stripe refund was recorded for operator review.",
        `Refund: ${row.stripe_object_id}`,
        `Amount: ${formatAmount(row.amount, row.currency)} (${label})`,
        `Status: ${row.stripe_status ?? "unknown"}`,
        `PaymentIntent: ${row.stripe_payment_intent_id ?? "unknown"}`,
        ...caseLine,
        "",
        "No entitlement, case status, or fulfillment was changed automatically. Review and decide next steps.",
        "— Surrenderless automated alerting",
      ].join("\n"),
    };
  }

  if (row.event_category === "dispute_created") {
    return {
      subject: `[Surrenderless] Stripe dispute opened — response due ${row.evidence_due_by ?? "unknown"}`,
      text: [
        "A Stripe chargeback/dispute was opened and needs a timely response.",
        `Evidence due by: ${row.evidence_due_by ?? "unknown"}`,
        `Status: ${row.stripe_status ?? "unknown"}`,
        `Reason: ${row.dispute_reason ?? "unknown"}`,
        `Amount: ${formatAmount(row.amount, row.currency)}`,
        `Dispute: ${row.stripe_object_id}`,
        `PaymentIntent: ${row.stripe_payment_intent_id ?? "unknown"}`,
        ...caseLine,
        "",
        "No entitlement, case status, or fulfillment was changed automatically. Respond in the Stripe dashboard before the deadline above.",
        "— Surrenderless automated alerting",
      ].join("\n"),
    };
  }

  // dispute_closed
  return {
    subject: `[Surrenderless] Stripe dispute closed — resolution: ${row.stripe_status ?? "unknown"}`,
    text: [
      "A Stripe chargeback/dispute was closed.",
      `Resolution: ${row.stripe_status ?? "unknown"}`,
      `Amount: ${formatAmount(row.amount, row.currency)}`,
      `Dispute: ${row.stripe_object_id}`,
      `PaymentIntent: ${row.stripe_payment_intent_id ?? "unknown"}`,
      ...caseLine,
      "",
      "No entitlement, case status, or fulfillment was changed automatically. Review and decide next steps.",
      "— Surrenderless automated alerting",
    ].join("\n"),
  };
}

function buildUnmatchedAlert(row: PaymentEventRow): { subject: string; text: string } {
  return {
    subject: `[Surrenderless] Unmatched Stripe ${row.event_category.replace("_", " ")} event — needs manual lookup`,
    text: [
      `A Stripe ${row.event_category.replace("_", " ")} event could not be traced to a known case payment.`,
      `Stripe object: ${row.stripe_object_id}`,
      `PaymentIntent: ${row.stripe_payment_intent_id ?? "unknown"}`,
      `Charge: ${row.stripe_charge_id ?? "unknown"}`,
      `Amount: ${formatAmount(row.amount, row.currency)}`,
      `Status: ${row.stripe_status ?? "unknown"}`,
      "",
      "Look this up directly in the Stripe dashboard to find the affected customer/case.",
      "— Surrenderless automated alerting",
    ].join("\n"),
  };
}

export type ProcessStripeRefundDisputeEventResult =
  | { status: "recorded"; matched: boolean; case_id: string | null; alert: "sent" | "already_sent" | "skipped_no_recipient" }
  | { status: "ignored_unhandled_type" }
  | { status: "malformed" }
  | { status: "error"; error: string };

function timelineEntryId(category: PaymentEventCategory, objectId: string): string {
  return `stripe_payment_event:${category}:${objectId}`;
}

/**
 * Records a refund.created / charge.dispute.created / charge.dispute.closed webhook event
 * durably and alerts an operator exactly once per logical event (event_category +
 * stripe_object_id — not per Stripe event id, since a different event id can describe the same
 * underlying refund/dispute). Never revokes entitlement, pauses fulfillment, changes case
 * status, or emails the consumer.
 */
export async function processStripeRefundDisputeEvent(
  supabase: SupabaseClient,
  sessionsLookup: StripeSessionsLookup,
  event: StripeWebhookEventLike,
  options: { nowMs?: number } = {}
): Promise<ProcessStripeRefundDisputeEventResult> {
  const nowMs = options.nowMs ?? Date.now();
  const category = categoryForEventType(event.type);
  if (!category) {
    return { status: "ignored_unhandled_type" };
  }

  const object = (event.data?.object ?? {}) as Record<string, unknown>;
  const stripeObjectId = readString(object.id);
  const stripeEventId = readString(event.id);
  if (!stripeObjectId || !stripeEventId) {
    return { status: "malformed" };
  }

  const paymentIntentId = extractIdFromStringOrObject(object.payment_intent);
  const chargeId = extractIdFromStringOrObject(object.charge);
  const amount = readNumber(object.amount);
  const currency = readString(object.currency) || null;
  const stripeStatus = readString(object.status) || null;

  let disputeReason: string | null = null;
  let evidenceDueBy: string | null = null;
  if (category === "dispute_created") {
    disputeReason = readString(object.reason) || null;
    const evidenceDetails = object.evidence_details;
    if (evidenceDetails && typeof evidenceDetails === "object" && !Array.isArray(evidenceDetails)) {
      evidenceDueBy = readUnixSecondsAsIso((evidenceDetails as Record<string, unknown>).due_by);
    }
  }

  const matchedPayment = await resolveMatchedPayment(supabase, sessionsLookup, paymentIntentId);

  const insertPayload = {
    stripe_event_id: stripeEventId,
    event_category: category,
    stripe_object_id: stripeObjectId,
    stripe_payment_intent_id: paymentIntentId,
    stripe_charge_id: chargeId,
    case_id: matchedPayment?.case_id ?? null,
    user_id: matchedPayment?.user_id ?? null,
    matched: matchedPayment !== null,
    amount,
    currency,
    stripe_status: stripeStatus,
    dispute_reason: disputeReason,
    evidence_due_by: evidenceDueBy,
    alert_status: "pending" as const,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("justice_case_payment_events")
    .insert(insertPayload)
    .select()
    .single();

  let row: PaymentEventRow;

  if (insertError) {
    if (insertError.code !== "23505") {
      return { status: "error", error: insertError.message };
    }
    // Already claimed — either a literal event-id redelivery, or a different event id
    // describing the same (category, object). Either way, the existing row is authoritative;
    // look it up by (event_category, stripe_object_id), which identifies it regardless of which
    // unique constraint fired.
    const { data: existing, error: existingErr } = await supabase
      .from("justice_case_payment_events")
      .select("*")
      .eq("event_category", category)
      .eq("stripe_object_id", stripeObjectId)
      .maybeSingle();
    if (existingErr) {
      return { status: "error", error: existingErr.message };
    }
    if (!existing) {
      return { status: "error", error: "Duplicate insert conflict but no existing row found" };
    }
    row = existing as PaymentEventRow;
  } else {
    row = inserted as PaymentEventRow;
  }

  if (row.alert_status === "sent") {
    return {
      status: "recorded",
      matched: row.matched,
      case_id: row.case_id,
      alert: "already_sent",
    };
  }

  // Atomic claim: only the request that flips pending -> sending may send the email. A
  // concurrent duplicate delivery that loses this race acks success without sending anything —
  // the row is already durably recorded, which is the primary correctness guarantee; the winner
  // owns delivering (or, on a crash before completion, re-delivering via Stripe's own webhook
  // retry, which will re-run this same claim once the row falls back out of "sending").
  const { data: claimed, error: claimErr } = await supabase
    .from("justice_case_payment_events")
    .update({ alert_status: "sending" })
    .eq("id", row.id)
    .eq("alert_status", "pending")
    .select()
    .maybeSingle();

  if (claimErr) {
    return { status: "error", error: claimErr.message };
  }
  if (!claimed) {
    // Lost the pending -> sending race. Re-read to find out why: a row already 'sent' is a
    // genuine, confirmed duplicate — ack success. A row still 'sending' is ambiguous — a
    // concurrent request actively completing right now, or one that crashed before completing
    // or reverting — UNLESS it has been 'sending' longer than STALE_SENDING_RECLAIM_THRESHOLD_MS,
    // in which case the claimant is guaranteed dead (see that constant's own comment) and this
    // request may reclaim it via a second CAS keyed on the exact updated_at just observed, so a
    // genuine concurrent reclaimer can win at most once. A too-fresh 'sending' row still just
    // returns a retryable error, unchanged from before, so a genuinely in-flight request is
    // never disturbed.
    const { data: recheck, error: recheckErr } = await supabase
      .from("justice_case_payment_events")
      .select("*")
      .eq("id", row.id)
      .maybeSingle();
    if (recheckErr) {
      return { status: "error", error: recheckErr.message };
    }
    const current = (recheck as PaymentEventRow | null) ?? row;
    if (current.alert_status === "sent") {
      return {
        status: "recorded",
        matched: current.matched,
        case_id: current.case_id,
        alert: "already_sent",
      };
    }

    const claimedAtMs = Date.parse(current.updated_at);
    const ageMs = Number.isFinite(claimedAtMs) ? nowMs - claimedAtMs : 0;
    if (ageMs < STALE_SENDING_RECLAIM_THRESHOLD_MS) {
      return { status: "error", error: "Alert claim is in flight (alert_status: sending) — retry" };
    }

    const { data: reclaimed, error: reclaimErr } = await supabase
      .from("justice_case_payment_events")
      .update({ alert_status: "sending" })
      .eq("id", row.id)
      .eq("alert_status", "sending")
      .eq("updated_at", current.updated_at)
      .select()
      .maybeSingle();
    if (reclaimErr) {
      return { status: "error", error: reclaimErr.message };
    }
    if (!reclaimed) {
      // Someone else reclaimed it first (or, implausibly, the original owner is still alive).
      return { status: "error", error: "Alert claim is in flight (alert_status: sending) — retry" };
    }
    row = reclaimed as PaymentEventRow;
  } else {
    row = claimed as PaymentEventRow;
  }

  const recipient = resolveOperatorAlertEmail();
  if (!recipient) {
    // Permanent config gap, not a transient failure: retrying won't fix a missing env var.
    // Revert the claim so the row stays visibly 'pending' (discoverable) rather than stuck
    // 'sending' forever, and ack success since the event itself IS durably recorded.
    await supabase
      .from("justice_case_payment_events")
      .update({ alert_status: "pending" })
      .eq("id", row.id)
      .eq("alert_status", "sending");
    console.warn("stripe refund/dispute event: OPERATOR_ALERT_EMAIL unavailable");
    return { status: "recorded", matched: row.matched, case_id: row.case_id, alert: "skipped_no_recipient" };
  }

  const providerResolved = resolveMerchantOutreachEmailProvider();
  if (!providerResolved.ok) {
    await supabase
      .from("justice_case_payment_events")
      .update({ alert_status: "pending" })
      .eq("id", row.id)
      .eq("alert_status", "sending");
    console.warn("stripe refund/dispute event: email provider unavailable", providerResolved.reason);
    return { status: "recorded", matched: row.matched, case_id: row.case_id, alert: "skipped_no_recipient" };
  }

  const { subject, text } = row.matched
    ? buildAlertSubjectAndBody(row, matchedPayment)
    : buildUnmatchedAlert(row);

  let sendResult;
  try {
    sendResult = await providerResolved.provider.send({
      from: providerResolved.from,
      to: recipient,
      subject,
      text,
      idempotencyKey: `stripe-payment-event-alert:${row.event_category}:${row.stripe_object_id}`,
    });
  } catch (e) {
    await supabase
      .from("justice_case_payment_events")
      .update({ alert_status: "pending" })
      .eq("id", row.id)
      .eq("alert_status", "sending");
    return { status: "error", error: e instanceof Error ? e.message : "send threw" };
  }

  if (!sendResult.ok) {
    // Revert to pending so a Stripe webhook retry (we return 500 below) re-attempts the send.
    await supabase
      .from("justice_case_payment_events")
      .update({ alert_status: "pending" })
      .eq("id", row.id)
      .eq("alert_status", "sending");
    return { status: "error", error: sendResult.error };
  }

  const { error: markSentErr } = await supabase
    .from("justice_case_payment_events")
    .update({ alert_status: "sent", alert_message_id: sendResult.messageId })
    .eq("id", row.id)
    .eq("alert_status", "sending");

  if (markSentErr) {
    // Provider idempotency key above prevents a duplicate email on the retry this triggers.
    return { status: "error", error: markSentErr.message };
  }

  if (row.matched && row.case_id && row.user_id) {
    await appendCaseTimelineEntry(supabase, row.user_id, row.case_id, {
      id: timelineEntryId(row.event_category, row.stripe_object_id),
      type: "outcome_recorded",
      label:
        row.event_category === "refund"
          ? "Stripe refund recorded — operator alerted"
          : row.event_category === "dispute_created"
            ? "Stripe dispute opened — operator alerted"
            : "Stripe dispute closed — operator alerted",
      detail: `${row.stripe_object_id} — ${formatAmount(row.amount, row.currency)}${row.stripe_status ? ` (${row.stripe_status})` : ""}`,
    });
  }

  return { status: "recorded", matched: row.matched, case_id: row.case_id, alert: "sent" };
}

export { HANDLED_EVENT_TYPES as STRIPE_REFUND_DISPUTE_HANDLED_EVENT_TYPES };
