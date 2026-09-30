-- Durable, monotonic row-version counter for justice_cases — replaces updated_at as the token for
-- every optimistic-concurrency check on this table.
--
-- A release audit proved updated_at is unsuitable for this: it is a wall-clock timestamp, and
-- under PGlite (and, at sufficient write frequency/precision limits, real Postgres too) two
-- genuinely sequential writes to the same row can be stamped with the IDENTICAL value. Empirically,
-- racing two writers against the same stale updated_at token produced a silent lost update in
-- roughly a third to half of trials with no sleep involved — the "loser" was never rejected,
-- because its stale token happened to equal whatever the "winner" had just written. This is not a
-- testing artifact: it is intrinsic to using a timestamp, no matter its precision, as an equality
-- token. case_version is a plain integer, incremented by exactly 1 on every UPDATE by a BEFORE
-- UPDATE trigger evaluated under the row lock Postgres already takes for the UPDATE itself — two
-- concurrent writers are serialized by that lock, so the second writer's trigger always computes
-- OLD.case_version + 1 against the value the first writer actually committed, never a stale one.
-- Two different rows can never produce the same next version for the same row, and a single row's
-- version can never repeat or go backwards, regardless of how fast writes arrive or what the
-- system clock is doing.
--
-- updated_at is kept, unchanged, for display/sorting only (e.g. "last updated" text, ORDER BY in
-- the case list) — it is never again compared for equality anywhere in this codebase.
alter table public.justice_cases
  add column if not exists case_version bigint not null default 1;

comment on column public.justice_cases.case_version is 'Monotonic row-version counter, incremented by exactly 1 on every UPDATE via bump_justice_case_version(). The sole equality token for optimistic concurrency on this table — updated_at is display/sort only and must never be compared for equality.';

create or replace function public.bump_justice_case_version()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.case_version = old.case_version + 1;
  return new;
end;
$$;

drop trigger if exists bump_justice_cases_case_version on public.justice_cases;

create trigger bump_justice_cases_case_version
  before update on public.justice_cases
  for each row
  execute procedure public.bump_justice_case_version();

comment on trigger bump_justice_cases_case_version on public.justice_cases is 'Increments case_version by exactly 1 on every UPDATE, unconditionally on which columns changed — mirrors set_updated_at''s own unconditional-fire behavior, so the two triggers together always keep both columns moving together on every write.';
