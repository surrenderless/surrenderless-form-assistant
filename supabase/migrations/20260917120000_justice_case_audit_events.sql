-- Immutable, server-only audit log — closes a real gap found in a release audit of the
-- orphaned_paid_case_approval repair-intake flow: the intake write and its audit-trail entry were
-- two separate round trips (a Node-side UPDATE, then a Node-side timeline append), so a failure
-- between them could leave a genuinely-committed intake correction with no audit record, and
-- nothing ever revisited it. A concurrent, ordinary consumer write to the same case's intake could
-- then make that record permanently unrecoverable — proven via a real-Postgres regression test
-- accompanying this migration.
--
-- justice_case_audit_events is intentionally NOT justice_cases.timeline: the timeline is a
-- best-effort, consumer-writable, human-facing mirror (see the safe-merge fix in
-- api/justice/cases/[id]/route.ts, shipped alongside this migration) and must never be trusted as
-- the record of truth. This table is append-only at the database privilege level — no role,
-- including service_role, is ever granted UPDATE or DELETE on it, so no future application bug can
-- alter or erase a recorded event, regardless of what SQL it runs.
create table if not exists public.justice_case_audit_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.justice_cases (id) on delete cascade,
  user_id text not null,
  task_id uuid null references public.justice_case_tasks (id) on delete set null,
  event_type text not null,
  idempotency_key text not null,
  actor text not null,
  detail text null,
  intake_snapshot jsonb null,
  created_at timestamptz not null default now()
);

comment on table public.justice_case_audit_events is 'Immutable, append-only, server-only audit log. No role is ever granted UPDATE or DELETE on this table (see grants below) — rows cannot be altered or erased once inserted, by any application code path, present or future. Distinct from justice_cases.timeline, a best-effort consumer-writable mirror that is never authoritative.';
comment on column public.justice_case_audit_events.idempotency_key is 'Deterministic key derived from (task_id, expected prior version, exact content) — never content alone. An exact retry (same stale expected_updated_at, same content) reuses this key (INSERT ... ON CONFLICT DO NOTHING dedupes it); a distinct transition — including one whose content happens to match an earlier one (A -> B -> A) — carries a different expected prior version and so gets its own key and its own row.';

create unique index if not exists idx_justice_case_audit_events_idempotency_key
  on public.justice_case_audit_events (idempotency_key);

create index if not exists idx_justice_case_audit_events_case_id_created_at
  on public.justice_case_audit_events (case_id, created_at);

alter table public.justice_case_audit_events enable row level security;
-- No RLS policies are defined for any role: anon/authenticated get zero access (neither read nor
-- write) via PostgREST. service_role's access is governed purely by the GRANTs below.

grant select, insert on public.justice_case_audit_events to service_role;
-- Deliberately no `update`/`delete` grant to any role, including service_role: immutability here
-- is enforced by Postgres privileges, not application discipline.

-- Atomic operator repair of a case's stored intake plus its durable audit event: both commit in
-- one transaction, or neither does. Transition-aware idempotency (idempotency_key derives from
-- task_id + the expected prior version + the canonical text of the corrected intake) means an
-- exact retry (same stale expected_updated_at, same content) is a genuine no-op (dedupes on the
-- unique index), while a second, distinct correction for the same still-open task — even one that
-- happens to revert to content identical to an earlier correction (A -> B -> A) — inserts its own
-- independent audit event, since it carries a different expected prior version. Never keyed on
-- content or task_id alone, which would conflate "this content was audited once" with "this
-- transition is happening again". The task binding and the case row are both re-verified here
-- against row-locked, live data, closing the TOCTOU window a two-step Node-side check-then-write had.
create or replace function public.repair_orphaned_paid_case_approval_intake(
  p_case_id uuid,
  p_task_id uuid,
  p_user_id text,
  p_expected_updated_at timestamptz,
  p_new_intake jsonb,
  p_actor text
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_task_id uuid;
  v_task_completed_at timestamptz;
  v_task_notes text;
  v_expected_marker text;
  v_case_id uuid;
  v_case_intake jsonb;
  v_case_updated_at timestamptz;
  v_content_hash text;
  v_idempotency_key text;
  v_existing_audit_id uuid;
  v_existing_audit_intake jsonb;
  v_audit_id uuid;
  v_now timestamptz := now();
  v_now_text text;
  v_entry jsonb;
  v_merged_timeline jsonb;
  v_content_matches boolean;
begin
  if p_case_id is null or p_task_id is null or coalesce(btrim(p_user_id), '') = ''
     or p_expected_updated_at is null or p_new_intake is null or coalesce(btrim(p_actor), '') = '' then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  -- Lock the task row first — serializes against a concurrent finalize/cancel of the same task.
  select id, completed_at, notes
    into v_task_id, v_task_completed_at, v_task_notes
    from public.justice_case_tasks
   where id = p_task_id and case_id = p_case_id
   for update;

  -- Same trim + first-line-prefix marker match as taskNotesMatchOrphanedPaidCaseApprovalMarker
  -- (orphanedPaidCaseApprovalTask.ts) and cancel_operator_fulfillment_task's own precedent: a
  -- literal comparison, never LIKE, since '_'/'%' appear in real marker text.
  v_expected_marker := 'orphaned_paid_case_approval_queue:' || p_case_id::text;
  if v_task_id is null or v_task_completed_at is not null
     or not (
       btrim(coalesce(v_task_notes, '')) = v_expected_marker
       or left(btrim(coalesce(v_task_notes, '')), length(v_expected_marker) + 1) = v_expected_marker || chr(10)
     ) then
    return jsonb_build_object('status', 'task_conflict');
  end if;

  -- Lock the case row for the rest of this transaction so a concurrent write (another operator
  -- repair attempt, or the consumer's own now-CAS-protected intake PATCH) serializes against it.
  select id, intake, updated_at
    into v_case_id, v_case_intake, v_case_updated_at
    from public.justice_cases
   where id = p_case_id and user_id = p_user_id
   for update;

  if v_case_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- jsonb's own `=` operator is a real structural/value comparison (object key order never
  -- matters, array order does) — exactly the semantics needed to tell an idempotent resubmission
  -- of unchanged content apart from a genuinely different correction.
  v_content_matches := v_case_intake = p_new_intake;

  -- Postgres normalizes jsonb storage, so casting to text yields a canonical representation
  -- regardless of the original key order the caller sent — a stable, content-addressed hash
  -- without any custom canonicalization. md5() is core Postgres (no pgcrypto dependency); this is
  -- an idempotency key, not a security boundary, so collision resistance beyond md5 is unneeded.
  --
  -- The key is task_id + the EXPECTED PRIOR VERSION + the new content — never content alone.
  -- Content alone would conflate "this exact byte-for-byte content was audited once" with "this
  -- exact transition is happening again": A -> B -> A (three genuine, distinctly-versioned
  -- corrections) must produce three audit events, not have the third collide with the first
  -- merely because it happens to revert to earlier content. Including the expected prior version
  -- makes each (from-version, to-content) transition its own identity, while an exact retry (same
  -- request re-sent with the same stale expected_updated_at and the same content) still computes
  -- the identical key and dedupes correctly. extract(epoch ...) rather than a text cast of the
  -- timestamptz avoids any dependency on the session's timezone setting for key stability.
  v_content_hash := md5(p_new_intake::text);
  v_idempotency_key := 'orphaned_paid_case_approval_intake_repaired:' || p_task_id::text || ':'
    || extract(epoch from p_expected_updated_at)::text || ':' || v_content_hash;

  select id, intake_snapshot into v_existing_audit_id, v_existing_audit_intake
    from public.justice_case_audit_events
   where idempotency_key = v_idempotency_key;

  if v_existing_audit_id is not null then
    -- This exact corrected content has already been durably audited for this task at some point.
    if v_content_matches then
      -- Currently-stored intake still matches — a genuine idempotent no-op (our own retry, or a
      -- concurrent identical repair). Nothing left to write.
      return jsonb_build_object(
        'status', 'already_applied',
        'case_updated_at', v_case_updated_at,
        'case_intake', v_case_intake,
        'audit_event_id', v_existing_audit_id
      );
    else
      -- The audited content was applied at some point, but the row has since moved on (a later,
      -- different write happened). Re-applying old content now would silently clobber whatever is
      -- there now — refuse rather than guess.
      return jsonb_build_object(
        'status', 'conflict',
        'case_updated_at', v_case_updated_at,
        'case_intake', v_case_intake
      );
    end if;
  end if;

  -- Genuinely new content for this task. If it doesn't already match what's stored, it must pass
  -- the compare-and-swap; if it does already match (a concurrent identical repair that raced this
  -- one to the write but not yet to the audit insert), no CAS is needed — there is nothing to
  -- overwrite, only a missing audit event to record.
  if not v_content_matches and v_case_updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'status', 'conflict',
      'case_updated_at', v_case_updated_at,
      'case_intake', v_case_intake
    );
  end if;

  v_audit_id := gen_random_uuid();
  insert into public.justice_case_audit_events
    (id, case_id, user_id, task_id, event_type, idempotency_key, actor, detail, intake_snapshot)
  values (
    v_audit_id, p_case_id, p_user_id, p_task_id,
    'orphaned_paid_case_approval_intake_repaired',
    v_idempotency_key,
    p_actor,
    'Operator corrected case intake via orphaned paid case approval review',
    p_new_intake
  )
  on conflict (idempotency_key) do nothing
  returning id into v_audit_id;

  if v_audit_id is null then
    -- Lost a race to a concurrent call inserting the identical content under the same key between
    -- our lookup above and this insert. Whatever landed is authoritative; adopt it.
    select id into v_audit_id from public.justice_case_audit_events where idempotency_key = v_idempotency_key;
  end if;

  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_entry := jsonb_build_object(
    'id', v_idempotency_key,
    'case_id', p_case_id,
    'type', 'task_added',
    'label', 'Operator corrected case intake',
    'detail', 'Corrected via orphaned paid case approval review',
    'ts', v_now_text
  );

  -- Best-effort visible mirror, merged (never blindly replaced) into whatever timeline already
  -- exists, deduped by id — kept in the SAME transaction as the intake write and the audit insert
  -- purely for consistency; it is never itself the audit record (see comment on the table above).
  select coalesce(jsonb_agg(elem order by (elem ->> 'ts')), '[]'::jsonb)
    into v_merged_timeline
    from (
      select elem from jsonb_array_elements(
        coalesce((select timeline from public.justice_cases where id = p_case_id), '[]'::jsonb)
      ) elem
      where elem ->> 'id' is distinct from v_idempotency_key
      union all
      select v_entry
    ) merged(elem);

  update public.justice_cases
     set intake = p_new_intake,
         timeline = v_merged_timeline
   where id = p_case_id and user_id = p_user_id
  returning updated_at, intake into v_case_updated_at, v_case_intake;

  return jsonb_build_object(
    'status', 'applied',
    'case_updated_at', v_case_updated_at,
    'case_intake', v_case_intake,
    'audit_event_id', v_audit_id
  );
end;
$$;

comment on function public.repair_orphaned_paid_case_approval_intake(uuid, uuid, text, timestamptz, jsonb, text) is
  'Atomically corrects a case''s intake and records an immutable, content-addressed audit event for an orphaned_paid_case_approval review task — both commit in one transaction or neither does.';

-- Postgres grants EXECUTE to PUBLIC by default; lock this down to the service role the app already
-- uses for every operator/admin write, matching cancel_operator_fulfillment_task's precedent.
revoke all on function public.repair_orphaned_paid_case_approval_intake(uuid, uuid, text, timestamptz, jsonb, text) from public;
grant execute on function public.repair_orphaned_paid_case_approval_intake(uuid, uuid, text, timestamptz, jsonb, text) to service_role;
