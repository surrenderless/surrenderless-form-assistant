-- Server-persisted chat transcript turns per justice case (chat-ai primary surface).

create table if not exists public.justice_case_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  case_id uuid not null references public.justice_cases (id) on delete cascade,
  client_turn_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  source text null,
  created_at timestamptz not null default now(),
  constraint justice_case_chat_messages_case_client_turn_unique unique (case_id, client_turn_id)
);

comment on table public.justice_case_chat_messages is
  'Persisted user/assistant chat turns for /justice/chat-ai, bound to a justice case.';

create index if not exists idx_justice_case_chat_messages_user_case_created
  on public.justice_case_chat_messages (user_id, case_id, created_at);

alter table public.justice_case_chat_messages enable row level security;

drop policy if exists "justice_case_chat_messages_select_own" on public.justice_case_chat_messages;
drop policy if exists "justice_case_chat_messages_insert_own" on public.justice_case_chat_messages;

create policy "justice_case_chat_messages_select_own"
  on public.justice_case_chat_messages
  for select
  to authenticated
  using (user_id = auth.uid()::text);

create policy "justice_case_chat_messages_insert_own"
  on public.justice_case_chat_messages
  for insert
  to authenticated
  with check (user_id = auth.uid()::text);
