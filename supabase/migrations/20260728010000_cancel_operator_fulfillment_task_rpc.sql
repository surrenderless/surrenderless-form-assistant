-- Atomic operator cancellation of one open fulfillment task.
--
-- Closes the task and clears the matching case's client_state.approved_next_action in a single
-- transaction: either both writes commit or neither does, so a partial failure can never leave
-- the task closed while the case still points at it (or vice versa). All identity checks
-- (task/case linkage, task openness, task notes marker, approved-action href + status) are
-- re-verified here against row-locked, live data — the caller's inputs are assertions checked
-- against truth, not trusted blindly. Never touches justice_case_filings, never sends anything,
-- never creates a follow-up or owned-filing task.

create or replace function public.cancel_operator_fulfillment_task(
  p_task_id uuid,
  p_case_id uuid,
  p_expected_href text,
  p_expected_marker text,
  p_operator_note text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_task record;
  v_case record;
  v_action jsonb;
  v_notes text;
  v_cancelled_at timestamptz := now();
  v_cancelled_at_text text;
  v_note_clean text;
  v_next_notes text;
  v_next_client_state jsonb;
  v_timeline_entry_id text;
  v_timeline jsonb;
  v_already_present boolean;
begin
  if p_task_id is null or p_case_id is null
     or coalesce(btrim(p_expected_href), '') = ''
     or coalesce(btrim(p_expected_marker), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_input', 'status', 400);
  end if;

  -- Lock the task row first; this also serializes against a concurrent completion/cancel attempt.
  select id, user_id, case_id, title, notes, completed_at
    into v_task
    from public.justice_case_tasks
   where id = p_task_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'task_not_found', 'status', 404);
  end if;

  if v_task.case_id is distinct from p_case_id then
    return jsonb_build_object('ok', false, 'error', 'case_mismatch', 'status', 409);
  end if;

  if v_task.completed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'task_already_closed', 'status', 409);
  end if;

  -- Literal comparison only: LIKE would treat '_' and '%' in the marker as wildcards, which
  -- every marker prefix contains (e.g. "payment_dispute_filing_queue:"), loosening what is
  -- meant to be an exact match. left()/length()/= never interpret pattern metacharacters.
  v_notes := coalesce(v_task.notes, '');
  if not (
    btrim(v_notes) = p_expected_marker
    or left(btrim(v_notes), length(p_expected_marker) + 1) = p_expected_marker || E'\n'
  ) then
    return jsonb_build_object('ok', false, 'error', 'task_marker_mismatch', 'status', 409);
  end if;

  -- Lock the case row so no concurrent client_state writer (chat approval, another operator
  -- action) can race this transaction; it either committed before us or waits for our commit.
  select id, user_id, client_state, timeline
    into v_case
    from public.justice_cases
   where id = p_case_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'case_not_found', 'status', 404);
  end if;

  if v_case.user_id is distinct from v_task.user_id then
    return jsonb_build_object('ok', false, 'error', 'case_user_mismatch', 'status', 409);
  end if;

  v_action := coalesce(v_case.client_state, '{}'::jsonb) -> 'approved_next_action';

  if v_action is null or jsonb_typeof(v_action) is distinct from 'object'
     or (v_action ->> 'href') is distinct from p_expected_href
     or (v_action ->> 'status') is distinct from 'approved' then
    return jsonb_build_object('ok', false, 'error', 'approved_action_mismatch', 'status', 409);
  end if;

  v_cancelled_at_text := to_char(v_cancelled_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_note_clean := nullif(btrim(coalesce(p_operator_note, '')), '');
  if v_note_clean is not null and length(v_note_clean) > 2000 then
    v_note_clean := left(v_note_clean, 2000);
  end if;

  v_next_notes := concat_ws(
    E'\n\n',
    nullif(btrim(v_notes), ''),
    concat_ws(
      E'\n',
      '---operator_cancelled---',
      'cancelled_at: ' || v_cancelled_at_text,
      case when v_note_clean is not null then 'note: ' || v_note_clean else null end
    )
  );
  if length(v_next_notes) > 8000 then
    v_next_notes := left(v_next_notes, 8000);
  end if;

  update public.justice_case_tasks
     set completed_at = v_cancelled_at,
         notes = v_next_notes
   where id = p_task_id;

  v_next_client_state := coalesce(v_case.client_state, '{}'::jsonb) - 'approved_next_action';

  -- Deterministic id keyed on the task: a client-side retry of this same cancellation is
  -- idempotent and will not duplicate the timeline entry.
  v_timeline_entry_id := 'task_cancelled:' || p_task_id::text;
  v_timeline := coalesce(v_case.timeline, '[]'::jsonb);
  select exists (
    select 1 from jsonb_array_elements(v_timeline) e where e ->> 'id' = v_timeline_entry_id
  ) into v_already_present;

  if not v_already_present then
    v_timeline := v_timeline || jsonb_build_array(
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', v_timeline_entry_id,
          'case_id', p_case_id,
          'type', 'task_cancelled',
          'label', 'Operator cancelled fulfillment task',
          'detail', concat_ws(
            E'\n',
            'task: ' || v_task.title,
            case when v_note_clean is not null then 'note: ' || v_note_clean else null end
          ),
          'ts', v_cancelled_at_text
        )
      )
    );
  end if;

  update public.justice_cases
     set client_state = v_next_client_state,
         timeline = v_timeline
   where id = p_case_id;

  return jsonb_build_object(
    'ok', true,
    'task_id', p_task_id,
    'case_id', p_case_id,
    'user_id', v_task.user_id,
    'cancelled_at', v_cancelled_at_text,
    'notes', v_next_notes,
    'client_state', v_next_client_state
  );
end;
$$;

comment on function public.cancel_operator_fulfillment_task(uuid, uuid, text, text, text) is
  'Atomically closes one open operator fulfillment task and clears the matching case approved_next_action; never inserts a filing, sends anything, or touches follow-up/owned-filing tasks.';

-- Postgres grants EXECUTE to PUBLIC by default; this function acts across arbitrary users'
-- rows (it is an operator tool, not a per-user RLS-scoped action), so lock it down to the
-- service role the app already uses for every operator/admin write.
revoke all on function public.cancel_operator_fulfillment_task(uuid, uuid, text, text, text) from public;
grant execute on function public.cancel_operator_fulfillment_task(uuid, uuid, text, text, text) to service_role;
