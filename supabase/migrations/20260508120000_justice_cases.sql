create extension if not exists pgcrypto;

-- justice_cases: persisted justice flow state per user (API + service role ownership checks later)
-- RLS enabled with no policies: only service_role / table owner bypasses RLS by default.

create table if not exists public.justice_cases (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  intake jsonb not null,
  timeline jsonb not null default '[]'::jsonb,
  payment_dispute_draft jsonb null,
  client_state jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.justice_cases is 'Per-user justice intake, timeline, and auxiliary JSON state; accessed via server routes with Clerk user_id.';

create index if not exists idx_justice_cases_user_id_updated_at_desc
  on public.justice_cases (user_id, updated_at desc);

-- Generic updated_at touch (idempotent; safe if reused by future migrations)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_justice_cases_updated_at on public.justice_cases;

create trigger set_justice_cases_updated_at
  before update on public.justice_cases
  for each row
  execute procedure public.set_updated_at();

alter table public.justice_cases enable row level security;
