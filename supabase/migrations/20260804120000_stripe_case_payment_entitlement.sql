-- One-time per-case Stripe payment entitlement. A single payment unlocks the entire case
-- through all escalation lanes — never per-lane, never a subscription.

alter table public.justice_cases
  add column if not exists paid_at timestamptz null;

comment on column public.justice_cases.paid_at is 'When set, this case has confirmed one-time Stripe payment and may proceed past prepared-packet approval into Surrenderless-owned handling. Written only by the Stripe webhook handler (service role) after signature verification — never trusted or set from a client PATCH.';

-- Durable, append-only record of processed Stripe checkout events. The unique constraint on
-- stripe_event_id is the idempotency guard: Stripe may redeliver the same webhook event more
-- than once, and this ensures a redelivery can never grant entitlement or record a payment twice.
create table if not exists public.justice_case_payments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.justice_cases (id) on delete cascade,
  user_id text not null,
  stripe_event_id text not null,
  stripe_checkout_session_id text not null,
  amount_total bigint null,
  currency text null,
  created_at timestamptz not null default now(),
  constraint justice_case_payments_stripe_event_id_key unique (stripe_event_id)
);

comment on table public.justice_case_payments is 'One row per successfully processed Stripe checkout.session.completed/async_payment_succeeded webhook event — the unique stripe_event_id is the sole idempotency guard against webhook redelivery.';

create index if not exists idx_justice_case_payments_case_id
  on public.justice_case_payments (case_id);

-- RLS enabled with no policies, matching justice_cases: only the service role (used exclusively
-- by the checkout/webhook server routes) may read or write this table.
alter table public.justice_case_payments enable row level security;
