-- Structured evidence notes per justice case (MVP; no file blobs).

create table if not exists public.justice_case_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  case_id uuid not null references public.justice_cases (id) on delete cascade,
  title text not null,
  evidence_type text not null,
  evidence_date text null,
  description text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.justice_case_evidence is 'User-entered evidence/proof metadata tied to a justice case; no file uploads in MVP.';

create index if not exists idx_justice_case_evidence_user_case_created
  on public.justice_case_evidence (user_id, case_id, created_at);

drop trigger if exists set_justice_case_evidence_updated_at on public.justice_case_evidence;

create trigger set_justice_case_evidence_updated_at
  before update on public.justice_case_evidence
  for each row
  execute procedure public.set_updated_at();

alter table public.justice_case_evidence enable row level security;

drop policy if exists "justice_case_evidence_select_own" on public.justice_case_evidence;
drop policy if exists "justice_case_evidence_insert_own" on public.justice_case_evidence;
drop policy if exists "justice_case_evidence_update_own" on public.justice_case_evidence;
drop policy if exists "justice_case_evidence_delete_own" on public.justice_case_evidence;

create policy "justice_case_evidence_select_own"
  on public.justice_case_evidence
  for select
  to authenticated
  using (user_id = auth.uid()::text);

create policy "justice_case_evidence_insert_own"
  on public.justice_case_evidence
  for insert
  to authenticated
  with check (user_id = auth.uid()::text);

create policy "justice_case_evidence_update_own"
  on public.justice_case_evidence
  for update
  to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy "justice_case_evidence_delete_own"
  on public.justice_case_evidence
  for delete
  to authenticated
  using (user_id = auth.uid()::text);
