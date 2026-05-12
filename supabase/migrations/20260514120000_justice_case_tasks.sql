-- Follow-up tasks per justice case (MVP).

create table if not exists public.justice_case_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  case_id uuid not null references public.justice_cases (id) on delete cascade,
  title text not null,
  due_date text null,
  notes text null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.justice_case_tasks is 'User follow-up tasks and deadlines tied to a justice case.';

create index if not exists idx_justice_case_tasks_user_case_created
  on public.justice_case_tasks (user_id, case_id, created_at);

drop trigger if exists set_justice_case_tasks_updated_at on public.justice_case_tasks;

create trigger set_justice_case_tasks_updated_at
  before update on public.justice_case_tasks
  for each row
  execute procedure public.set_updated_at();

alter table public.justice_case_tasks enable row level security;

drop policy if exists "justice_case_tasks_select_own" on public.justice_case_tasks;
drop policy if exists "justice_case_tasks_insert_own" on public.justice_case_tasks;
drop policy if exists "justice_case_tasks_update_own" on public.justice_case_tasks;
drop policy if exists "justice_case_tasks_delete_own" on public.justice_case_tasks;

create policy "justice_case_tasks_select_own"
  on public.justice_case_tasks
  for select
  to authenticated
  using (user_id = auth.uid()::text);

create policy "justice_case_tasks_insert_own"
  on public.justice_case_tasks
  for insert
  to authenticated
  with check (user_id = auth.uid()::text);

create policy "justice_case_tasks_update_own"
  on public.justice_case_tasks
  for update
  to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy "justice_case_tasks_delete_own"
  on public.justice_case_tasks
  for delete
  to authenticated
  using (user_id = auth.uid()::text);
