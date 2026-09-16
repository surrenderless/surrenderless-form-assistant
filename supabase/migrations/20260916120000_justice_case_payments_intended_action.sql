-- Durably records which prepared action a Stripe checkout was bound to at session-creation time
-- (see resolveIntendedPreparedAction.ts / checkout/route.ts), so orphan recovery
-- (reconcileOrphanedPaidCaseApprovals.ts) can later compare a case's currently-recomputed intent
-- against what was actually paid for, instead of trusting a mutable, consumer-editable
-- client_state field. Null on rows recorded before this column existed and on any legacy
-- checkout session created before this binding existed.

alter table public.justice_case_payments
  add column if not exists intended_action_href text null;

alter table public.justice_case_payments
  add column if not exists intended_action_label text null;

comment on column public.justice_case_payments.intended_action_href is 'The prepared-action href this payment was bound to at Stripe checkout-session-creation time (Stripe metadata intended_action_href). Null for sessions created before this binding existed — those fall back to orphan-recovery recomputation from current intake.';
comment on column public.justice_case_payments.intended_action_label is 'Display label paired with intended_action_href, captured at the same time.';
