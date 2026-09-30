-- Database-enforced uniqueness for managed fulfillment tasks (owned-filing tasks, follow-up/
-- superseded-lane review tasks, and the orphaned-paid-case-approval review task). Every
-- ensure*FilingTask / ensureOrphanedPaidCaseApprovalTask function previously relied only on an
-- application-level "select the open task by marker, then insert if none found" check — with no
-- database constraint behind it, two concurrent callers (a Stripe webhook redelivery, the
-- 5-minute orphan-recovery cron, and/or the operator manual-finalize endpoint) racing on the
-- same case+marker could both pass the "none found" check and both insert, producing two open
-- tasks for the same destination. dedupe_key + the partial unique index below closes that race
-- at the database level: at most one OPEN (completed_at IS NULL) task may exist per dedupe_key,
-- so the loser of any race gets a real 23505 conflict instead of a silently-created duplicate,
-- and application code (see insertManagedFulfillmentTaskConflictSafe) recovers by re-reading the
-- winner's row rather than failing.

alter table public.justice_case_tasks
  add column if not exists dedupe_key text null;

comment on column public.justice_case_tasks.dedupe_key is 'Stable per-(case, destination) idempotency key for managed fulfillment tasks (equal to the same marker string already stored as the first line of notes) — enforced unique among currently-open tasks by idx_justice_case_tasks_open_dedupe_key. Null for legacy rows created before this column existed and for ordinary (non-managed) user reminder tasks, which never set it.';

-- Safe, targeted backfill: only touches currently-open rows whose notes already look exactly
-- like a managed-task marker for THIS SAME case (first line of notes ends with ":<this case's
-- own id>", the fixed convention every managed-task builder uses — e.g.
-- "state_ag_filing_queue:<uuid>"). An ordinary personal reminder task's notes never happen to
-- match that shape for its own case_id, so this cannot misclassify a non-managed task. Rows
-- that don't match are left with dedupe_key = null, which the partial index below simply
-- ignores — nothing here can violate the new constraint or fail the migration.
update public.justice_case_tasks
set dedupe_key = split_part(notes, chr(10), 1)
where completed_at is null
  and dedupe_key is null
  and notes is not null
  and split_part(notes, chr(10), 1) like ('%:' || case_id::text);

-- Fail loudly and specifically, not with a raw duplicate-key error, if the backfill above
-- surfaced any pre-existing duplicate open tasks for the same destination (exactly the race
-- this migration exists to close — if it already happened in production before this shipped,
-- both rows are real and neither should be silently dropped or completed by a migration). This
-- is the schema/code-incompatibility check requested for the apply procedure: it runs as part of
-- this same migration so "no duplicates" is verified, not assumed or left to documentation.
do $$
declare
  dup_count integer;
begin
  select count(*) into dup_count from (
    select dedupe_key
    from public.justice_case_tasks
    where completed_at is null and dedupe_key is not null
    group by dedupe_key
    having count(*) > 1
  ) d;

  if dup_count > 0 then
    -- This whole file runs as one transaction: by the time this message could actually be read
    -- and acted on, the failure below has already rolled back the ALTER TABLE that added
    -- dedupe_key, so a remediation query referencing dedupe_key would itself fail with "column
    -- does not exist". The query printed here is the same marker/case_id-derived one used for the
    -- pre-flight check in the apply procedure — runnable both before this migration is attempted
    -- and immediately after it fails — and never selects the notes column itself (draft/complaint
    -- text), only the short marker prefix and identifiers.
    raise exception 'justice_case_tasks_dedupe_key: % marker(s) already have more than one open task — resolve these before this migration can create the unique index. See the canonical, PII-free remediation query (marker/case_id derived, never the notes column, runnable before this migration and immediately after this failure) in supabase/migrations/APPLY_PROCEDURE_20260916.md step 1.', dup_count;
  end if;
end $$;

-- Partial (not table-level) unique index: only currently-open, dedupe_key-bearing rows
-- participate. Completed/cancelled tasks and rows with no dedupe_key (legacy backfill misses,
-- ordinary reminders) are excluded, so history and non-managed tasks are never constrained, and
-- a destination may legitimately reopen a fresh task after a prior one for the same marker
-- completes.
create unique index if not exists idx_justice_case_tasks_open_dedupe_key
  on public.justice_case_tasks (dedupe_key)
  where completed_at is null and dedupe_key is not null;
