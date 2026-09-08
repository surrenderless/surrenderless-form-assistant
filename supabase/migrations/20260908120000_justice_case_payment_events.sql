-- Stripe refund/dispute visibility: captures the PaymentIntent id on each recorded checkout
-- payment (needed to match a later refund/dispute event back to its case) and adds a durable,
-- idempotent ledger of refund.created/charge.dispute.created/charge.dispute.closed webhook
-- events for operator review. This migration only records and alerts — it never revokes
-- entitlement, pauses fulfillment, or changes justice_cases.paid_at, which keeps its existing
-- meaning and write path (see 20260804120000_stripe_case_payment_entitlement.sql) unchanged.

alter table public.justice_case_payments
  add column if not exists stripe_payment_intent_id text null;

comment on column public.justice_case_payments.stripe_payment_intent_id is 'Stripe PaymentIntent id captured from the checkout.session.completed/async_payment_succeeded event that granted entitlement. Null on rows recorded before this column existed. The match key used by justice_case_payment_events to trace a later refund/dispute event back to its case.';

-- Partial (not table-level) unique index: the column is nullable and only populated going
-- forward, so many historical rows legitimately share NULL — a plain unique constraint would
-- reject that.
create unique index if not exists idx_justice_case_payments_stripe_payment_intent_id
  on public.justice_case_payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- One row per distinct (event_category, stripe_object_id) — not per Stripe event id — since
-- Stripe can in principle deliver two different event ids describing the same underlying
-- refund/dispute. Both unique constraints below guard idempotency independently; the
-- application code treats a conflict on either as "already claimed" and looks up the existing
-- row by (event_category, stripe_object_id), which is stable regardless of which constraint
-- fired. alert_status is the durable claim/outbox state for the operator email: a row is
-- inserted with 'pending' BEFORE the alert is sent, and only flipped to 'sent' after a
-- confirmed provider acceptance — so a crash between insert and send leaves the row retryable
-- rather than silently losing the alert, and a concurrent retry can only ever win the row via
-- the 'pending' -> 'sent' compare-and-swap update.
create table if not exists public.justice_case_payment_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null,
  event_category text not null
    check (event_category in ('refund', 'dispute_created', 'dispute_closed')),
  stripe_object_id text not null,
  stripe_payment_intent_id text null,
  stripe_charge_id text null,
  case_id uuid null references public.justice_cases (id) on delete cascade,
  user_id text null,
  matched boolean not null default false,
  amount bigint null,
  currency text null,
  stripe_status text null,
  dispute_reason text null,
  evidence_due_by timestamptz null,
  alert_status text not null default 'pending' check (alert_status in ('pending', 'sent')),
  alert_message_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint justice_case_payment_events_stripe_event_id_key unique (stripe_event_id),
  constraint justice_case_payment_events_object_category_key unique (event_category, stripe_object_id)
);

comment on table public.justice_case_payment_events is 'Durable, idempotent ledger of Stripe refund.created/charge.dispute.created/charge.dispute.closed webhook events, recorded for operator-alert visibility only — never revokes entitlement, pauses fulfillment, alters case status, or contacts the consumer. matched=false rows are events that could not be traced to a known payment (still recorded and alerted, case_id/user_id stay null).';

create index if not exists idx_justice_case_payment_events_case_id
  on public.justice_case_payment_events (case_id);

create index if not exists idx_justice_case_payment_events_payment_intent_id
  on public.justice_case_payment_events (stripe_payment_intent_id);

drop trigger if exists set_justice_case_payment_events_updated_at on public.justice_case_payment_events;

create trigger set_justice_case_payment_events_updated_at
  before update on public.justice_case_payment_events
  for each row
  execute procedure public.set_updated_at();

-- RLS enabled with no policies, matching justice_case_payments: only the service role (used
-- exclusively by the Stripe webhook route) may read or write this table.
alter table public.justice_case_payment_events enable row level security;

grant select, insert, update on public.justice_case_payment_events to service_role;
