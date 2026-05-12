-- External / manual filing records per justice case (MVP).

create table if not exists public.justice_case_filings (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  case_id uuid not null references public.justice_cases (id) on delete cascade,
  destination text not null,
  filed_at text null,
  confirmation_number text null,
  filing_url text null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.justice_case_filings is 'User-tracked external or manual complaint filings tied to a justice case.';

create index if not exists idx_justice_case_filings_user_case_created
  on public.justice_case_filings (user_id, case_id, created_at);

drop trigger if exists set_justice_case_filings_updated_at on public.justice_case_filings;

create trigger set_justice_case_filings_updated_at
  before update on public.justice_case_filings
  for each row
  execute procedure public.set_updated_at();

alter table public.justice_case_filings enable row level security;

drop policy if exists "justice_case_filings_select_own" on public.justice_case_filings;
drop policy if exists "justice_case_filings_insert_own" on public.justice_case_filings;
drop policy if exists "justice_case_filings_update_own" on public.justice_case_filings;
drop policy if exists "justice_case_filings_delete_own" on public.justice_case_filings;

create policy "justice_case_filings_select_own"
  on public.justice_case_filings
  for select
  to authenticated
  using (user_id = auth.uid()::text);

create policy "justice_case_filings_insert_own"
  on public.justice_case_filings
  for insert
  to authenticated
  with check (user_id = auth.uid()::text);

create policy "justice_case_filings_update_own"
  on public.justice_case_filings
  for update
  to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy "justice_case_filings_delete_own"
  on public.justice_case_filings
  for delete
  to authenticated
  using (user_id = auth.uid()::text);
